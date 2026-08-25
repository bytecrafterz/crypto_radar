/**
 * Tipos compartidos por todo el sistema.
 */

export type Chain = 'solana' | 'base';

/** Par/pool tal y como lo devuelven los agregadores (normalizado). */
export interface DiscoveredPair {
  chain: Chain;
  /** Direccion del token (mint en Solana, contrato en Base). */
  tokenAddress: string;
  /** Direccion del pool / par. */
  pairAddress: string;
  dex: string;
  symbol: string;
  name: string;
  quoteSymbol: string;
  quoteAddress: string | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  volumeH24: number | null;
  volumeH6: number | null;
  volumeH1: number | null;
  volumeM5: number | null;
  txnsH24Buys: number | null;
  txnsH24Sells: number | null;
  txnsH1Buys: number | null;
  txnsH1Sells: number | null;
  txnsM5Buys: number | null;
  txnsM5Sells: number | null;
  priceChangeM5: number | null;
  priceChangeH1: number | null;
  priceChangeH6: number | null;
  priceChangeH24: number | null;
  /** Momento de creacion del par (ms epoch) si la fuente lo da. */
  pairCreatedAt: number | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  discord: string | null;
  imageUrl: string | null;
  source: string;
}

/** Resultado del analisis de seguridad del token/contrato. */
export interface SecurityReport {
  chain: Chain;
  tokenAddress: string;
  /** Solana: mint authority activa. Base: puede acunar mas suministro. */
  mintAuthorityActive: boolean;
  mintAuthority: string | null;
  freezeAuthorityActive: boolean;
  freezeAuthority: string | null;
  /** Solana: el mint usa el programa Token-2022. */
  isToken2022: boolean;
  hasToken2022Extensions: boolean;
  /** Base: el contrato conserva un owner con poder. */
  ownerCanModify: boolean;
  ownerAddress: string | null;
  hasBlacklist: boolean;
  hasMintFunction: boolean;
  isProxy: boolean;
  isVerified: boolean | null;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  taxModifiable: boolean;
  isHoneypot: boolean | null;
  /** Solana: ¿existe ruta de venta segun Jupiter? null = no comprobado. */
  canSell: boolean | null;
  /** Coste real de comprar y vender de inmediato, en % (cotizacion real). */
  roundTripLossPct: number | null;
  /** Porcentaje de LP quemado o bloqueado (0-100). null = desconocido. */
  lpLockedPct: number | null;
  lpBurnedPct: number | null;
  lpLockerName: string | null;
  totalSupply: string | null;
  decimals: number | null;
  /** Notas legibles generadas por cada comprobacion. */
  notes: string[];
  /** Fuentes que respondieron correctamente. */
  sources: string[];
  /** Fuentes que fallaron (para saber que dato falta). */
  failedSources: string[];
}

export interface HolderEntry {
  address: string;
  balance: string;
  pct: number;
  /** pool | burn | deployer | custodian | wallet */
  tag: string;
}

export interface HolderReport {
  chain: Chain;
  tokenAddress: string;
  /** Numero total de holders. null si no se pudo calcular. */
  holdersCount: number | null;
  /** Concentracion del top 10 EXCLUYENDO pools, quemado y custodios. */
  top10Pct: number | null;
  top20Pct: number | null;
  /** Mayor holder real (sin contar pool/quemado). */
  largestRealPct: number | null;
  deployerPct: number | null;
  holders: HolderEntry[];
  /** true si la lista es parcial (por ejemplo solo el top 20). */
  partial: boolean;
  note: string | null;
}

export interface DeployerReport {
  chain: Chain;
  tokenAddress: string;
  deployer: string | null;
  deployTxHash: string | null;
  deployedAt: number | null;
  /** Otros tokens creados por la misma direccion, si se pudieron ver. */
  priorTokens: Array<{ address: string; symbol: string | null; outcome: string | null }>;
  priorTokenCount: number;
  /** rugged | ok | unknown */
  historyVerdict: 'bad' | 'good' | 'unknown';
  fundedBy: string | null;
  note: string | null;
}

export interface SuspiciousEvent {
  kind:
    | 'sniper_cluster'
    | 'wash_trading'
    | 'volume_without_holders'
    | 'sell_pressure'
    | 'liquidity_removed'
    | 'price_crash'
    | 'deployer_sold'
    | 'bot_pattern';
  severity: 'info' | 'warn' | 'danger';
  detail: string;
  data?: Record<string, unknown>;
}

export interface ScoreReason {
  code: string;
  points: number;
  /** Texto en espanol que se muestra al usuario. */
  text: string;
}

export interface ScoreResult {
  opportunity: number;
  risk: number;
  /** Vetos criticos disparados. Si hay alguno, el token queda bloqueado. */
  criticalVetoes: Array<{ code: string; text: string }>;
  /** false si faltan comprobaciones criticas: el sistema dice "no lo se". */
  evaluable: boolean;
  /** verde = valida, amarillo = vigilar, rojo = condicion critica. */
  light: "verde" | "amarillo" | "rojo";
  /** Impacto estimado de nuestra propia operacion. */
  execution: { tradeUsd: number; roundTripPct: number; maxTradeUsd: number; note: string } | null;
  opportunityLabel: string;
  riskLabel: string;
  /** true si el riesgo veta el envio de la alerta. */
  vetoed: boolean;
  opportunityReasons: ScoreReason[];
  riskReasons: ScoreReason[];
  /** Datos incompletos: que falto por analizar. */
  missingData: string[];
}

/** Todo lo que se sabe de un token en un momento dado. */
export interface TokenAnalysis {
  pair: DiscoveredPair;
  security: SecurityReport | null;
  holders: HolderReport | null;
  deployer: DeployerReport | null;
  suspicious: SuspiciousEvent[];
  score: ScoreResult | null;
  /** Variacion de liquidez respecto a la primera medicion (%). */
  liquidityChangePct: number | null;
  /** Holders nuevos por hora, calculado con el historico. */
  holderGrowthPerHour: number | null;
}

export interface TokenRow {
  id: number;
  chain: Chain;
  address: string;
  pair_address: string | null;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  dex: string | null;
  deployer: string | null;
  pair_created_at: Date | null;
  first_seen: Date;
  last_seen: Date;
  status: string;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  discord: string | null;
  last_opportunity: number | null;
  last_risk: number | null;
  peak_liquidity_usd: number | null;
  peak_market_cap_usd: number | null;
  first_liquidity_usd: number | null;
  first_market_cap_usd: number | null;
  alerted_at: Date | null;
  tracked_until: Date | null;
}
