/**
 * Solana - acceso directo a la cadena por JSON-RPC.
 *
 * Funciona con el RPC gratuito de Helius o con el RPC publico.
 * Todo lo que se lee aqui es verificable por cualquiera en un explorador,
 * que es justo lo que pidio el cliente.
 */
import { rpcCall, rpcBatch, request } from '../core/http.js';
import { env } from '../core/env.js';
import { child } from '../core/logger.js';
import { base58Encode } from '../core/util.js';

const log = child('solana');
const PROVIDER = 'solana_rpc';

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

function url(): string {
  return env.solanaRpcUrl;
}

// --- Informacion del mint -------------------------------------------------

export interface MintInfo {
  address: string;
  decimals: number;
  supply: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  isInitialized: boolean;
  program: 'spl-token' | 'spl-token-2022' | 'desconocido';
  /** El mint ocupa mas de 82 bytes: lleva extensiones de Token-2022. */
  hasExtensions: boolean;
}

interface ParsedMintValue {
  data?: {
    program?: string;
    parsed?: {
      type?: string;
      info?: {
        decimals?: number;
        supply?: string;
        mintAuthority?: string | null;
        freezeAuthority?: string | null;
        isInitialized?: boolean;
      };
    };
    space?: number;
  };
  owner?: string;
  space?: number;
}

/**
 * Lee la cuenta del mint. De aqui salen mint authority y freeze authority,
 * que son las dos comprobaciones de seguridad mas importantes en Solana.
 */
export async function getMintInfo(mint: string): Promise<MintInfo | null> {
  try {
    const res = await rpcCall<{ value: ParsedMintValue | null }>(url(), PROVIDER, 'getAccountInfo', [
      mint,
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ]);
    const value = res?.value;
    if (!value?.data) return null;

    const parsed = value.data.parsed;
    if (parsed?.type === 'mint' && parsed.info) {
      const space = value.data.space ?? value.space ?? 82;
      const programName = value.data.program === 'spl-token-2022' ? 'spl-token-2022' : 'spl-token';
      return {
        address: mint,
        decimals: parsed.info.decimals ?? 0,
        supply: parsed.info.supply ?? '0',
        mintAuthority: parsed.info.mintAuthority ?? null,
        freezeAuthority: parsed.info.freezeAuthority ?? null,
        isInitialized: parsed.info.isInitialized ?? true,
        program: programName,
        hasExtensions: programName === 'spl-token-2022' && space > 82,
      };
    }
    return null;
  } catch (err) {
    log.warn({ mint, err: String(err) }, 'no se pudo leer el mint con jsonParsed, probando en crudo');
    return getMintInfoRaw(mint);
  }
}

/**
 * Lectura manual del mint por si el RPC no soporta jsonParsed.
 * Estructura del mint SPL (82 bytes):
 *   0-4   opcion de mint authority (u32)
 *   4-36  mint authority (32 bytes)
 *   36-44 suministro (u64 little endian)
 *   44    decimales (u8)
 *   45    inicializado (u8)
 *   46-50 opcion de freeze authority (u32)
 *   50-82 freeze authority (32 bytes)
 */
export async function getMintInfoRaw(mint: string): Promise<MintInfo | null> {
  const res = await rpcCall<{ value: { data?: [string, string]; owner?: string } | null }>(
    url(),
    PROVIDER,
    'getAccountInfo',
    [mint, { encoding: 'base64', commitment: 'confirmed' }],
  ).catch(() => null);

  const raw = res?.value?.data?.[0];
  if (!raw) return null;
  const buf = Buffer.from(raw, 'base64');
  if (buf.length < 82) return null;

  const mintAuthOption = buf.readUInt32LE(0);
  const mintAuthority = mintAuthOption === 1 ? base58Encode(buf.subarray(4, 36)) : null;
  const supply = buf.readBigUInt64LE(36).toString();
  const decimals = buf.readUInt8(44);
  const isInitialized = buf.readUInt8(45) === 1;
  const freezeAuthOption = buf.readUInt32LE(46);
  const freezeAuthority = freezeAuthOption === 1 ? base58Encode(buf.subarray(50, 82)) : null;

  const owner = res?.value?.owner ?? '';
  const program =
    owner === TOKEN_2022_PROGRAM ? 'spl-token-2022' : owner === TOKEN_PROGRAM ? 'spl-token' : 'desconocido';

  return {
    address: mint,
    decimals,
    supply,
    mintAuthority,
    freezeAuthority,
    isInitialized,
    program,
    hasExtensions: program === 'spl-token-2022' && buf.length > 82,
  };
}

// --- Holders --------------------------------------------------------------

export interface LargestAccount {
  /** Direccion de la cuenta de token (no es el dueno). */
  tokenAccount: string;
  amount: string;
  uiAmount: number;
  decimals: number;
  /** Dueno real de esa cuenta de token. */
  owner: string | null;
}

/**
 * Las 20 mayores cuentas de token en UNA sola llamada RPC.
 * Es la forma mas barata de medir concentracion en Solana.
 * Despues resolvemos los duenos con una segunda llamada por lotes.
 */
export async function getTokenLargestAccounts(mint: string): Promise<LargestAccount[]> {
  const res = await rpcCall<{
    value: Array<{ address: string; amount: string; decimals: number; uiAmount: number }>;
  }>(url(), PROVIDER, 'getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]).catch(
    (err) => {
      log.warn({ mint, err: String(err) }, 'getTokenLargestAccounts fallo');
      return null;
    },
  );

  const accounts = res?.value ?? [];
  if (accounts.length === 0) return [];

  // Resolvemos los duenos de esas cuentas de token.
  const owners = await getTokenAccountOwners(accounts.map((a) => a.address));

  return accounts.map((a) => ({
    tokenAccount: a.address,
    amount: a.amount,
    uiAmount: a.uiAmount ?? 0,
    decimals: a.decimals ?? 0,
    owner: owners.get(a.address) ?? null,
  }));
}

/** Dueno de cada cuenta de token, en una sola llamada. */
export async function getTokenAccountOwners(
  tokenAccounts: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (tokenAccounts.length === 0) return out;

  const res = await rpcCall<{
    value: Array<{ data?: { parsed?: { info?: { owner?: string } } } } | null>;
  }>(url(), PROVIDER, 'getMultipleAccounts', [
    tokenAccounts.slice(0, 100),
    { encoding: 'jsonParsed', commitment: 'confirmed' },
  ]).catch(() => null);

  const values = res?.value ?? [];
  values.forEach((v, i) => {
    const owner = v?.data?.parsed?.info?.owner;
    const account = tokenAccounts[i];
    if (owner && account) out.set(account, owner);
  });
  return out;
}

export async function getTokenSupply(
  mint: string,
): Promise<{ amount: string; decimals: number; uiAmount: number } | null> {
  const res = await rpcCall<{ value: { amount: string; decimals: number; uiAmount: number } }>(
    url(),
    PROVIDER,
    'getTokenSupply',
    [mint, { commitment: 'confirmed' }],
  ).catch(() => null);
  return res?.value ?? null;
}

/**
 * Numero total de holders usando la API DAS de Helius (solo con clave).
 * Sin clave devolvemos null: preferimos no dar un dato inventado.
 */
export async function getHolderCountHelius(mint: string, maxPages = 5): Promise<number | null> {
  if (!env.hasHelius) return null;
  const endpoint = `https://mainnet.helius-rpc.com/?api-key=${env.heliusKey}`;
  const owners = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const res = await rpcCall<{
      token_accounts?: Array<{ owner?: string; amount?: number | string }>;
      cursor?: string;
    }>(endpoint, PROVIDER, 'getTokenAccounts', {
      mint,
      limit: 1000,
      options: { showZeroBalance: false },
      ...(cursor ? { cursor } : {}),
    }).catch((err) => {
      log.warn({ mint, err: String(err) }, 'getTokenAccounts (Helius) fallo');
      return null;
    });

    const accounts = res?.token_accounts ?? [];
    for (const acc of accounts) {
      if (acc.owner && Number(acc.amount ?? 0) > 0) owners.add(acc.owner);
    }
    if (accounts.length < 1000 || !res?.cursor) break;
    cursor = res.cursor;
  }

  return owners.size > 0 ? owners.size : null;
}

/**
 * Todas las cuentas de token con saldo, para calcular concentracion exacta.
 * Solo con Helius: en el RPC publico getProgramAccounts esta desactivado.
 */
export async function getAllHoldersHelius(
  mint: string,
  maxPages = 5,
): Promise<Array<{ owner: string; amount: bigint }> | null> {
  if (!env.hasHelius) return null;
  const endpoint = `https://mainnet.helius-rpc.com/?api-key=${env.heliusKey}`;
  const totals = new Map<string, bigint>();
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const res = await rpcCall<{
      token_accounts?: Array<{ owner?: string; amount?: number | string }>;
      cursor?: string;
    }>(endpoint, PROVIDER, 'getTokenAccounts', {
      mint,
      limit: 1000,
      options: { showZeroBalance: false },
      ...(cursor ? { cursor } : {}),
    }).catch(() => null);

    const accounts = res?.token_accounts ?? [];
    for (const acc of accounts) {
      if (!acc.owner) continue;
      let amount: bigint;
      try {
        amount = BigInt(String(acc.amount ?? '0').split('.')[0]);
      } catch {
        continue;
      }
      if (amount <= 0n) continue;
      totals.set(acc.owner, (totals.get(acc.owner) ?? 0n) + amount);
    }
    if (accounts.length < 1000 || !res?.cursor) break;
    cursor = res.cursor;
  }

  if (totals.size === 0) return null;
  return [...totals.entries()]
    .map(([owner, amount]) => ({ owner, amount }))
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
}

// --- Creador / deployer ---------------------------------------------------

export interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
}

export async function getSignatures(
  address: string,
  opts: { limit?: number; before?: string; until?: string } = {},
): Promise<SignatureInfo[]> {
  const params: Record<string, unknown> = { limit: opts.limit ?? 1000, commitment: 'confirmed' };
  if (opts.before) params.before = opts.before;
  if (opts.until) params.until = opts.until;

  const res = await rpcCall<SignatureInfo[]>(url(), PROVIDER, 'getSignaturesForAddress', [
    address,
    params,
  ]).catch((err) => {
    log.warn({ address, err: String(err) }, 'getSignaturesForAddress fallo');
    return null;
  });
  return res ?? [];
}

/**
 * Primera transaccion del mint = transaccion de creacion.
 * Se pagina hacia atras hasta llegar al final (limitado para no gastar de mas).
 */
export async function getOldestSignature(
  address: string,
  maxPages = 4,
): Promise<SignatureInfo | null> {
  let before: string | undefined;
  let oldest: SignatureInfo | null = null;

  for (let page = 0; page < maxPages; page++) {
    const sigs = await getSignatures(address, { limit: 1000, before });
    if (sigs.length === 0) break;
    oldest = sigs[sigs.length - 1];
    if (sigs.length < 1000) break;
    before = oldest.signature;
  }
  return oldest;
}

export interface TxSummary {
  signature: string;
  blockTime: number | null;
  slot: number;
  /** Firmantes de la transaccion. El primero paga las comisiones. */
  signers: string[];
  logMessages: string[];
}

export async function getTransaction(signature: string): Promise<TxSummary | null> {
  const res = await rpcCall<{
    slot: number;
    blockTime: number | null;
    transaction?: { message?: { accountKeys?: Array<{ pubkey: string; signer: boolean }> } };
    meta?: { logMessages?: string[] };
  }>(url(), PROVIDER, 'getTransaction', [
    signature,
    { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
  ]).catch(() => null);

  if (!res) return null;
  const keys = res.transaction?.message?.accountKeys ?? [];
  return {
    signature,
    blockTime: res.blockTime ?? null,
    slot: res.slot,
    signers: keys.filter((k) => k.signer).map((k) => k.pubkey),
    logMessages: res.meta?.logMessages ?? [],
  };
}

/**
 * Identifica quien creo el mint: se busca la transaccion mas antigua
 * del mint y se toma el primer firmante (el que pago).
 */
export async function findDeployer(
  mint: string,
): Promise<{ deployer: string | null; txHash: string | null; deployedAt: number | null }> {
  const oldest = await getOldestSignature(mint);
  if (!oldest) return { deployer: null, txHash: null, deployedAt: null };

  const tx = await getTransaction(oldest.signature);
  const deployer = tx?.signers?.[0] ?? null;
  return {
    deployer,
    txHash: oldest.signature,
    deployedAt: (tx?.blockTime ?? oldest.blockTime) ? (tx?.blockTime ?? oldest.blockTime)! * 1000 : null,
  };
}

/**
 * Transacciones enriquecidas de Helius: ya vienen interpretadas
 * (quien compro, cuanto, en que dex). Ahorra muchisimo trabajo.
 * Solo disponible con clave de Helius.
 */
export interface EnrichedTx {
  signature: string;
  timestamp: number;
  type: string;
  source: string;
  feePayer: string;
  description: string;
  tokenTransfers: Array<{
    fromUserAccount?: string;
    toUserAccount?: string;
    mint?: string;
    tokenAmount?: number;
  }>;
  nativeTransfers: Array<{ fromUserAccount?: string; toUserAccount?: string; amount?: number }>;
}

export async function getEnrichedTransactions(
  address: string,
  opts: { limit?: number; before?: string; type?: string } = {},
): Promise<EnrichedTx[] | null> {
  if (!env.hasHelius) return null;
  const params = new URLSearchParams({ 'api-key': env.heliusKey });
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.before) params.set('before', opts.before);
  if (opts.type) params.set('type', opts.type);

  const res = await request<EnrichedTx[]>(
    `https://api.helius.xyz/v0/addresses/${address}/transactions?${params.toString()}`,
    { provider: PROVIDER, retries: 1, timeoutMs: 25_000 },
  ).catch((err) => {
    log.warn({ address, err: String(err) }, 'transacciones enriquecidas de Helius fallaron');
    return null;
  });

  return Array.isArray(res) ? res : null;
}

/** Balance en SOL de una direccion (para ver si el creador tiene fondos). */
export async function getBalance(address: string): Promise<number | null> {
  const res = await rpcCall<{ value: number }>(url(), PROVIDER, 'getBalance', [
    address,
    { commitment: 'confirmed' },
  ]).catch(() => null);
  return res ? res.value / 1e9 : null;
}

/** Varias cuentas a la vez, para no gastar una llamada por cada una. */
export async function getMultipleBalances(addresses: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (addresses.length === 0) return out;
  const results = await rpcBatch<{ value: number }>(
    url(),
    PROVIDER,
    addresses.slice(0, 50).map((a) => ({ method: 'getBalance', params: [a, { commitment: 'confirmed' }] })),
  );
  results.forEach((r, i) => {
    const addr = addresses[i];
    if (r && addr) out.set(addr, r.value / 1e9);
  });
  return out;
}
