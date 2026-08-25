/**
 * Analisis de seguridad del token y del contrato.
 *
 * Regla de oro: lo que se puede leer directamente de la cadena se lee de la
 * cadena (es gratis y es la verdad). Las APIs externas se usan solo como
 * segunda opinion y nunca bloquean el analisis si fallan.
 */
import type { Chain, DiscoveredPair, SecurityReport } from '../core/types.js';
import { child } from '../core/logger.js';
import { getKnownAddresses } from '../core/config.js';
import * as solana from '../sources/solanaRpc.js';
import * as base from '../sources/baseRpc.js';
import * as rugcheck from '../sources/rugcheck.js';
import * as goplus from '../sources/goplus.js';
import * as honeypot from '../sources/honeypot.js';
import * as basescan from '../sources/basescan.js';
import * as jupiter from '../sources/jupiter.js';
import { getFilters } from '../core/config.js';

const log = child('security');

function emptyReport(chain: Chain, tokenAddress: string): SecurityReport {
  return {
    chain,
    tokenAddress,
    mintAuthorityActive: false,
    mintAuthority: null,
    freezeAuthorityActive: false,
    freezeAuthority: null,
    isToken2022: false,
    hasToken2022Extensions: false,
    ownerCanModify: false,
    ownerAddress: null,
    hasBlacklist: false,
    hasMintFunction: false,
    isProxy: false,
    isVerified: null,
    buyTaxPct: null,
    sellTaxPct: null,
    taxModifiable: false,
    isHoneypot: null,
    canSell: null,
    roundTripLossPct: null,
    lpLockedPct: null,
    lpBurnedPct: null,
    lpLockerName: null,
    totalSupply: null,
    decimals: null,
    notes: [],
    sources: [],
    failedSources: [],
  };
}

// --------------------------------------------------------------------------
//  SOLANA
// --------------------------------------------------------------------------

export async function analyzeSolanaSecurity(pair: DiscoveredPair): Promise<SecurityReport> {
  const report = emptyReport('solana', pair.tokenAddress);

  // Las cuatro fuentes se consultan A LA VEZ. Son independientes entre si:
  // ninguna necesita el resultado de otra para poder pedirse. Hacerlas en
  // serie multiplicaba por cuatro el tiempo del analisis sin ganar nada,
  // porque cada una espera a un servidor distinto.
  const tamanoPos = getFilters().execution?.position_size_usd ?? 200;

  const [mint, rc, gp, ventaJup] = await Promise.all([
    solana.getMintInfo(pair.tokenAddress),
    rugcheck.getReport(pair.tokenAddress),
    goplus.getSolanaSecurity(pair.tokenAddress),
    jupiter
      .solLamportsForUsd(tamanoPos)
      .then((lam) => (lam && lam > 0n ? jupiter.checkSellRoundTrip(pair.tokenAddress, lam) : null))
      .catch(() => null),
  ]);

  // 1. Lectura directa de la cadena: es la fuente de verdad.
  if (mint) {
    report.sources.push('solana_rpc');
    report.decimals = mint.decimals;
    report.totalSupply = mint.supply;
    report.mintAuthority = mint.mintAuthority;
    report.mintAuthorityActive = mint.mintAuthority !== null;
    report.freezeAuthority = mint.freezeAuthority;
    report.freezeAuthorityActive = mint.freezeAuthority !== null;
    report.isToken2022 = mint.program === 'spl-token-2022';
    report.hasToken2022Extensions = mint.hasExtensions;

    report.notes.push(
      mint.mintAuthority === null
        ? 'Mint authority revocada: no se pueden crear mas tokens.'
        : `Mint authority ACTIVA (${mint.mintAuthority}): el creador puede emitir mas suministro.`,
    );
    report.notes.push(
      mint.freezeAuthority === null
        ? 'Freeze authority revocada: nadie puede congelar tus tokens.'
        : `Freeze authority ACTIVA (${mint.freezeAuthority}): pueden congelar tus tokens.`,
    );
    if (report.isToken2022) {
      report.notes.push(
        report.hasToken2022Extensions
          ? 'Token-2022 CON extensiones: revisar comisiones de transferencia y delegado permanente.'
          : 'Token-2022 sin extensiones detectadas.',
      );
    }
  } else {
    report.failedSources.push('solana_rpc');
    report.notes.push('No se pudo leer la cuenta del mint en la cadena.');
  }

  // 2. Segunda opinion: RugCheck.
  if (rc) {
    report.sources.push('rugcheck');
    if (rc.lpLockedPct !== null) report.lpLockedPct = rc.lpLockedPct;
    if (rc.rugged) report.notes.push('RugCheck marca este token como ya "rugged".');

    // Solo se consideran riesgos accionables, y con semantica de "autoridad
    // activa": buscar la subcadena "mint" a secas marcaba como peligroso
    // cualquier aviso que mencionase la palabra de pasada.
    let rcDiceMint = rc.mintAuthority !== null;
    let rcDiceFreeze = rc.freezeAuthority !== null;

    for (const risk of rc.risks) {
      if (risk.level !== 'danger' && risk.level !== 'warn') continue;
      report.notes.push(`RugCheck: ${risk.name}${risk.description ? ` - ${risk.description}` : ''}`);
      const name = risk.name.toLowerCase();
      if (/freeze\s*authority/.test(name)) rcDiceFreeze = true;
      if (/mint\s*authority/.test(name)) rcDiceMint = true;
    }

    // LA CADENA MANDA. Es lo que promete docs/es/apis.md, y hasta ahora el
    // codigo hacia justo lo contrario: pisaba el dato leido de la cadena con
    // el de RugCheck, que en tokens recien creados suele ir desfasado. Eso
    // vetaba tokens con la autoridad ya revocada.
    if (!mint) {
      // Sin lectura de cadena, RugCheck es la unica senal disponible.
      if (rcDiceMint) {
        report.mintAuthorityActive = true;
        report.notes.push('Mint authority activa segun RugCheck (no se pudo leer la cadena).');
      }
      if (rcDiceFreeze) {
        report.freezeAuthorityActive = true;
        report.notes.push('Freeze authority activa segun RugCheck (no se pudo leer la cadena).');
      }
    } else {
      if (rcDiceMint && !mint.mintAuthority) {
        report.notes.push(
          'Aviso: RugCheck ve mint authority pero la cadena dice que esta revocada. Manda la cadena.',
        );
      }
      if (rcDiceFreeze && !mint.freezeAuthority) {
        report.notes.push(
          'Aviso: RugCheck ve freeze authority pero la cadena dice que esta revocada. Manda la cadena.',
        );
      }
    }
  } else {
    report.failedSources.push('rugcheck');
  }

  // 3. Tercera opinion: GoPlus (extensiones de Token-2022).
  if (gp) {
    report.sources.push('goplus');
    if (gp.transferFeeUpgradable) {
      report.taxModifiable = true;
      report.notes.push('GoPlus: la comision de transferencia se puede modificar.');
    }
    if (gp.transferHookUpgradable) {
      report.notes.push('GoPlus: hook de transferencia modificable (pueden bloquear ventas).');
    }
    if (gp.balanceMutable) {
      report.notes.push('GoPlus: existe una autoridad que puede modificar saldos.');
    }
    if (gp.closable) {
      report.notes.push('GoPlus: las cuentas del token se pueden cerrar.');
    }
    if (gp.nonTransferable) {
      report.notes.push('GoPlus: token NO transferible.');
    }
  } else {
    report.failedSources.push('goplus');
  }

  // 4. ¿SE PUEDE VENDER? Comprobacion real con Jupiter.
  //    En Solana no existe simulacion de venta como en Base, pero si se puede
  //    pedir una cotizacion real de compra y otra de venta encadenadas. Si hay
  //    ruta para comprar y ninguna para vender, es un honeypot.
  {
    const venta = ventaJup;
    if (venta) {
      report.sources.push('jupiter');
      report.canSell = venta.canSell;
      report.roundTripLossPct = venta.roundTripLossPct;
      report.notes.push(venta.note);

      // Comprar si y vender no es la senal mas fuerte que existe en Solana.
      if (venta.looksLikeHoneypot) report.isHoneypot = true;
      else if (venta.canSell === true) report.isHoneypot = false;
    } else {
      report.failedSources.push('jupiter');
      report.notes.push('No se pudo comprobar con Jupiter si el token se puede vender.');
    }
  }

  // 5. Liquidez bloqueada o quemada.
  //    En Solana lo mas fiable en el nivel gratuito es lo que reporta RugCheck.
  if (report.lpLockedPct === null) {
    report.notes.push('No se pudo confirmar si la liquidez esta bloqueada.');
  } else if (report.lpLockedPct >= 90) {
    report.notes.push(`Liquidez bloqueada o quemada al ${report.lpLockedPct.toFixed(1)}%.`);
  } else {
    report.notes.push(
      `Solo el ${report.lpLockedPct.toFixed(1)}% de la liquidez esta bloqueada: se puede retirar el resto.`,
    );
  }

  return report;
}

// --------------------------------------------------------------------------
//  BASE (EVM)
// --------------------------------------------------------------------------

export async function analyzeBaseSecurity(pair: DiscoveredPair): Promise<SecurityReport> {
  const report = emptyReport('base', pair.tokenAddress);
  const known = getKnownAddresses();

  // Igual que en Solana: las fuentes son independientes y se piden a la vez.
  const [erc20, gp, hp, source] = await Promise.all([
    base.getErc20Info(pair.tokenAddress),
    goplus.getEvmSecurity(pair.tokenAddress),
    honeypot.check(pair.tokenAddress, pair.pairAddress),
    basescan.getSourceCode(pair.tokenAddress).catch(() => null),
  ]);

  // 1. Datos del contrato leidos de la cadena.
  if (erc20.isContract) {
    report.sources.push('base_rpc');
    report.decimals = erc20.decimals;
    report.totalSupply = erc20.totalSupply !== null ? erc20.totalSupply.toString() : null;
    report.ownerAddress = erc20.owner;

    const ZERO = '0x0000000000000000000000000000000000000000';
    if (erc20.owner && erc20.owner.toLowerCase() !== ZERO) {
      report.ownerCanModify = true;
      report.notes.push(`El contrato tiene owner activo: ${erc20.owner}.`);
    } else if (erc20.owner) {
      report.notes.push('Propiedad renunciada (owner = direccion cero).');
    } else {
      report.notes.push('El contrato no expone funcion owner() publica.');
    }
  } else {
    report.failedSources.push('base_rpc');
    report.notes.push('No se pudo leer el contrato en la cadena.');
  }

  // 2. GoPlus: honeypot, comisiones, blacklist, proxy.
  if (gp) {
    report.sources.push('goplus');
    if (gp.isHoneypot !== null) report.isHoneypot = gp.isHoneypot;
    if (gp.buyTaxPct !== null) report.buyTaxPct = gp.buyTaxPct;
    if (gp.sellTaxPct !== null) report.sellTaxPct = gp.sellTaxPct;
    if (gp.hasBlacklist) report.hasBlacklist = true;
    if (gp.isMintable) report.hasMintFunction = true;
    if (gp.isProxy) report.isProxy = true;
    if (gp.isOpenSource !== null) report.isVerified = gp.isOpenSource;
    if (gp.slippageModifiable || gp.antiWhaleModifiable) report.taxModifiable = true;
    if (gp.canTakeBackOwnership || gp.ownerChangeBalance || gp.transferPausable) {
      report.ownerCanModify = true;
    }
    if (gp.ownerAddress && !report.ownerAddress) report.ownerAddress = gp.ownerAddress;
    if (gp.lpLockedPct !== null) report.lpLockedPct = gp.lpLockedPct;

    if (gp.isHoneypot) report.notes.push('GoPlus: HONEYPOT detectado, no se podria vender.');
    if (gp.hasBlacklist) report.notes.push('GoPlus: el contrato puede bloquear direcciones (blacklist).');
    if (gp.isMintable) report.notes.push('GoPlus: el contrato puede acunar mas suministro.');
    if (gp.transferPausable) report.notes.push('GoPlus: las transferencias se pueden pausar.');
    if (gp.canTakeBackOwnership) report.notes.push('GoPlus: se puede recuperar la propiedad tras renunciar.');
    if (gp.ownerChangeBalance) report.notes.push('GoPlus: el owner puede modificar saldos ajenos.');
    if (gp.isProxy) report.notes.push('GoPlus: contrato proxy, el codigo se puede sustituir.');
    if (gp.slippageModifiable) report.notes.push('GoPlus: las comisiones se pueden modificar.');
    if (gp.creatorPercent !== null && gp.creatorPercent > 0) {
      report.notes.push(`GoPlus: el creador conserva el ${gp.creatorPercent.toFixed(2)}% del suministro.`);
    }
  } else {
    report.failedSources.push('goplus');
  }

  // 3. Honeypot.is: simula compra y venta de verdad.
  if (hp) {
    report.sources.push('honeypot.is');
    if (hp.isHoneypot !== null) {
      // Si cualquiera de las dos fuentes dice honeypot, lo damos por bueno.
      report.isHoneypot = report.isHoneypot === true ? true : hp.isHoneypot;
    }
    if (hp.buyTaxPct !== null && report.buyTaxPct === null) report.buyTaxPct = hp.buyTaxPct;
    if (hp.sellTaxPct !== null && report.sellTaxPct === null) report.sellTaxPct = hp.sellTaxPct;
    if (hp.isHoneypot) {
      report.notes.push(`Honeypot.is: NO se puede vender. Motivo: ${hp.reason ?? 'sin detalle'}.`);
    } else if (hp.isHoneypot === false) {
      report.notes.push(
        `Honeypot.is: la venta simulada funciona (compra ${hp.buyTaxPct?.toFixed(1) ?? '?'}%, venta ${hp.sellTaxPct?.toFixed(1) ?? '?'}%).`,
      );
    }
    for (const f of hp.flags) report.notes.push(`Honeypot.is: ${f}`);
  } else {
    report.failedSources.push('honeypot.is');
  }

  // 4. Codigo verificado en Basescan.
  if (source) {
    report.sources.push('basescan');
    report.isVerified = source.isVerified;
    if (source.proxy) report.isProxy = true;

    if (source.isVerified) {
      const patterns = basescan.analyzeSource(source.sourceCode);
      if (patterns.hasBlacklist) report.hasBlacklist = true;
      if (patterns.hasMint) report.hasMintFunction = true;
      if (patterns.hasSetFee) report.taxModifiable = true;
      if (patterns.hasOnlyOwner && !patterns.hasRenounce) report.ownerCanModify = true;

      if (patterns.matches.length > 0) {
        report.notes.push(`Codigo verificado. Patrones encontrados: ${patterns.matches.join(', ')}.`);
      } else {
        report.notes.push('Codigo verificado, sin patrones peligrosos evidentes.');
      }
    } else {
      report.notes.push('El contrato NO esta verificado: no se puede revisar su codigo.');
    }
  } else {
    report.failedSources.push('basescan');
  }

  // 5. Liquidez quemada o bloqueada, leida de la cadena.
  try {
    const burnList = known.base.burn;
    const lockers = Object.entries(known.base.lockers).map(([name, address]) => ({ name, address }));
    const lp = await base.getLpDistribution(pair.pairAddress, burnList, lockers);

    if (lp.burnedPct !== null) report.lpBurnedPct = lp.burnedPct;
    if (lp.lockedPct !== null) {
      // Nos quedamos con el dato de la cadena, que es mas fiable que el de GoPlus.
      report.lpLockedPct = Math.max(lp.lockedPct, report.lpLockedPct ?? 0);
    }
    if (lp.lockerName) report.lpLockerName = lp.lockerName;

    const total = (report.lpBurnedPct ?? 0) + (report.lpLockedPct ?? 0);
    if (lp.burnedPct === null) {
      report.notes.push('No se pudo leer la distribucion de los tokens de liquidez.');
    } else if (total >= 90) {
      report.notes.push(
        `Liquidez asegurada al ${total.toFixed(1)}% (quemada ${(report.lpBurnedPct ?? 0).toFixed(1)}%, bloqueada ${(report.lpLockedPct ?? 0).toFixed(1)}%${lp.lockerName ? ` en ${lp.lockerName}` : ''}).`,
      );
    } else {
      report.notes.push(
        `Solo el ${total.toFixed(1)}% de la liquidez esta quemada o bloqueada: el resto se puede retirar.`,
      );
    }
  } catch (err) {
    log.warn({ token: pair.tokenAddress, err: String(err) }, 'no se pudo analizar la liquidez');
    report.failedSources.push('lp_distribution');
  }

  return report;
}

export async function analyzeSecurity(pair: DiscoveredPair): Promise<SecurityReport> {
  return pair.chain === 'solana' ? analyzeSolanaSecurity(pair) : analyzeBaseSecurity(pair);
}
