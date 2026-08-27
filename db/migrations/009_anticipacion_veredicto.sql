-- Distinguir "no se movio" de "no se pudo medir".
--
-- Hasta ahora los dos casos se guardaban como anticipacion_seg = 0 y eran
-- indistinguibles. Eso rompia la reputacion de los canales: al entrar en
-- un canal se lee su historico, y esas menciones antiguas son de cuando
-- todavia no vigilabamos el token, asi que nunca se pueden medir. Contarlas
-- como "el token no se movio" hundia a canales que si habian acertado.
--
-- Caso real: un canal con una mencion util y dos imposibles de medir
-- figuraba con un 33% de acierto en vez de un 100%.

ALTER TABLE tg_mentions
  ADD COLUMN IF NOT EXISTS anticipacion_veredicto TEXT;

COMMENT ON COLUMN tg_mentions.anticipacion_veredicto IS
  'se_adelanto | reacciono | sin_movimiento | sin_datos';

-- Las que ya estaban calculadas: si no hay ni una medicion de precio en la
-- ventana, no era que el token no se moviera, es que nadie lo estaba
-- mirando.
UPDATE tg_mentions m
   SET anticipacion_veredicto = CASE
         WHEN m.anticipacion_seg IS NULL THEN NULL
         WHEN m.anticipacion_seg > 0 THEN 'se_adelanto'
         WHEN m.anticipacion_seg < 0 THEN 'reacciono'
         WHEN EXISTS (
           SELECT 1 FROM token_snapshots s
             JOIN tokens t ON t.id = s.token_id
            WHERE t.chain = m.chain AND t.address = m.address
              AND s.price_usd IS NOT NULL
              AND s.ts BETWEEN m.posted_at AND m.posted_at + interval '24 hours'
         ) THEN 'sin_movimiento'
         ELSE 'sin_datos'
       END
 WHERE m.anticipacion_veredicto IS NULL;

CREATE INDEX IF NOT EXISTS idx_tg_mentions_veredicto
  ON tg_mentions (anticipacion_veredicto);
