/**
 * Basescan / Etherscan V2 - GRATIS con clave (100.000 peticiones al dia).
 * Se usa para: quien creo el contrato, si esta verificado y su codigo fuente.
 *
 * Etherscan unifico sus APIs en la V2 (un solo dominio con chainid).
 * Si esa ruta falla se prueba el dominio clasico de Basescan.
 */
import { request } from '../core/http.js';
import { env } from '../core/env.js';
import { child } from '../core/logger.js';

const log = child('basescan');
const CHAIN_ID = 8453;
const V2 = 'https://api.etherscan.io/v2/api';
const V1 = 'https://api.basescan.org/api';

interface ScanResponse<T> {
  status?: string;
  message?: string;
  result?: T;
}

/** El plan gratuito no cubre Base: se detecta una vez y se deja de intentar. */
let planSinBase = false;
let avisoPlanDado = false;

/** true si Basescan esta disponible de verdad para esta cadena. */
export function estaDisponible(): boolean {
  return env.basescanKey !== '' && !planSinBase;
}

async function scanRequest<T>(params: Record<string, string>): Promise<T | null> {
  if (!env.basescanKey || planSinBase) return null;

  const build = (base: string, withChain: boolean) => {
    const qs = new URLSearchParams({
      ...(withChain ? { chainid: String(CHAIN_ID) } : {}),
      ...params,
      apikey: env.basescanKey,
    });
    return `${base}?${qs}`;
  };

  for (const [base, withChain] of [
    [V2, true],
    [V1, false],
  ] as Array<[string, boolean]>) {
    const res = await request<ScanResponse<T>>(build(base, withChain), {
      provider: 'basescan',
      retries: 1,
      timeoutMs: 20_000,
    }).catch((err) => {
      log.warn({ base, err: String(err) }, 'Basescan no respondio');
      return null;
    });

    if (res && res.status === '1' && res.result !== undefined) return res.result;

    // status 0 con "No data found" es una respuesta valida: simplemente no hay nada.
    if (res && res.status === '0' && /no data|not found/i.test(res.message ?? '')) return null;

    // Etherscan dejo de dar acceso gratuito a Base. Merece la pena avisar una
    // sola vez y dejar de intentarlo: no es un fallo puntual, no se arregla solo.
    const detalle = typeof res?.result === 'string' ? res.result : '';
    if (/not supported for this chain|upgrade your api plan/i.test(detalle)) {
      if (!avisoPlanDado) {
        avisoPlanDado = true;
        log.warn(
          'Etherscan/Basescan no cubre Base en el plan gratuito. El creador se obtiene de ' +
            'GoPlus y el bloque de creacion se busca en la cadena, asi que el sistema sigue ' +
            'funcionando. Solo se pierde el analisis del codigo fuente.',
        );
      }
      planSinBase = true;
      return null;
    }

    if (res && res.status === '0' && detalle) {
      log.warn({ detalle: detalle.slice(0, 120) }, 'respuesta inesperada de Basescan');
    }
  }
  return null;
}

export interface ContractCreation {
  contractAddress: string;
  contractCreator: string;
  txHash: string;
}

/** Quien creo el contrato y en que transaccion. */
export async function getContractCreator(address: string): Promise<ContractCreation | null> {
  const res = await scanRequest<ContractCreation[]>({
    module: 'contract',
    action: 'getcontractcreation',
    contractaddresses: address,
  });
  const item = Array.isArray(res) ? res[0] : null;
  if (!item?.contractCreator) return null;
  return {
    contractAddress: item.contractAddress ?? address,
    contractCreator: item.contractCreator.toLowerCase(),
    txHash: item.txHash ?? '',
  };
}

export interface SourceInfo {
  isVerified: boolean;
  contractName: string | null;
  sourceCode: string;
  proxy: boolean;
  implementation: string | null;
}

/** Codigo verificado del contrato. Si no esta verificado, isVerified = false. */
export async function getSourceCode(address: string): Promise<SourceInfo | null> {
  const res = await scanRequest<
    Array<{
      SourceCode?: string;
      ContractName?: string;
      Proxy?: string;
      Implementation?: string;
      ABI?: string;
    }>
  >({ module: 'contract', action: 'getsourcecode', address });

  const item = Array.isArray(res) ? res[0] : null;
  if (!item) return null;

  const source = item.SourceCode ?? '';
  const verified = source.trim() !== '' && item.ABI !== 'Contract source code not verified';

  return {
    isVerified: verified,
    contractName: item.ContractName || null,
    sourceCode: source,
    proxy: item.Proxy === '1',
    implementation: item.Implementation && item.Implementation !== '' ? item.Implementation : null,
  };
}

/**
 * Busca en el codigo verificado los patrones que dan poder al creador.
 * No sustituye a una auditoria, pero detecta lo que mas dano hace.
 */
export interface SourcePatterns {
  hasBlacklist: boolean;
  hasWhitelist: boolean;
  hasMint: boolean;
  hasPause: boolean;
  hasSetFee: boolean;
  hasMaxTx: boolean;
  hasOnlyOwner: boolean;
  hasRenounce: boolean;
  matches: string[];
}

export function analyzeSource(source: string): SourcePatterns {
  const s = source.toLowerCase();
  const matches: string[] = [];

  const has = (patterns: string[], label: string): boolean => {
    const found = patterns.some((p) => s.includes(p));
    if (found) matches.push(label);
    return found;
  };

  return {
    hasBlacklist: has(['blacklist', 'blocklist', '_isblacklisted', 'isbot', 'setbots'], 'blacklist'),
    hasWhitelist: has(['whitelist', '_isexcluded', 'isexcludedfromfee'], 'whitelist'),
    hasMint: has(['function mint(', '_mint(', 'function issue('], 'mint'),
    hasPause: has(['pausable', 'function pause(', 'tradingenabled', 'setTrading'.toLowerCase()], 'pausa'),
    hasSetFee: has(['setfee', 'settaxes', 'setbuyfee', 'setsellfee', 'updatefees'], 'comisiones modificables'),
    hasMaxTx: has(['maxtxamount', 'maxwallet', 'setmaxtx'], 'limite por transaccion'),
    hasOnlyOwner: has(['onlyowner'], 'funciones de owner'),
    hasRenounce: has(['renounceownership'], 'renuncia de owner'),
    matches,
  };
}

/** Transacciones normales de una direccion. Sirve para ver quien la financio. */
export async function getAccountTxs(
  address: string,
  limit = 20,
): Promise<Array<{ hash: string; from: string; to: string; value: string; timeStamp: string }>> {
  const res = await scanRequest<Array<{ hash: string; from: string; to: string; value: string; timeStamp: string }>>({
    module: 'account',
    action: 'txlist',
    address,
    startblock: '0',
    endblock: '99999999',
    page: '1',
    offset: String(limit),
    sort: 'asc',
  });
  return Array.isArray(res) ? res : [];
}

/**
 * Contratos creados anteriormente por la misma direccion.
 * Se detectan mirando sus transacciones sin destinatario (creacion de contrato).
 */
export async function getPriorDeployments(deployer: string, limit = 100): Promise<string[]> {
  const res = await scanRequest<
    Array<{ to: string; contractAddress?: string; hash: string; isError?: string }>
  >({
    module: 'account',
    action: 'txlist',
    address: deployer,
    startblock: '0',
    endblock: '99999999',
    page: '1',
    offset: String(limit),
    sort: 'desc',
  });

  if (!Array.isArray(res)) return [];
  return res
    .filter((tx) => (tx.to === '' || tx.to === null) && tx.contractAddress)
    .map((tx) => (tx.contractAddress as string).toLowerCase());
}
