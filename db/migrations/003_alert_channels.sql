-- ==========================================================
--  Canales de alerta
--  Una alerta puede enviarse por varios canales a la vez
--  (Telegram, Discord, correo). Guardamos el resultado de cada uno.
-- ==========================================================

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS channels JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Indice para poder ver rapidamente si algun canal esta fallando.
CREATE INDEX IF NOT EXISTS idx_alerts_sent ON alerts (sent_ok, ts DESC);
