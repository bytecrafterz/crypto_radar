-- ==========================================================
--  Esquema inicial del Crypto Radar
--  Todo lo que el sistema ve se guarda aqui desde el primer dia.
-- ==========================================================

-- Tokens detectados -------------------------------------------------------
CREATE TABLE IF NOT EXISTS tokens (
  id                    BIGSERIAL PRIMARY KEY,
  chain                 TEXT NOT NULL,
  address               TEXT NOT NULL,
  pair_address          TEXT,
  symbol                TEXT,
  name                  TEXT,
  decimals              INTEGER,
  dex                   TEXT,
  quote_symbol          TEXT,
  deployer              TEXT,
  pair_created_at       TIMESTAMPTZ,
  first_seen            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen             TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- nuevo | analizando | vigilado | alertado | descartado | archivado | peligro
  status                TEXT NOT NULL DEFAULT 'nuevo',
  discard_reason        TEXT,
  website               TEXT,
  twitter               TEXT,
  telegram              TEXT,
  discord               TEXT,
  image_url             TEXT,
  last_opportunity      NUMERIC(5,1),
  last_risk             NUMERIC(5,1),
  first_liquidity_usd   NUMERIC(20,2),
  first_market_cap_usd  NUMERIC(20,2),
  first_price_usd       NUMERIC(30,15),
  peak_liquidity_usd    NUMERIC(20,2),
  peak_market_cap_usd   NUMERIC(20,2),
  peak_price_usd        NUMERIC(30,15),
  last_price_usd        NUMERIC(30,15),
  last_liquidity_usd    NUMERIC(20,2),
  last_market_cap_usd   NUMERIC(20,2),
  enriched_at           TIMESTAMPTZ,
  alerted_at            TIMESTAMPTZ,
  tracked_until         TIMESTAMPTZ,
  UNIQUE (chain, address)
);

CREATE INDEX IF NOT EXISTS idx_tokens_status      ON tokens (status);
CREATE INDEX IF NOT EXISTS idx_tokens_first_seen  ON tokens (first_seen DESC);
CREATE INDEX IF NOT EXISTS idx_tokens_tracked     ON tokens (tracked_until) WHERE tracked_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tokens_deployer    ON tokens (chain, deployer) WHERE deployer IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tokens_opportunity ON tokens (last_opportunity DESC NULLS LAST);

-- Mediciones de mercado en el tiempo --------------------------------------
CREATE TABLE IF NOT EXISTS token_snapshots (
  id                BIGSERIAL PRIMARY KEY,
  token_id          BIGINT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  ts                TIMESTAMPTZ NOT NULL DEFAULT now(),
  price_usd         NUMERIC(30,15),
  market_cap_usd    NUMERIC(20,2),
  fdv_usd           NUMERIC(20,2),
  liquidity_usd     NUMERIC(20,2),
  volume_m5         NUMERIC(20,2),
  volume_h1         NUMERIC(20,2),
  volume_h6         NUMERIC(20,2),
  volume_h24        NUMERIC(20,2),
  txns_m5_buys      INTEGER,
  txns_m5_sells     INTEGER,
  txns_h1_buys      INTEGER,
  txns_h1_sells     INTEGER,
  txns_h24_buys     INTEGER,
  txns_h24_sells    INTEGER,
  price_change_m5   NUMERIC(12,4),
  price_change_h1   NUMERIC(12,4),
  price_change_h6   NUMERIC(12,4),
  price_change_h24  NUMERIC(12,4),
  holders_count     INTEGER,
  top10_pct         NUMERIC(6,2),
  source            TEXT
);

CREATE INDEX IF NOT EXISTS idx_snapshots_token_ts ON token_snapshots (token_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_ts       ON token_snapshots (ts DESC);

-- Informes de seguridad ---------------------------------------------------
CREATE TABLE IF NOT EXISTS security_reports (
  id                      BIGSERIAL PRIMARY KEY,
  token_id                BIGINT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  ts                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  mint_authority_active   BOOLEAN,
  mint_authority          TEXT,
  freeze_authority_active BOOLEAN,
  freeze_authority        TEXT,
  is_token_2022           BOOLEAN,
  has_extensions          BOOLEAN,
  owner_can_modify        BOOLEAN,
  owner_address           TEXT,
  has_blacklist           BOOLEAN,
  has_mint_function       BOOLEAN,
  is_proxy                BOOLEAN,
  is_verified             BOOLEAN,
  buy_tax_pct             NUMERIC(6,2),
  sell_tax_pct            NUMERIC(6,2),
  tax_modifiable          BOOLEAN,
  is_honeypot             BOOLEAN,
  lp_locked_pct           NUMERIC(6,2),
  lp_burned_pct           NUMERIC(6,2),
  lp_locker_name          TEXT,
  total_supply            TEXT,
  notes                   JSONB NOT NULL DEFAULT '[]'::jsonb,
  sources                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  failed_sources          JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw                     JSONB
);

CREATE INDEX IF NOT EXISTS idx_security_token_ts ON security_reports (token_id, ts DESC);

-- Holders y concentracion -------------------------------------------------
CREATE TABLE IF NOT EXISTS holder_snapshots (
  id                BIGSERIAL PRIMARY KEY,
  token_id          BIGINT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  ts                TIMESTAMPTZ NOT NULL DEFAULT now(),
  holders_count     INTEGER,
  top10_pct         NUMERIC(6,2),
  top20_pct         NUMERIC(6,2),
  largest_real_pct  NUMERIC(6,2),
  deployer_pct      NUMERIC(6,2),
  partial           BOOLEAN NOT NULL DEFAULT false,
  note              TEXT,
  -- Top N holders con su etiqueta (pool, quemado, creador, wallet).
  top_holders       JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_holders_token_ts ON holder_snapshots (token_id, ts DESC);

-- Creador / deployer ------------------------------------------------------
CREATE TABLE IF NOT EXISTS deployer_reports (
  id                BIGSERIAL PRIMARY KEY,
  token_id          BIGINT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  ts                TIMESTAMPTZ NOT NULL DEFAULT now(),
  deployer          TEXT,
  deploy_tx         TEXT,
  deployed_at       TIMESTAMPTZ,
  prior_token_count INTEGER NOT NULL DEFAULT 0,
  prior_tokens      JSONB NOT NULL DEFAULT '[]'::jsonb,
  history_verdict   TEXT NOT NULL DEFAULT 'unknown',
  funded_by         TEXT,
  note              TEXT
);

CREATE INDEX IF NOT EXISTS idx_deployer_token ON deployer_reports (token_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_deployer_addr  ON deployer_reports (deployer);

-- Eventos sospechosos -----------------------------------------------------
CREATE TABLE IF NOT EXISTS suspicious_events (
  id        BIGSERIAL PRIMARY KEY,
  token_id  BIGINT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind      TEXT NOT NULL,
  severity  TEXT NOT NULL,
  detail    TEXT NOT NULL,
  data      JSONB
);

CREATE INDEX IF NOT EXISTS idx_susp_token_ts ON suspicious_events (token_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_susp_kind     ON suspicious_events (kind, ts DESC);

-- Puntuaciones ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scores (
  id                 BIGSERIAL PRIMARY KEY,
  token_id           BIGINT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  ts                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  opportunity        NUMERIC(5,1) NOT NULL,
  risk               NUMERIC(5,1) NOT NULL,
  opportunity_label  TEXT NOT NULL,
  risk_label         TEXT NOT NULL,
  vetoed             BOOLEAN NOT NULL DEFAULT false,
  opportunity_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_reasons        JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_data        JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_scores_token_ts ON scores (token_id, ts DESC);

-- Alertas enviadas --------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerts (
  id           BIGSERIAL PRIMARY KEY,
  token_id     BIGINT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind         TEXT NOT NULL,             -- oportunidad | peligro | actualizacion
  opportunity  NUMERIC(5,1),
  risk         NUMERIC(5,1),
  message      TEXT NOT NULL,
  sent_ok      BOOLEAN NOT NULL DEFAULT false,
  error        TEXT
);

CREATE INDEX IF NOT EXISTS idx_alerts_ts    ON alerts (ts DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_token ON alerts (token_id, ts DESC);

-- Consumo de APIs (para vigilar los planes gratuitos) ---------------------
CREATE TABLE IF NOT EXISTS api_usage (
  day       DATE NOT NULL,
  provider  TEXT NOT NULL,
  calls     BIGINT NOT NULL DEFAULT 0,
  errors    BIGINT NOT NULL DEFAULT 0,
  rate_hits BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider)
);

-- Estado interno del sistema (pausas, contadores, etc.) -------------------
CREATE TABLE IF NOT EXISTS system_state (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Registro de actividad visible en el panel -------------------------------
CREATE TABLE IF NOT EXISTS activity_log (
  id      BIGSERIAL PRIMARY KEY,
  ts      TIMESTAMPTZ NOT NULL DEFAULT now(),
  level   TEXT NOT NULL,
  area    TEXT NOT NULL,
  message TEXT NOT NULL,
  data    JSONB
);

CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_log (ts DESC);
