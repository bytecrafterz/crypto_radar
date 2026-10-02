-- Robot 2 en espanol, coherencia del Robot 3 y seguimiento de sus veredictos.
--
-- RESUMEN EN ESPANOL
-- La especificacion pide que la informacion se entregue en espanol, y lo
-- que se veia era el mensaje original en ingles o portugues. El clasificador
-- devuelve ahora, ademas de la clase, un resumen en espanol de lo que afirma
-- el mensaje, su idioma, el tipo de senal y las afirmaciones concretas que
-- hace (liquidez bloqueada, sin permisos, aviso de estafa...).

ALTER TABLE tg_messages
  ADD COLUMN IF NOT EXISTS resumen_es   TEXT,
  ADD COLUMN IF NOT EXISTS idioma       TEXT,
  ADD COLUMN IF NOT EXISTS tipo_senal   TEXT,
  ADD COLUMN IF NOT EXISTS afirmaciones JSONB;

COMMENT ON COLUMN tg_messages.idioma IS 'es | pt | en | otro';
COMMENT ON COLUMN tg_messages.afirmaciones IS
  'Afirmaciones comprobables contra la cadena: liquidez_bloqueada, sin_permisos, sin_impuestos, no_honeypot, advertencia';

-- Para rellenar poco a poco el resumen de lo ya clasificado.
CREATE INDEX IF NOT EXISTS idx_tg_messages_sin_resumen
  ON tg_messages (posted_at DESC)
  WHERE clasificado_at IS NOT NULL AND resumen_es IS NULL;

-- RAZONAMIENTO DEL VEREDICTO
-- El Robot 3 explicaba por que decidia lo que decidia, pero solo en el
-- aviso. Lo que no se avisaba se perdia, y con ello las contradicciones
-- detectadas. Ahora se guarda todo con el veredicto.
ALTER TABLE tg_candidatos
  ADD COLUMN IF NOT EXISTS detalle JSONB;

COMMENT ON COLUMN tg_candidatos.detalle IS
  '{motivo, explicacion[], contradicciones[], confirmaciones[], resumenes[]}';

-- SEGUIMIENTO
-- Cada cambio de nivel de un veredicto, con la hora y el precio. Sirve para
-- ensenar como evoluciona una oportunidad y para medir despues cuanto
-- acerto el Robot 3 en cada nivel.
CREATE TABLE IF NOT EXISTS tg_candidatos_historial (
  id            BIGSERIAL PRIMARY KEY,
  candidato_id  BIGINT NOT NULL REFERENCES tg_candidatos(id) ON DELETE CASCADE,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  nivel         TEXT NOT NULL,
  nivel_antes   TEXT,
  score_tecnica INT,
  score_riesgo  INT,
  fuentes_indep INT,
  precio_usd    NUMERIC(30,15)
);

CREATE INDEX IF NOT EXISTS idx_tg_cand_hist ON tg_candidatos_historial (candidato_id, ts);
CREATE INDEX IF NOT EXISTS idx_tg_cand_hist_nivel ON tg_candidatos_historial (nivel, ts);
