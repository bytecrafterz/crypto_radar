-- ==========================================================
--  Lectura por MTProto: por donde iba cada canal
--
--  El colector por bot no necesitaba esto porque Telegram le mantenia
--  una cola comun. Leyendo como cuenta de usuario no hay cola: hay que
--  preguntar canal por canal "dame lo posterior a este mensaje", asi que
--  el ultimo id leido se guarda por canal.
-- ==========================================================

ALTER TABLE tg_channels
  ADD COLUMN IF NOT EXISTS ultimo_msg_id BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leido_at      TIMESTAMPTZ,
  -- 'bot' o 'mtproto': de donde llegan los mensajes de este canal.
  ADD COLUMN IF NOT EXISTS via           TEXT NOT NULL DEFAULT 'bot';

CREATE INDEX IF NOT EXISTS idx_tg_channels_leido ON tg_channels(leido_at NULLS FIRST);
