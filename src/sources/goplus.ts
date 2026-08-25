/**
 * GoPlus Security - GRATIS (con limite), cubre Base y Solana.
 * Detecta honeypots, comisiones, blacklists, proxies y permisos del owner.
 * Documentacion: https://docs.gopluslabs.io/reference/
 */
import { request } from '../core/http.js';
import { child } from '../core/logger.js';
import { numOrNull } from '../core/util.js';

const log = child('goplus');
const BASE = 'https://api.gopluslabs.io/api/v1';
const BASE_CHAIN_ID = '8453';

export interface GoPlusEvm {
  isHoneypot: boolean | null;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  isMintable: boolean | null;
  isProxy: boolean | null;
  canTakeBackOwnership: boolean | null;
  ownerChangeBalance: boolean | null;
  hasBlacklist: boolean | null;
  hasWhitelist: boolean | null;
  slippageModifiable: boolean | null;
  transferPausable: boolean | null;
  isOpenSource: boolean | null;
  isAntiWhale: boolean | null;
  antiWhaleModifiable: boolean | null;
  ownerAddress: string | null;
  creatorAddress: string | null;
  creatorPercent: number | null;
  ownerPercent: number | null;
  lpHolderCount: number | null;
  lpTotalSupply: number | null;
  holderCount: number | null;
  totalSupply: string | null;
  /** Porcentaje de LP en manos de direcciones bloqueadas segun GoPlus. */
  lpLockedPct: number | null;
  trustList: boolean | null;
  raw: unknown;
}

const flag = (v: unknown): boolean | null => {
  if (v === '1' || v === 1 || v === true) return true;
  if (v === '0' || v === 0 || v === false) return false;
  return null;
};

interface GoPlusEvmRaw {
  is_honeypot?: string;
  buy_tax?: string;
  sell_tax?: string;
  is_mintable?: string;
  is_proxy?: string;
  can_take_back_ownership?: string;
  owner_change_balance?: string;
  is_blacklisted?: string;
  is_whitelisted?: string;
  slippage_modifiable?: string;
  transfer_pausable?: string;
  is_open_source?: string;
  is_anti_whale?: string;
  anti_whale_modifiable?: string;
  owner_address?: string;
  creator_address?: string;
  creator_percent?: string;
  owner_percent?: string;
  lp_holder_count?: string;
  lp_total_supply?: string;
  holder_count?: string;
  total_supply?: string;
  trust_list?: string;
  lp_holders?: Array<{ address?: string; percent?: string; is_locked?: number; tag?: string }>;
}

/** Analisis de seguridad de un token en Base. */
export async function getEvmSecurity(address: string): Promise<GoPlusEvm | null> {
  const url = `${BASE}/token_security/${BASE_CHAIN_ID}?contract_addresses=${address.toLowerCase()}`;
  const res = await request<{ code?: number; message?: string; result?: Record<string, GoPlusEvmRaw> }>(
    url,
    { provider: 'goplus', retries: 1, timeoutMs: 20_000 },
  ).catch((err) => {
    log.warn({ address, err: String(err) }, 'GoPlus (Base) no respondio');
    return null;
  });

  const data = res?.result?.[address.toLowerCase()];
  if (!data) return null;

  // Porcentaje de LP bloqueado segun las etiquetas de GoPlus.
  let lpLockedPct: number | null = null;
  if (Array.isArray(data.lp_holders)) {
    let locked = 0;
    let any = false;
    for (const h of data.lp_holders) {
      const pct = numOrNull(h.percent);
      if (pct === null) continue;
      any = true;
      if (h.is_locked === 1) locked += pct * 100;
    }
    if (any) lpLockedPct = Math.min(100, locked);
  }

  return {
    isHoneypot: flag(data.is_honeypot),
    buyTaxPct: numOrNull(data.buy_tax) !== null ? numOrNull(data.buy_tax)! * 100 : null,
    sellTaxPct: numOrNull(data.sell_tax) !== null ? numOrNull(data.sell_tax)! * 100 : null,
    isMintable: flag(data.is_mintable),
    isProxy: flag(data.is_proxy),
    canTakeBackOwnership: flag(data.can_take_back_ownership),
    ownerChangeBalance: flag(data.owner_change_balance),
    hasBlacklist: flag(data.is_blacklisted),
    hasWhitelist: flag(data.is_whitelisted),
    slippageModifiable: flag(data.slippage_modifiable),
    transferPausable: flag(data.transfer_pausable),
    isOpenSource: flag(data.is_open_source),
    isAntiWhale: flag(data.is_anti_whale),
    antiWhaleModifiable: flag(data.anti_whale_modifiable),
    ownerAddress: data.owner_address ?? null,
    creatorAddress: data.creator_address ?? null,
    creatorPercent: numOrNull(data.creator_percent) !== null ? numOrNull(data.creator_percent)! * 100 : null,
    ownerPercent: numOrNull(data.owner_percent) !== null ? numOrNull(data.owner_percent)! * 100 : null,
    lpHolderCount: numOrNull(data.lp_holder_count),
    lpTotalSupply: numOrNull(data.lp_total_supply),
    holderCount: numOrNull(data.holder_count),
    totalSupply: data.total_supply ?? null,
    lpLockedPct,
    trustList: flag(data.trust_list),
    raw: data,
  };
}

export interface GoPlusSolana {
  mintAuthority: boolean | null;
  freezeAuthority: boolean | null;
  transferFeeUpgradable: boolean | null;
  transferHookUpgradable: boolean | null;
  defaultAccountStateUpgradable: boolean | null;
  closable: boolean | null;
  balanceMutable: boolean | null;
  nonTransferable: boolean | null;
  metadataMutable: boolean | null;
  holderCount: number | null;
  totalSupply: string | null;
  raw: unknown;
}

interface GoPlusSolRaw {
  mintable?: { status?: string; authority?: unknown[] };
  freezable?: { status?: string; authority?: unknown[] };
  transfer_fee_upgradable?: { status?: string };
  transfer_hook_upgradable?: { status?: string };
  default_account_state_upgradable?: { status?: string };
  closable?: { status?: string };
  balance_mutable_authority?: { status?: string };
  non_transferable?: string;
  metadata_mutable?: { status?: string };
  holder_count?: string | number;
  total_supply?: string;
}

/** Analisis de seguridad de un token en Solana. */
export async function getSolanaSecurity(mint: string): Promise<GoPlusSolana | null> {
  const url = `${BASE}/solana/token_security?contract_addresses=${mint}`;
  const res = await request<{ code?: number; result?: Record<string, GoPlusSolRaw> }>(url, {
    provider: 'goplus_solana',
    retries: 1,
    // Espera corta a proposito: este endpoint se cae con frecuencia y no merece
    // la pena retrasar el analisis entero por una segunda opinion.
    timeoutMs: 8_000,
  }).catch((err) => {
    log.warn({ mint, err: String(err) }, 'GoPlus (Solana) no respondio');
    return null;
  });

  const data = res?.result?.[mint];
  if (!data) return null;

  return {
    mintAuthority: flag(data.mintable?.status),
    freezeAuthority: flag(data.freezable?.status),
    transferFeeUpgradable: flag(data.transfer_fee_upgradable?.status),
    transferHookUpgradable: flag(data.transfer_hook_upgradable?.status),
    defaultAccountStateUpgradable: flag(data.default_account_state_upgradable?.status),
    closable: flag(data.closable?.status),
    balanceMutable: flag(data.balance_mutable_authority?.status),
    nonTransferable: flag(data.non_transferable),
    metadataMutable: flag(data.metadata_mutable?.status),
    holderCount: numOrNull(data.holder_count),
    totalSupply: data.total_supply ?? null,
    raw: data,
  };
}
