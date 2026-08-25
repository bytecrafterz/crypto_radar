/**
 * Deteccion de cambios DESPUES de la senal.
 *
 * Un token puede ser seguro en el minuto 1 y peligroso en el minuto 10.
 * Este modulo compara el informe de seguridad actual con el anterior y avisa
 * de cualquier condicion que haya empeorado.
 */
import type { SecurityReport, HolderReport, SuspiciousEvent } from '../core/types.js';

export interface DetectedChange {
  field: string;
  before: string | null;
  after: string | null;
  severity: 'info' | 'warn' | 'danger';
  detail: string;
}

const si = (v: boolean | null): string => (v === null ? 'n/d' : v ? 'si' : 'no');

/**
 * Compara dos informes de seguridad del mismo token.
 * Solo interesa lo que EMPEORA: que algo mejore no es una alerta.
 */
export function compareSecurity(
  antes: SecurityReport | null,
  ahora: SecurityReport | null,
): DetectedChange[] {
  if (!antes || !ahora) return [];
  const cambios: DetectedChange[] = [];

  const empeoraBool = (
    campo: string,
    a: boolean | null,
    b: boolean | null,
    texto: string,
    sev: 'warn' | 'danger' = 'danger',
  ) => {
    if (a === false && b === true) {
      cambios.push({ field: campo, before: si(a), after: si(b), severity: sev, detail: texto });
    }
  };

  empeoraBool('mint_authority', antes.mintAuthorityActive, ahora.mintAuthorityActive,
    'La mint authority se ha REACTIVADO: ahora pueden crear mas suministro.');
  empeoraBool('freeze_authority', antes.freezeAuthorityActive, ahora.freezeAuthorityActive,
    'La freeze authority se ha REACTIVADO: ahora pueden congelar tus tokens.');
  empeoraBool('blacklist', antes.hasBlacklist, ahora.hasBlacklist,
    'Ha aparecido una funcion de blacklist en el contrato.');
  empeoraBool('honeypot', antes.isHoneypot, ahora.isHoneypot,
    'El token ha pasado a comportarse como HONEYPOT: la venta ya no funciona.');
  empeoraBool('owner', antes.ownerCanModify, ahora.ownerCanModify,
    'El contrato ha recuperado permisos de owner.');
  empeoraBool('proxy', antes.isProxy, ahora.isProxy,
    'El contrato ahora es un proxy: el codigo se puede sustituir.');
  empeoraBool('tax_modifiable', antes.taxModifiable, ahora.taxModifiable,
    'Las comisiones han pasado a ser modificables.', 'warn');

  // Comisiones: cualquier subida relevante importa.
  const subeTax = (campo: string, a: number | null, b: number | null, nombre: string) => {
    if (a === null || b === null) return;
    if (b > a + 1) {
      cambios.push({
        field: campo,
        before: `${a.toFixed(1)}%`,
        after: `${b.toFixed(1)}%`,
        severity: b > 10 ? 'danger' : 'warn',
        detail: `La comision de ${nombre} ha subido del ${a.toFixed(1)}% al ${b.toFixed(1)}%.`,
      });
    }
  };
  subeTax('buy_tax', antes.buyTaxPct, ahora.buyTaxPct, 'compra');
  subeTax('sell_tax', antes.sellTaxPct, ahora.sellTaxPct, 'venta');

  // Liquidez bloqueada que deja de estarlo.
  const lpAntes = (antes.lpLockedPct ?? 0) + (antes.lpBurnedPct ?? 0);
  const lpAhora = (ahora.lpLockedPct ?? 0) + (ahora.lpBurnedPct ?? 0);
  if (lpAntes >= 50 && lpAhora < lpAntes - 10) {
    cambios.push({
      field: 'lp_lock',
      before: `${lpAntes.toFixed(0)}%`,
      after: `${lpAhora.toFixed(0)}%`,
      severity: 'danger',
      detail: `La liquidez asegurada ha bajado del ${lpAntes.toFixed(0)}% al ${lpAhora.toFixed(0)}%: se ha desbloqueado parte.`,
    });
  }

  return cambios;
}

/**
 * Movimientos del creador y de los grandes holders.
 * Se detecta comparando cuanto tenian antes y cuanto tienen ahora.
 */
export function compareHolders(
  antes: HolderReport | null,
  ahora: HolderReport | null,
): SuspiciousEvent[] {
  if (!antes || !ahora) return [];
  const eventos: SuspiciousEvent[] = [];

  // El creador se deshace de su parte.
  if (antes.deployerPct !== null && ahora.deployerPct !== null) {
    const caida = antes.deployerPct - ahora.deployerPct;
    if (caida >= 1 && antes.deployerPct > 0) {
      const pct = (caida / antes.deployerPct) * 100;
      eventos.push({
        kind: 'deployer_sold',
        severity: pct >= 50 ? 'danger' : 'warn',
        detail: `El creador ha reducido su posicion del ${antes.deployerPct.toFixed(1)}% al ${ahora.deployerPct.toFixed(1)}% del suministro (${pct.toFixed(0)}% de lo que tenia).`,
        data: { antes: antes.deployerPct, ahora: ahora.deployerPct },
      });
    }
  }

  // La concentracion aumenta de golpe: alguien esta acumulando.
  if (antes.top10Pct !== null && ahora.top10Pct !== null) {
    const subida = ahora.top10Pct - antes.top10Pct;
    if (subida >= 10) {
      eventos.push({
        kind: 'bot_pattern',
        severity: subida >= 20 ? 'danger' : 'warn',
        detail: `La concentracion del top 10 ha subido del ${antes.top10Pct.toFixed(1)}% al ${ahora.top10Pct.toFixed(1)}%: alguien esta acumulando.`,
        data: { antes: antes.top10Pct, ahora: ahora.top10Pct },
      });
    }
  }

  return eventos;
}
