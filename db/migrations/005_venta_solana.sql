-- ==========================================================
--  Comprobacion de venta en Solana (Jupiter)
--
--  En Solana no existe simulacion de venta como en Base. Lo mas cercano es
--  pedir a Jupiter una cotizacion real de compra y otra de venta encadenadas.
--  Aqui se guarda el resultado.
-- ==========================================================

-- ¿Existe ruta de venta? NULL = no se pudo comprobar.
ALTER TABLE security_reports ADD COLUMN IF NOT EXISTS can_sell BOOLEAN;

-- Coste real de comprar y vender de inmediato, en %.
-- Es una medicion sobre la liquidez real, no una estimacion teorica.
ALTER TABLE security_reports ADD COLUMN IF NOT EXISTS round_trip_loss_pct NUMERIC(8,2);

CREATE INDEX IF NOT EXISTS idx_security_cansell
  ON security_reports (can_sell) WHERE can_sell IS NOT NULL;
