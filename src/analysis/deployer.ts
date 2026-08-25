/**
 * Creador / deployer del token.
 *
 * Se identifica la direccion que creo el token y se mira su historial:
 * que tokens lanzo antes y como acabaron. El historial se construye con
 * nuestra propia base de datos (por eso guardamos todo desde el primer dia)
 * y, en Base, tambien con los contratos anteriores que devuelve Basescan.
 */
import type { DiscoveredPair, DeployerReport } from '../core/types.js';
import { child } from '../core/logger.js';
import { query } from '../core/db.js';
import * as solana from '../sources/solanaRpc.js';
import * as basescan from '../sources/basescan.js';
import * as goplus from '../sources/goplus.js';

const log = child('deployer');

interface PriorTokenRow {
  address: string;
  symbol: string | null;
  outcome: string | null;
  rugged: boolean | null;
  peak_multiple: number | null;
}

/** Busca en nuestro historico otros tokens del mismo creador. */
async function priorTokensFromDb(
  chain: string,
  deployer: string,
  excludeAddress: string,
): Promise<PriorTokenRow[]> {
  return query<PriorTokenRow>(
    `SELECT t.address, t.symbol, o.outcome, o.rugged, o.peak_multiple
       FROM tokens t
       LEFT JOIN token_outcomes o ON o.token_id = t.id
      WHERE t.chain = $1 AND lower(t.deployer) = lower($2) AND t.address <> $3
      ORDER BY t.first_seen DESC
      LIMIT 25`,
    [chain, deployer, excludeAddress],
  );
}

function verdictFrom(priors: PriorTokenRow[]): 'bad' | 'good' | 'unknown' {
  if (priors.length === 0) return 'unknown';
  const rugged = priors.filter((p) => p.rugged === true || p.outcome === 'rug').length;
  const success = priors.filter((p) => p.outcome === 'exito').length;
  if (rugged > 0) return 'bad';
  if (success > 0) return 'good';
  return 'unknown';
}

// --------------------------------------------------------------------------
//  SOLANA
// --------------------------------------------------------------------------

export async function analyzeSolanaDeployer(pair: DiscoveredPair): Promise<DeployerReport> {
  const report: DeployerReport = {
    chain: 'solana',
    tokenAddress: pair.tokenAddress,
    deployer: null,
    deployTxHash: null,
    deployedAt: null,
    priorTokens: [],
    priorTokenCount: 0,
    historyVerdict: 'unknown',
    fundedBy: null,
    note: null,
  };

  const found = await solana.findDeployer(pair.tokenAddress).catch((err) => {
    log.warn({ token: pair.tokenAddress, err: String(err) }, 'no se pudo identificar al creador');
    return null;
  });

  if (!found?.deployer) {
    report.note = 'No se pudo identificar la transaccion de creacion del token.';
    return report;
  }

  report.deployer = found.deployer;
  report.deployTxHash = found.txHash;
  report.deployedAt = found.deployedAt;

  // Quien financio al creador: primera entrada de SOL en su cuenta.
  const enriched = await solana.getEnrichedTransactions(found.deployer, { limit: 100 });
  if (enriched && enriched.length > 0) {
    const oldest = enriched[enriched.length - 1];
    const incoming = oldest.nativeTransfers?.find((t) => t.toUserAccount === found.deployer);
    if (incoming?.fromUserAccount) {
      report.fundedBy = incoming.fromUserAccount;
    }
  }

  const priors = await priorTokensFromDb('solana', found.deployer, pair.tokenAddress);
  report.priorTokens = priors.map((p) => ({
    address: p.address,
    symbol: p.symbol,
    outcome: p.outcome ?? (p.rugged ? 'rug' : null),
  }));
  report.priorTokenCount = priors.length;
  report.historyVerdict = verdictFrom(priors);

  report.note =
    priors.length === 0
      ? 'Sin tokens anteriores de este creador en nuestro historico.'
      : `${priors.length} token(s) anteriores del mismo creador en nuestro historico.`;

  return report;
}

// --------------------------------------------------------------------------
//  BASE
// --------------------------------------------------------------------------

export async function analyzeBaseDeployer(pair: DiscoveredPair): Promise<DeployerReport> {
  const report: DeployerReport = {
    chain: 'base',
    tokenAddress: pair.tokenAddress,
    deployer: null,
    deployTxHash: null,
    deployedAt: null,
    priorTokens: [],
    priorTokenCount: 0,
    historyVerdict: 'unknown',
    fundedBy: null,
    note: null,
  };

  // Basescan da directamente quien creo el contrato.
  const creation = await basescan.getContractCreator(pair.tokenAddress).catch(() => null);
  if (creation?.contractCreator) {
    report.deployer = creation.contractCreator;
    report.deployTxHash = creation.txHash || null;
  } else {
    // Alternativa sin clave de Basescan: GoPlus tambien devuelve el creador.
    const gp = await goplus.getEvmSecurity(pair.tokenAddress).catch(() => null);
    if (gp?.creatorAddress) {
      report.deployer = gp.creatorAddress.toLowerCase();
      report.note = 'Creador obtenido de GoPlus (sin clave de Basescan).';
    }
  }

  if (!report.deployer) {
    report.note = 'No se pudo identificar al creador del contrato.';
    return report;
  }

  // Quien financio al creador: primera transaccion entrante.
  const txs = await basescan.getAccountTxs(report.deployer, 10).catch(() => []);
  const firstIncoming = txs.find(
    (t) => t.to?.toLowerCase() === report.deployer && Number(t.value) > 0,
  );
  if (firstIncoming) report.fundedBy = firstIncoming.from.toLowerCase();
  if (txs.length > 0) {
    const ts = Number(txs[0].timeStamp);
    if (Number.isFinite(ts)) report.deployedAt = ts * 1000;
  }

  // Contratos anteriores creados por la misma direccion.
  const priorContracts = await basescan.getPriorDeployments(report.deployer, 100).catch(() => []);
  const others = priorContracts.filter((c) => c !== pair.tokenAddress.toLowerCase());

  const priorsDb = await priorTokensFromDb('base', report.deployer, pair.tokenAddress);
  const seen = new Set(priorsDb.map((p) => p.address.toLowerCase()));

  report.priorTokens = [
    ...priorsDb.map((p) => ({
      address: p.address,
      symbol: p.symbol,
      outcome: p.outcome ?? (p.rugged ? 'rug' : null),
    })),
    ...others
      .filter((c) => !seen.has(c))
      .slice(0, 10)
      .map((c) => ({ address: c, symbol: null, outcome: null })),
  ];
  report.priorTokenCount = report.priorTokens.length;
  report.historyVerdict = verdictFrom(priorsDb);

  const notes: string[] = [];
  if (report.note) notes.push(report.note);
  if (report.priorTokenCount === 0) {
    notes.push('Primera vez que vemos a este creador.');
  } else {
    notes.push(
      `El creador ha desplegado ${report.priorTokenCount} contrato(s) mas${priorsDb.length > 0 ? `, ${priorsDb.length} analizados por nosotros` : ''}.`,
    );
  }
  report.note = notes.join(' ');

  return report;
}

export async function analyzeDeployer(pair: DiscoveredPair): Promise<DeployerReport> {
  try {
    return pair.chain === 'solana'
      ? await analyzeSolanaDeployer(pair)
      : await analyzeBaseDeployer(pair);
  } catch (err) {
    log.error({ token: pair.tokenAddress, err: String(err) }, 'fallo el analisis del creador');
    return {
      chain: pair.chain,
      tokenAddress: pair.tokenAddress,
      deployer: null,
      deployTxHash: null,
      deployedAt: null,
      priorTokens: [],
      priorTokenCount: 0,
      historyVerdict: 'unknown',
      fundedBy: null,
      note: `Error analizando al creador: ${String(err)}`,
    };
  }
}
