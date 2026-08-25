-- ==========================================================
--  Vetos criticos, latencia, horizontes y cambios de seguridad
--
--  Responde a lo que pidio la clienta:
--   - saber cuanto tarda el sistema (latencia por etapas)
--   - poder demostrar con datos si las senales buenas rinden mas
--     (mediciones a 5 min, 15 min, 1 h, 6 h y 24 h)
--   - detectar que las condiciones cambian DESPUES de la senal
-- ==========================================================

-- --- Estado y trazabilidad del token -------------------------------------
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS analysis_started_at  TIMESTAMPTZ;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS analysis_finished_at TIMESTAMPTZ;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS first_alert_at       TIMESTAMPTZ;
-- Desglose de tiempos en milisegundos, etapa por etapa.
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS latency_ms           JSONB;
-- Semaforo actual: verde | amarillo | rojo
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS light                TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS evaluable            BOOLEAN;
-- Motivo por el que una oportunidad dejo de ser valida.
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS invalidated_at       TIMESTAMPTZ;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS invalidation_reason  TEXT;

CREATE INDEX IF NOT EXISTS idx_tokens_light ON tokens (light) WHERE light IS NOT NULL;

-- --- Detalle de cada puntuacion ------------------------------------------
ALTER TABLE scores ADD COLUMN IF NOT EXISTS critical_vetoes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS evaluable       BOOLEAN;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS light           TEXT;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS execution       JSONB;

-- --- Mediciones a horizontes fijos ---------------------------------------
-- Sin esto no se puede demostrar despues si las senales buenas rinden mas.
-- Hay que capturarlas EN SU MOMENTO: no se pueden reconstruir mas tarde.
CREATE TABLE IF NOT EXISTS token_horizons (
  id                BIGSERIAL PRIMARY KEY,
  token_id          BIGINT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  -- m5 | m15 | h1 | h6 | h24 | d7
  horizon           TEXT NOT NULL,
  captured_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Minutos reales transcurridos desde la deteccion (puede no ser exacto).
  minutes_after     NUMERIC(10,2),
  price_usd         NUMERIC(30,15),
  liquidity_usd     NUMERIC(20,2),
  market_cap_usd    NUMERIC(20,2),
  holders_count     INTEGER,
  -- Cuanto vale respecto al momento de la deteccion (1.0 = igual).
  price_multiple    NUMERIC(12,4),
  cap_multiple      NUMERIC(12,4),
  -- Rentabilidad realista: descuenta el impacto de entrar y salir.
  net_multiple      NUMERIC(12,4),
  UNIQUE (token_id, horizon)
);

CREATE INDEX IF NOT EXISTS idx_horizons_token ON token_horizons (token_id);
CREATE INDEX IF NOT EXISTS idx_horizons_h     ON token_horizons (horizon);

-- --- Cambios de condiciones despues de la senal ---------------------------
-- Un token seguro en el minuto 1 puede dejar de serlo en el minuto 10.
CREATE TABLE IF NOT EXISTS security_changes (
  id          BIGSERIAL PRIMARY KEY,
  token_id    BIGINT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  field       TEXT NOT NULL,
  before_val  TEXT,
  after_val   TEXT,
  severity    TEXT NOT NULL DEFAULT 'warn',
  detail      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_secchanges_token ON security_changes (token_id, ts DESC);
