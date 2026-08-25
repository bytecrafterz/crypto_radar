/**
 * Base (EVM) - acceso directo a la cadena por JSON-RPC.
 *
 * Se usa viem solo para codificar y descodificar llamadas al contrato;
 * el transporte pasa por nuestro cliente HTTP para respetar los limites
 * del plan gratuito.
 */
import {
  encodeFunctionData,
  decodeFunctionResult,
  encodeEventTopics,
  decodeEventLog,
  parseAbi,
  getAddress,
  isAddress,
  type Abi,
} from 'viem';
import { rpcCall, rpcBatch } from '../core/http.js';
import { env } from '../core/env.js';
import { child } from '../core/logger.js';

const log = child('base');
const PROVIDER = 'base_rpc';
/** eth_getLogs va por otro RPC: ver el comentario en env.baseLogsRpcUrl. */
const LOGS_PROVIDER = 'base_logs';

const url = () => env.baseRpcUrl;
const logsUrl = () => env.baseLogsRpcUrl;

export const ERC20_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function owner() view returns (address)',
  'function getOwner() view returns (address)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]) as Abi;

export const PAIR_ABI = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)',
  'event Mint(address indexed sender, uint amount0, uint amount1)',
  'event Burn(address indexed sender, uint amount0, uint amount1, address indexed to)',
]) as Abi;

const TRANSFER_TOPIC = encodeEventTopics({ abi: ERC20_ABI, eventName: 'Transfer' })[0] as string;

function toHex(n: number | bigint): string {
  return `0x${BigInt(n).toString(16)}`;
}

/** eth_call que devuelve el valor ya descodificado, o null si falla. */
export async function callContract<T = unknown>(
  address: string,
  abi: Abi,
  functionName: string,
  args: unknown[] = [],
): Promise<T | null> {
  try {
    const data = encodeFunctionData({ abi, functionName, args: args as never });
    const raw = await rpcCall<string>(url(), PROVIDER, 'eth_call', [
      { to: address, data },
      'latest',
    ]);
    if (!raw || raw === '0x') return null;
    return decodeFunctionResult({ abi, functionName, data: raw as `0x${string}` }) as T;
  } catch {
    return null;
  }
}

/** Varias lecturas al contrato en una sola conexion. */
export async function callContractBatch(
  calls: Array<{ address: string; abi: Abi; functionName: string; args?: unknown[] }>,
): Promise<Array<unknown | null>> {
  if (calls.length === 0) return [];
  const encoded = calls.map((c) => ({
    method: 'eth_call',
    params: [
      { to: c.address, data: encodeFunctionData({ abi: c.abi, functionName: c.functionName, args: (c.args ?? []) as never }) },
      'latest',
    ],
  }));

  const raws = await rpcBatch<string>(url(), PROVIDER, encoded);
  return raws.map((raw, i) => {
    const call = calls[i];
    if (!raw || raw === '0x' || !call) return null;
    try {
      return decodeFunctionResult({
        abi: call.abi,
        functionName: call.functionName,
        data: raw as `0x${string}`,
      });
    } catch {
      return null;
    }
  });
}

export interface Erc20Info {
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: bigint | null;
  owner: string | null;
  isContract: boolean;
}

/**
 * Cache corta de los datos del token.
 * Seguridad y holders piden lo mismo con segundos de diferencia; sin esta
 * cache se duplican 7 llamadas por token y el RPC gratuito rechaza la segunda
 * tanda, dejando el analisis de holders sin suministro total.
 */
const erc20Cache = new Map<string, { at: number; info: Erc20Info }>();
const ERC20_CACHE_MS = 120_000;

/** Datos basicos del token en una sola tanda de llamadas. */
export async function getErc20Info(address: string): Promise<Erc20Info> {
  const key = address.toLowerCase();
  const cached = erc20Cache.get(key);
  if (cached && Date.now() - cached.at < ERC20_CACHE_MS) return cached.info;

  const info = await fetchErc20Info(address);

  // Solo guardamos lecturas utiles: si el RPC fallo, se reintenta la proxima vez.
  if (info.isContract && info.totalSupply !== null) {
    erc20Cache.set(key, { at: Date.now(), info });
    if (erc20Cache.size > 500) {
      const oldest = [...erc20Cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) erc20Cache.delete(oldest[0]);
    }
  }
  return info;
}

async function fetchErc20Info(address: string): Promise<Erc20Info> {
  const [name, symbol, decimals, totalSupply, owner, getOwner] = await callContractBatch([
    { address, abi: ERC20_ABI, functionName: 'name' },
    { address, abi: ERC20_ABI, functionName: 'symbol' },
    { address, abi: ERC20_ABI, functionName: 'decimals' },
    { address, abi: ERC20_ABI, functionName: 'totalSupply' },
    { address, abi: ERC20_ABI, functionName: 'owner' },
    { address, abi: ERC20_ABI, functionName: 'getOwner' },
  ]);

  const code = await getCode(address);

  const ownerAddr = (owner ?? getOwner) as string | null;

  // El suministro total es imprescindible para calcular porcentajes.
  // Si la tanda fallo (habitual en RPC gratuitos saturados), se reintenta suelto.
  let supply = typeof totalSupply === 'bigint' ? totalSupply : null;
  if (supply === null && code !== null && code !== '0x') {
    const retry = await callContract<bigint>(address, ERC20_ABI, 'totalSupply');
    if (typeof retry === 'bigint') supply = retry;
  }

  return {
    address,
    name: typeof name === 'string' ? name : null,
    symbol: typeof symbol === 'string' ? symbol : null,
    decimals: typeof decimals === 'number' ? decimals : decimals != null ? Number(decimals) : null,
    totalSupply: supply,
    owner: typeof ownerAddr === 'string' && isAddress(ownerAddr) ? getAddress(ownerAddr) : null,
    isContract: code !== null && code !== '0x' && code.length > 2,
  };
}

export async function getCode(address: string): Promise<string | null> {
  return rpcCall<string>(url(), PROVIDER, 'eth_getCode', [address, 'latest']).catch(() => null);
}

/**
 * Codigo del contrato en un bloque concreto del pasado.
 *
 * Devuelve la cadena de codigo, o lanza si el RPC falla. NO se puede tragar el
 * error: un fallo del RPC y "en ese bloque no habia codigo" son cosas
 * distintas, y confundirlas descoloca la biseccion por completo.
 */
async function getCodeAt(address: string, blockNumber: number): Promise<string> {
  const code = await rpcCall<string>(url(), PROVIDER, 'eth_getCode', [
    address,
    toHex(blockNumber),
  ]);
  if (typeof code !== 'string') {
    throw new Error(`eth_getCode devolvio algo que no es codigo en el bloque ${blockNumber}`);
  }
  return code;
}

/**
 * Bloque en el que se creo el contrato, buscado por biseccion.
 *
 * Basescan dejo de ofrecer acceso gratuito a Base (Etherscan V2 responde
 * "Free API access is not supported for this chain"), asi que el bloque de
 * creacion se deduce de la propia cadena: se busca el primer bloque en el que
 * la direccion ya tiene codigo.
 *
 * Cuesta unas 20 llamadas por token, una sola vez, y hace que la lista de
 * holders sea exacta en vez de aproximada.
 */
export async function findDeploymentBlock(
  address: string,
  opts: { maxDiasAtras?: number } = {},
): Promise<number | null> {
  const tip = await getBlockNumber();
  if (tip === null) return null;

  const codigoActual = await getCode(address);
  if (!codigoActual || codigoActual === '0x') return null; // no es un contrato

  // Solo nos interesan tokens recientes. Acotar la busqueda ahorra llamadas.
  const dias = opts.maxDiasAtras ?? 30;
  const bloquesPorDia = 43_200; // Base produce un bloque cada ~2 segundos
  let lo = Math.max(0, tip - dias * bloquesPorDia);
  let hi = tip;

  try {
    // Si ya existia al principio de la ventana, es mas viejo de lo que buscamos.
    const codigoAlInicio = await getCodeAt(address, lo);
    if (codigoAlInicio !== '0x') return null;

    // Biseccion: primer bloque con codigo.
    while (lo < hi) {
      const medio = Math.floor((lo + hi) / 2);
      const codigo = await getCodeAt(address, medio);
      if (codigo !== '0x') hi = medio;
      else lo = medio + 1;
    }
  } catch (err) {
    // Un solo fallo del RPC invalida toda la biseccion: cada sonda condiciona
    // la siguiente. Es preferible no saber el bloque que devolver uno inventado,
    // porque de el depende que la lista de holders se declare exacta.
    log.warn(
      { address, err: String(err) },
      'la busqueda del bloque de creacion fallo; no se puede afirmar el bloque exacto',
    );
    return null;
  }

  return lo;
}

export async function getBlockNumber(): Promise<number | null> {
  const hex = await rpcCall<string>(url(), PROVIDER, 'eth_blockNumber', []).catch(() => null);
  return hex ? Number(BigInt(hex)) : null;
}

export async function getBalanceOf(token: string, holder: string): Promise<bigint | null> {
  const res = await callContract<bigint>(token, ERC20_ABI, 'balanceOf', [holder]);
  return typeof res === 'bigint' ? res : null;
}

/** Saldos de varias direcciones sobre el mismo token, en una sola tanda. */
export async function getBalancesOf(
  token: string,
  holders: string[],
): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  if (holders.length === 0) return out;
  const results = await callContractBatch(
    holders.map((h) => ({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [h] })),
  );
  results.forEach((r, i) => {
    const holder = holders[i];
    if (typeof r === 'bigint' && holder) out.set(holder, r);
  });
  return out;
}

export interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

/**
 * Lee eventos Transfer del token por tramos.
 * En Base un token nuevo tiene pocos eventos, asi que reconstruir la lista
 * de holders desde cero es viable con el plan gratuito.
 */
/**
 * Detecta si el proveedor se queja del tamano de la consulta y cuanto admite.
 *
 * Hay dos quejas distintas y ambas se resuelven igual, pidiendo menos bloques:
 *  - por RANGO  ("up to a 10 block range")      -> limite del plan
 *  - por TAMANO ("backend response too large")  -> demasiados eventos de golpe
 */
function limiteDeRango(mensaje: string): number | null {
  const patrones =
    /block range|range is too large|up to a \d+ block|too many results|response size|too large|too big|limit exceeded|query returned more than/i;
  if (!patrones.test(mensaje)) return null;
  // Muchos proveedores dicen el maximo exacto: "up to a 10 block range".
  const m = mensaje.match(/up to a (\d+) block/i) ?? mensaje.match(/maximum of (\d+) blocks?/i);
  return m ? Number(m[1]) : 0; // 0 = hay que reducir, pero no dice cuanto
}

export interface TransferLogsResult {
  logs: RawLog[];
  /** true si se leyo TODO el rango pedido, sin huecos. */
  complete: boolean;
  /** Bloques que no se pudieron leer por fallos o por agotar los tramos. */
  blocksMissing: number;
}

export async function getTransferLogs(
  token: string,
  fromBlock: number,
  toBlock: number,
  chunkSize = 2000,
  maxChunks = 40,
): Promise<TransferLogsResult> {
  const out: RawLog[] = [];
  let missing = 0;
  let start = fromBlock;
  let chunks = 0;
  let tamano = chunkSize;

  while (start <= toBlock && chunks < maxChunks) {
    const end = Math.min(start + tamano - 1, toBlock);

    let logs: RawLog[] | null = null;
    try {
      logs = await rpcCall<RawLog[]>(logsUrl(), LOGS_PROVIDER, 'eth_getLogs', [
        {
          address: token,
          topics: [TRANSFER_TOPIC],
          fromBlock: toHex(start),
          toBlock: toHex(end),
        },
      ]);
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : String(err);
      const limite = limiteDeRango(mensaje);

      // El proveedor no admite un rango tan grande: se reduce y se reintenta
      // el MISMO tramo, sin avanzar, para no dejar huecos en la lista.
      if (limite !== null && tamano > 10) {
        const nuevo = limite > 0 ? Math.min(limite, tamano - 1) : Math.max(10, Math.floor(tamano / 4));
        log.warn({ token, antes: tamano, ahora: nuevo }, 'el RPC limita el rango de eth_getLogs, se reduce');
        tamano = nuevo;
        continue;
      }

      // El tramo se pierde: se contabiliza para no dar por completa la lectura.
      missing += end - start + 1;
      log.warn({ token, start, end, err: mensaje }, 'eth_getLogs fallo en un tramo: queda un hueco');
    }

    if (Array.isArray(logs)) out.push(...logs);
    start = end + 1;
    chunks++;
  }

  // Lo que quede sin leer por agotar los tramos tambien es hueco.
  if (start <= toBlock) {
    const pendientes = toBlock - start + 1;
    missing += pendientes;
    log.warn(
      { token, sinLeer: pendientes, total: toBlock - fromBlock },
      'se alcanzo el maximo de tramos: la lectura queda incompleta',
    );
  }

  return { logs: out, complete: missing === 0, blocksMissing: missing };
}

export interface TransferEvent {
  from: string;
  to: string;
  value: bigint;
  blockNumber: number;
  txHash: string;
  logIndex: number;
}

export function decodeTransfers(logs: RawLog[]): TransferEvent[] {
  const out: TransferEvent[] = [];
  for (const l of logs) {
    try {
      const decoded = decodeEventLog({
        abi: ERC20_ABI,
        eventName: 'Transfer',
        data: l.data as `0x${string}`,
        topics: l.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
      }) as unknown as { args: { from: string; to: string; value: bigint } };
      out.push({
        from: decoded.args.from.toLowerCase(),
        to: decoded.args.to.toLowerCase(),
        value: decoded.args.value,
        blockNumber: Number(BigInt(l.blockNumber)),
        txHash: l.transactionHash,
        logIndex: Number(BigInt(l.logIndex)),
      });
    } catch {
      // Algunos tokens emiten Transfer con firmas raras; se ignoran.
    }
  }
  return out;
}

/**
 * Reconstruye los saldos de todos los holders sumando y restando
 * los eventos Transfer. Es exacto siempre que se lean todos los eventos
 * desde la creacion del token.
 */
export function balancesFromTransfers(transfers: TransferEvent[]): Map<string, bigint> {
  const balances = new Map<string, bigint>();
  const ZERO = '0x0000000000000000000000000000000000000000';

  for (const t of transfers) {
    if (t.from !== ZERO) {
      balances.set(t.from, (balances.get(t.from) ?? 0n) - t.value);
    }
    if (t.to !== ZERO) {
      balances.set(t.to, (balances.get(t.to) ?? 0n) + t.value);
    }
  }

  for (const [addr, bal] of balances) {
    if (bal <= 0n) balances.delete(addr);
  }
  return balances;
}

export interface PairInfo {
  address: string;
  token0: string | null;
  token1: string | null;
  reserve0: bigint | null;
  reserve1: bigint | null;
  lpTotalSupply: bigint | null;
}

/** Datos del pool Uniswap V2 / Aerodrome. */
export async function getPairInfo(pairAddress: string): Promise<PairInfo> {
  const [token0, token1, reserves, totalSupply] = await callContractBatch([
    { address: pairAddress, abi: PAIR_ABI, functionName: 'token0' },
    { address: pairAddress, abi: PAIR_ABI, functionName: 'token1' },
    { address: pairAddress, abi: PAIR_ABI, functionName: 'getReserves' },
    { address: pairAddress, abi: PAIR_ABI, functionName: 'totalSupply' },
  ]);

  const res = reserves as readonly [bigint, bigint, number] | null;

  return {
    address: pairAddress,
    token0: typeof token0 === 'string' ? token0.toLowerCase() : null,
    token1: typeof token1 === 'string' ? token1.toLowerCase() : null,
    reserve0: res ? res[0] : null,
    reserve1: res ? res[1] : null,
    lpTotalSupply: typeof totalSupply === 'bigint' ? totalSupply : null,
  };
}

/**
 * Comprueba cuanta liquidez esta quemada o bloqueada.
 * Se mira quien tiene los tokens LP: si estan en la direccion de quemado
 * o en un contrato de bloqueo conocido, la liquidez no se puede retirar.
 */
export async function getLpDistribution(
  pairAddress: string,
  burnAddresses: string[],
  lockerAddresses: Array<{ name: string; address: string }>,
): Promise<{ burnedPct: number | null; lockedPct: number | null; lockerName: string | null }> {
  const info = await getPairInfo(pairAddress);
  const total = info.lpTotalSupply;
  if (!total || total === 0n) return { burnedPct: null, lockedPct: null, lockerName: null };

  const holders = [...burnAddresses, ...lockerAddresses.map((l) => l.address)];
  const balances = await getBalancesOf(pairAddress, holders);

  let burned = 0n;
  for (const b of burnAddresses) burned += balances.get(b) ?? 0n;

  let locked = 0n;
  let lockerName: string | null = null;
  for (const l of lockerAddresses) {
    const bal = balances.get(l.address) ?? 0n;
    if (bal > 0n) {
      locked += bal;
      if (!lockerName) lockerName = l.name;
    }
  }

  const pct = (v: bigint) => Number((v * 10000n) / total) / 100;
  return { burnedPct: pct(burned), lockedPct: pct(locked), lockerName };
}

/** Bloque en el que se mino una transaccion (para saber cuando se creo el token). */
export async function getTransactionBlock(txHash: string): Promise<number | null> {
  const tx = await rpcCall<{ blockNumber: string } | null>(
    url(),
    PROVIDER,
    'eth_getTransactionByHash',
    [txHash],
  ).catch(() => null);
  return tx?.blockNumber ? Number(BigInt(tx.blockNumber)) : null;
}

/** Transacciones de un bloque, para detectar compras agrupadas (snipers). */
export async function getBlockTimestamp(blockNumber: number): Promise<number | null> {
  const block = await rpcCall<{ timestamp: string } | null>(url(), PROVIDER, 'eth_getBlockByNumber', [
    toHex(blockNumber),
    false,
  ]).catch(() => null);
  return block?.timestamp ? Number(BigInt(block.timestamp)) * 1000 : null;
}
