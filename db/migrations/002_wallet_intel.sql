-- ==========================================================
--  Inteligencia de wallets
--  Preparado desde el principio para la fase de "wallets que
--  historicamente aciertan" y el backtesting, sin rehacer nada.
-- ==========================================================

-- Wallets vistas comprando pronto en tokens detectados --------------------
CREATE TABLE IF NOT EXISTS wallet_activity (
  id            BIGSERIAL PRIMARY KEY,
  chain         TEXT NOT NULL,
  wallet        TEXT NOT NULL,
  token_id      BIGINT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  role          TEXT NOT NULL,          -- comprador_temprano | top_holder | creador | sospechoso
  balance_pct   NUMERIC(6,2),
  -- Minutos transcurridos entre la creacion del par y la aparicion de la wallet.
  minutes_after_launch NUMERIC(10,2),
  note          TEXT,
  UNIQUE (chain, wallet, token_id, role)
);

CREATE INDEX IF NOT EXISTS idx_wallet_activity_wallet ON wallet_activity (chain, wallet);
CREATE INDEX IF NOT EXISTS idx_wallet_activity_token  ON wallet_activity (token_id);

-- Reputacion acumulada de cada wallet -------------------------------------
CREATE TABLE IF NOT EXISTS wallet_stats (
  chain              TEXT NOT NULL,
  wallet             TEXT NOT NULL,
  tokens_seen        INTEGER NOT NULL DEFAULT 0,
  tokens_success     INTEGER NOT NULL DEFAULT 0,   -- el token multiplico su cap
  tokens_rugged      INTEGER NOT NULL DEFAULT 0,
  avg_entry_minutes  NUMERIC(10,2),
  score              NUMERIC(6,2) NOT NULL DEFAULT 0,
  flags              JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_seen         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain, wallet)
);

CREATE INDEX IF NOT EXISTS idx_wallet_stats_score ON wallet_stats (score DESC);

-- Resultado final de cada token (para backtesting) ------------------------
-- Se rellena automaticamente cuando el token deja de vigilarse.
CREATE TABLE IF NOT EXISTS token_outcomes (
  token_id            BIGINT PRIMARY KEY REFERENCES tokens(id) ON DELETE CASCADE,
  evaluated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  hours_tracked       NUMERIC(10,2),
  entry_market_cap    NUMERIC(20,2),
  peak_market_cap     NUMERIC(20,2),
  final_market_cap    NUMERIC(20,2),
  peak_multiple       NUMERIC(12,4),
  final_multiple      NUMERIC(12,4),
  max_drawdown_pct    NUMERIC(8,2),
  minutes_to_peak     NUMERIC(12,2),
  rugged              BOOLEAN NOT NULL DEFAULT false,
  rug_reason          TEXT,
  -- exito | neutro | fracaso | rug
  outcome             TEXT NOT NULL DEFAULT 'neutro',
  score_at_detection  NUMERIC(5,1),
  risk_at_detection   NUMERIC(5,1)
);

CREATE INDEX IF NOT EXISTS idx_outcomes_outcome ON token_outcomes (outcome);
