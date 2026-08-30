-- Segunda etapa del triaje: la que distingue informacion de publicidad.
--
-- La primera etapa son reglas y es gratis: tira el ochenta y cinco por
-- ciento de lo que entra sin gastar nada. Lo que no puede hacer es
-- separar una llamada de verdad de una promocion pagada bien escrita,
-- porque las dos nombran un contrato y usan las mismas palabras. Para eso
-- hace falta entender el texto.

ALTER TABLE tg_messages
  ADD COLUMN IF NOT EXISTS clasificacion TEXT,
  ADD COLUMN IF NOT EXISTS clasificacion_motivo TEXT,
  ADD COLUMN IF NOT EXISTS clasificacion_confianza INT,
  ADD COLUMN IF NOT EXISTS clasificado_at TIMESTAMPTZ;

COMMENT ON COLUMN tg_messages.clasificacion IS
  'informacion | promocion | hype | indeterminado';

-- Para encontrar rapido lo que queda por clasificar.
CREATE INDEX IF NOT EXISTS idx_tg_messages_sin_clasificar
  ON tg_messages (triage, clasificado_at)
  WHERE triage = 'candidato' AND clasificado_at IS NULL;
