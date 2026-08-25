/**
 * Honeypot.is - GRATIS, solo cadenas EVM (en nuestro caso Base).
 * Simula una compra y una venta reales para comprobar si se puede vender.
 * Es la comprobacion mas practica contra honeypots.
 * Documentacion: https://api.honeypot.is/
 */
import { request } from '../core/http.js';
import { child } from '../core/logger.js';
import { numOrNull } from '../core/util.js';

const log = child('honeypot');
const CHAIN_ID = 8453;

export interface HoneypotResult {
  isHoneypot: boolean | null;
  reason: string | null;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  transferTaxPct: number | null;
  buyGas: number | null;
  sellGas: number | null;
  maxBuyAmount: number | null;
  maxSellAmount: number | null;
  flags: string[];
  raw: unknown;
}

interface HoneypotRaw {
  honeypotResult?: { isHoneypot?: boolean; honeypotReason?: string };
  simulationSuccess?: boolean;
  simulationError?: string;
  simulationResult?: {
    buyTax?: number;
    sellTax?: number;
    transferTax?: number;
    buyGas?: number | string;
    sellGas?: number | string;
    maxBuy?: { token?: number };
    maxSell?: { token?: number };
  };
  summary?: { risk?: string; riskLevel?: number; flags?: Array<{ flag?: string; description?: string }> };
}

export async function check(address: string, pairAddress?: string): Promise<HoneypotResult | null> {
  const params = new URLSearchParams({ address, chainID: String(CHAIN_ID) });
  if (pairAddress) params.set('pair', pairAddress);

  const res = await request<HoneypotRaw>(`https://api.honeypot.is/v2/IsHoneypot?${params}`, {
    provider: 'honeypot',
    retries: 1,
    timeoutMs: 25_000,
    allow404: true,
  }).catch((err) => {
    log.warn({ address, err: String(err) }, 'Honeypot.is no respondio');
    return null;
  });

  if (!res) return null;

  const sim = res.simulationResult ?? {};
  const flags = (res.summary?.flags ?? [])
    .map((f) => f.flag ?? f.description ?? '')
    .filter((f) => f !== '');

  if (res.simulationSuccess === false) {
    flags.push(`simulacion_fallida: ${res.simulationError ?? 'sin detalle'}`);
  }

  return {
    isHoneypot: res.honeypotResult?.isHoneypot ?? null,
    reason: res.honeypotResult?.honeypotReason ?? null,
    buyTaxPct: numOrNull(sim.buyTax),
    sellTaxPct: numOrNull(sim.sellTax),
    transferTaxPct: numOrNull(sim.transferTax),
    buyGas: numOrNull(sim.buyGas),
    sellGas: numOrNull(sim.sellGas),
    maxBuyAmount: numOrNull(sim.maxBuy?.token),
    maxSellAmount: numOrNull(sim.maxSell?.token),
    flags,
    raw: res,
  };
}
