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
  /** Las 20 mayores cuentas, con su dueno y su porcentaje del suministro. */
  topHolders: Array<{ owner: string; amount: string; pct: number }>;
  totalHolders: number | null;
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
  totalHolders?: number;
  totalMarketLiquidity?: number;
  totalLPProviders?: number;
}

// UN INFORME, DOS USOS
// Lo piden la seguridad y los holders del mismo token casi a la vez. Desde
// que Helius se quedo sin creditos, RugCheck es tambien de donde salen las
// mayores cuentas: se guarda unos minutos para no pedirlo dos veces.
const GUARDAR_MS = 10 * 60_000;
const recientes = new Map<string, { hasta: number; informe: Promise<RugcheckSummary | null> }>();

export function getReport(mint: string): Promise<RugcheckSummary | null> {
  const ahora = Date.now();
  for (const [k, v] of recientes) if (v.hasta < ahora) recientes.delete(k);

  const guardado = recientes.get(mint);
  if (guardado) return guardado.informe;

  const informe = pedirInforme(mint);
  recientes.set(mint, { hasta: ahora + GUARDAR_MS, informe });
  // Un fallo no se guarda: la siguiente peticion lo vuelve a intentar.
  void informe.then((r) => {
    if (!r) recientes.delete(mint);
  });
  return informe;
}

async function pedirInforme(mint: string): Promise<RugcheckSummary | null> {
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

  const topHolders = (res.topHolders ?? [])
    .filter((h) => typeof h.pct === 'number' && (h.owner || h.address))
    .map((h) => ({
      owner: (h.owner || h.address) as string,
      amount: String(h.amount ?? 0),
      pct: h.pct as number,
    }));

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
    topHolderPct: topHolders[0]?.pct ?? null,
    topHolders,
    totalHolders: typeof res.totalHolders === 'number' ? res.totalHolders : null,
    rugged: typeof res.rugged === 'boolean' ? res.rugged : null,
    raw: res,
  };
}
