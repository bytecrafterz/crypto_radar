-- Reintentar lo que fallo por causas pasajeras.
--
-- Un fallo del proveedor, un limite por minuto o una caida momentanea
-- dejaban el mensaje marcado como 'indeterminado' para siempre, y ya no
-- se volvia a mirar nunca. Eso no es una clasificacion: es una perdida.
--
-- Con un contador se distingue "no se pudo clasificar todavia" de "se
-- intento varias veces y no hubo manera".

ALTER TABLE tg_messages
  ADD COLUMN IF NOT EXISTS clasificacion_intentos INT NOT NULL DEFAULT 0;

-- Los que quedaron marcados por un fallo del proveedor vuelven a la cola.
UPDATE tg_messages
   SET clasificacion = NULL, clasificado_at = NULL, clasificacion_intentos = 1
 WHERE clasificacion = 'indeterminado'
   AND clasificacion_motivo = 'el modelo no respondio';
