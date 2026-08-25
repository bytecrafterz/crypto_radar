/**
 * Comprobacion del sistema: verifica que todo lo imprescindible responde.
 *
 *   npm run selftest
 *
 * Sirve para saber en un minuto si algo esta mal configurado, sin tener
 * que esperar a ver si llegan alertas.
 */
import { env, checkEnv } from './core/env.js';
import { validateConfig, getFilters, getScoring, getKnownAddresses } from './core/config.js';
import { base58Encode, base58Decode, isSolanaAddress, isEvmAddress } from './core/util.js';
import { pool } from './core/db.js';
import * as dexscreener from './sources/dexscreener.js';
import * as geckoterminal from './sources/geckoterminal.js';
import * as solana from './sources/solanaRpc.js';
import * as baseRpc from './sources/baseRpc.js';
import * as goplus from './sources/goplus.js';
import * as rugcheck from './sources/rugcheck.js';
import { computeScore } from './scoring/engine.js';
import type { DiscoveredPair } from './core/types.js';

const results: Array<{ name: string; ok: boolean; detail: string }> = [];

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  process.stdout.write(`  ${name} ... `);
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`OK  ${detail}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail });
    console.log(`FALLO  ${detail}`);
  }
}

// Tokens reales conocidos, usados solo para comprobar que las fuentes responden.
const SOL_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

async function main(): Promise<void> {
  console.log('\n=== COMPROBACION DEL CRYPTO RADAR ===\n');

  console.log('Configuracion');
  await check('ficheros de configuracion', async () => {
    const problems = validateConfig();
    if (problems.length > 0) throw new Error(problems.join(' | '));
    const f = getFilters();
    const s = getScoring();
    getKnownAddresses();
    return `${f.discovery.chains.join('+')}, ${Object.keys(s.risk).length} reglas de riesgo, ${Object.keys(s.opportunity).length} de oportunidad`;
  });

  await check('codificacion base58', async () => {
    const decoded = base58Decode(SOL_USDC);
    if (!decoded) throw new Error('no se pudo decodificar');
    const reencoded = base58Encode(decoded);
    if (reencoded !== SOL_USDC) throw new Error(`ida y vuelta incorrecta: ${reencoded}`);
    if (!isSolanaAddress(SOL_USDC)) throw new Error('validacion de direccion Solana incorrecta');
    if (!isEvmAddress(BASE_USDC)) throw new Error('validacion de direccion EVM incorrecta');
    return '32 bytes, ida y vuelta correcta';
  });

  await check('motor de puntuacion', async () => {
    const fake: DiscoveredPair = {
      chain: 'solana',
      tokenAddress: SOL_USDC,
      pairAddress: 'test',
      dex: 'raydium',
      symbol: 'TEST',
      name: 'Token de prueba',
      quoteSymbol: 'SOL',
      quoteAddress: null,
      priceUsd: 0.001,
      liquidityUsd: 50_000,
      fdvUsd: 500_000,
      marketCapUsd: 500_000,
      volumeH24: 120_000,
      volumeH6: 40_000,
      volumeH1: 25_000,
      volumeM5: 3000,
      txnsH24Buys: 400,
      txnsH24Sells: 200,
      txnsH1Buys: 80,
      txnsH1Sells: 30,
      txnsM5Buys: 8,
      txnsM5Sells: 3,
      priceChangeM5: 1,
      priceChangeH1: 12,
      priceChangeH6: 40,
      priceChangeH24: 90,
      pairCreatedAt: Date.now() - 3_600_000,
      website: 'https://ejemplo.com',
      twitter: 'https://x.com/ejemplo',
      telegram: null,
      discord: null,
      imageUrl: null,
      source: 'selftest',
    };

    const score = computeScore({
      pair: fake,
      security: {
        chain: 'solana',
        tokenAddress: SOL_USDC,
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
        isVerified: true,
        buyTaxPct: 0,
        sellTaxPct: 0,
        taxModifiable: false,
        isHoneypot: false,
        canSell: true,
        roundTripLossPct: 1.2,
        lpLockedPct: 100,
        lpBurnedPct: 0,
        lpLockerName: null,
        totalSupply: '1000000000',
        decimals: 9,
        notes: [],
        sources: ['selftest'],
        failedSources: [],
      },
      holders: {
        chain: 'solana',
        tokenAddress: SOL_USDC,
        holdersCount: 500,
        top10Pct: 18,
        top20Pct: 25,
        largestRealPct: 4,
        deployerPct: 1,
        holders: [],
        partial: false,
        note: null,
      },
      deployer: {
        chain: 'solana',
        tokenAddress: SOL_USDC,
        deployer: 'test',
        deployTxHash: null,
        deployedAt: null,
        priorTokens: [],
        priorTokenCount: 0,
        historyVerdict: 'unknown',
        fundedBy: null,
        note: null,
      },
      suspicious: [],
      holderGrowthPerHour: 80,
    });

    if (score.opportunity < 50) {
      throw new Error(`un token limpio deberia puntuar alto y ha dado ${score.opportunity}`);
    }
    if (score.risk > 20) {
      throw new Error(`un token limpio deberia tener riesgo bajo y ha dado ${score.risk}`);
    }
    return `oportunidad ${score.opportunity} (${score.opportunityLabel}), riesgo ${score.risk}, ${score.opportunityReasons.length} motivos`;
  });

  console.log('\nBase de datos');
  await check('conexion a PostgreSQL', async () => {
    const res = await pool.query('SELECT version()');
    return String(res.rows[0].version).split(',')[0];
  });

  await check('tablas creadas', async () => {
    const res = await pool.query(
      "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const n = res.rows[0].n as number;
    if (n < 10) throw new Error(`solo hay ${n} tablas: ejecuta "npm run migrate"`);
    return `${n} tablas`;
  });

  console.log('\nFuentes de datos gratuitas');
  await check('DexScreener', async () => {
    const pairs = await dexscreener.getTokens('solana', [SOL_USDC]);
    if (pairs.length === 0) throw new Error('sin respuesta util');
    return `${pairs[0].symbol}, liquidez ${Math.round(pairs[0].liquidityUsd ?? 0)} USD`;
  });

  await check('DexScreener perfiles nuevos', async () => {
    const profiles = await dexscreener.getLatestProfiles();
    return `${profiles.length} tokens nuevos (solana+base)`;
  });

  await check('GeckoTerminal pools nuevas Solana', async () => {
    const pools = await geckoterminal.getNewPools('solana');
    if (pools.length === 0) throw new Error('sin pools devueltas');
    return `${pools.length} pools`;
  });

  await check('GeckoTerminal pools nuevas Base', async () => {
    const pools = await geckoterminal.getNewPools('base');
    if (pools.length === 0) throw new Error('sin pools devueltas');
    return `${pools.length} pools`;
  });

  console.log('\nAcceso a las cadenas');
  await check(`RPC de Solana (${env.hasHelius ? 'Helius' : 'publico'})`, async () => {
    const mint = await solana.getMintInfo(SOL_USDC);
    if (!mint) throw new Error('no se pudo leer el mint de USDC');
    return `USDC: ${mint.decimals} decimales, mint authority ${mint.mintAuthority ? 'activa' : 'revocada'}`;
  });

  // Se prueba sobre un token nuevo real, no sobre USDC: los tokens muy
  // grandes superan el limite de cuentas por consulta de Solana y darian un
  // fallo enganoso que no dice nada sobre el estado del sistema.
  await check('Solana: concentracion de holders', async () => {
    const perfiles = await dexscreener.getLatestProfiles();
    const candidato = perfiles.find((p) => p.chain === 'solana');
    if (!candidato) throw new Error('no habia ningun token nuevo de Solana para probar');

    const pair = await dexscreener.getToken('solana', candidato.address);
    if (!pair) throw new Error('sin datos de mercado del token de prueba');

    const largest = await solana.getTokenLargestAccounts(pair.tokenAddress);
    if (largest.length === 0) {
      throw new Error(
        env.hasHelius
          ? 'el RPC no devolvio las mayores cuentas'
          : 'el RPC publico bloquea este metodo: hace falta la clave gratuita de Helius',
      );
    }
    const conDueno = largest.filter((a) => a.owner !== null).length;
    return `${pair.symbol}: ${largest.length} cuentas, ${conDueno} con dueno resuelto`;
  });

  await check('Solana: recuento total de holders (DAS)', async () => {
    if (!env.hasHelius) throw new Error('necesita la clave gratuita de Helius');
    const perfiles = await dexscreener.getLatestProfiles();
    const candidato = perfiles.find((p) => p.chain === 'solana');
    if (!candidato) throw new Error('no habia ningun token nuevo de Solana para probar');

    const total = await solana.getHolderCountHelius(candidato.address);
    if (total === null) throw new Error('la API DAS no devolvio el recuento');
    return `${total} holders contados`;
  });

  await check(`RPC de Base (${env.hasAlchemy ? 'Alchemy' : 'publico'})`, async () => {
    const block = await baseRpc.getBlockNumber();
    if (!block) throw new Error('no responde');
    const info = await baseRpc.getErc20Info(BASE_USDC);
    return `bloque ${block}, ${info.symbol ?? '?'} con ${info.decimals ?? '?'} decimales`;
  });

  console.log('\nComprobaciones de seguridad');
  await check('GoPlus (Base)', async () => {
    const res = await goplus.getEvmSecurity(BASE_USDC);
    if (!res) throw new Error('sin respuesta');
    return `honeypot: ${res.isHoneypot === null ? 'n/d' : res.isHoneypot ? 'si' : 'no'}`;
  });

  await check('RugCheck (Solana)', async () => {
    const res = await rugcheck.getReport(SOL_USDC);
    if (!res) throw new Error('sin respuesta');
    return `${res.risks.length} avisos evaluados`;
  });

  console.log('\nAvisos de configuracion');
  const warnings = checkEnv();
  if (warnings.length === 0) {
    console.log('  Ninguno: configuracion completa.');
  } else {
    for (const w of warnings) console.log(`  · ${w}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n=====================================');
  console.log(`${results.length - failed.length} de ${results.length} comprobaciones correctas.`);
  if (failed.length > 0) {
    console.log('\nFallos:');
    for (const f of failed) console.log(`  · ${f.name}: ${f.detail}`);
    console.log(
      '\nNota: los fallos en fuentes externas suelen ser temporales (limite alcanzado o corte puntual).',
    );
  }
  console.log('');

  await pool.end();
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('\nError ejecutando la comprobacion:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
