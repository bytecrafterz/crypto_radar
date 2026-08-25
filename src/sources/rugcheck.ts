/**
 * RugCheck - GRATIS (nivel publico), solo Solana.
 * Sirve de segunda opinion sobre lo que ya leemos de la cadena.
 * Documentacion: https://api.rugcheck.xyz/swagger/index.html
 */
import { request } from '../core/http.js';
import { child } from '../core/logger.js';

const log = child('rugcheck');
const BASE = 'https://api.rugcheck.xyz/v1';

export interface RugcheckSummary {
  score: number | null;
  /** Cuanto mayor, peor. RugCheck lo llama "score_normalised". */
  scoreNormalised: number | null;
  risks: Array<{ name: string; description: string; level: string; score: number }>;
  lpLockedPct: number | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  topHolderPct: number | null;
  rugged: boolean | null;
  raw: unknown;
}

interface RugcheckReport {
  score?: number;
  score_normalised?: number;
  rugged?: boolean;
  risks?: Array<{ name?: string; description?: string; level?: string; score?: number }>;
  token?: { mintAuthority?: string | null; freezeAuthority?: string | null; supply?: number; decimals?: number };
  markets?: Array<{ lp?: { lpLockedPct?: number; lpLocked?: number; lpTotalSupply?: number } }>;
  topHolders?: Array<{ address?: string; pct?: number; owner?: string; amount?: number }>;
  totalMarketLiquidity?: number;
  totalLPProviders?: number;
}

export async function getReport(mint: string): Promise<RugcheckSummary | null> {
  const res = await request<RugcheckReport>(`${BASE}/tokens/${mint}/report`, {
    provider: 'rugcheck',
    retries: 1,
    timeoutMs: 20_000,
    allow404: true,
  }).catch((err) => {
    log.warn({ mint, err: String(err) }, 'RugCheck no respondio');
    return null;
  });

  if (!res) return null;

  const lpPcts = (res.markets ?? [])
    .map((m) => m.lp?.lpLockedPct)
    .filter((v): v is number => typeof v === 'number');
  const lpLockedPct = lpPcts.length > 0 ? Math.max(...lpPcts) : null;

  const topHolderPct =
    Array.isArray(res.topHolders) && res.topHolders.length > 0
      ? (res.topHolders[0].pct ?? null)
      : null;

  return {
    score: typeof res.score === 'number' ? res.score : null,
    scoreNormalised: typeof res.score_normalised === 'number' ? res.score_normalised : null,
    risks: (res.risks ?? []).map((r) => ({
      name: r.name ?? 'desconocido',
      description: r.description ?? '',
      level: r.level ?? 'info',
      score: r.score ?? 0,
    })),
    lpLockedPct,
    mintAuthority: res.token?.mintAuthority ?? null,
    freezeAuthority: res.token?.freezeAuthority ?? null,
    topHolderPct,
    rugged: typeof res.rugged === 'boolean' ? res.rugged : null,
    raw: res,
  };
}
