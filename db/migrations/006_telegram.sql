-- ==========================================================
--  Robot 2: radar de informacion en Telegram
--
--  PRINCIPIO DE DISENO
--  Todo mensaje se guarda EN BRUTO antes de filtrarlo. El clasificador
--  se va a equivocar, y cuando se mejore hay que poder volver a pasarlo
--  sobre el historico en vez de haber tirado la evidencia. Sin esto,
--  cada mejora obliga a empezar a contar de cero.
-- ==========================================================

-- --- Canales vigilados ---------------------------------------------------
CREATE TABLE IF NOT EXISTS tg_channels (
  id            BIGSERIAL PRIMARY KEY,
  tg_id         BIGINT UNIQUE NOT NULL,
  username      TEXT,
  title         TEXT,
  -- Idioma predominante. Se rellena solo tras unos cuantos mensajes.
  lang          TEXT,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  active        BOOLEAN NOT NULL DEFAULT true,
  -- Notas manuales: por que se anadio, quien dice ser, etc.
  notas         TEXT
);

-- --- Mensajes en bruto ---------------------------------------------------
CREATE TABLE IF NOT EXISTS tg_messages (
  id            BIGSERIAL PRIMARY KEY,
  channel_id    BIGINT NOT NULL REFERENCES tg_channels(id) ON DELETE CASCADE,
  tg_msg_id     BIGINT NOT NULL,

  -- posted_at es la hora que dice Telegram. received_at es cuando lo vimos
  -- nosotros. Se guardan las dos porque la diferencia importa: si el
  -- colector estuvo caido, todo llega de golpe y solo posted_at sirve para
  -- medir anticipacion.
  posted_at     TIMESTAMPTZ NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  text          TEXT,
  -- Texto normalizado (minusculas, sin enlaces, sin emoji, sin espacios
  -- de mas) reducido a hash. Dos canales con el mismo hash estan copiando.
  text_hash     TEXT,

  -- Telegram permite editar y borrar despues de publicar. Si no se guarda,
  -- el sistema puede acabar actuando sobre un texto que ya no existe.
  edited_at     TIMESTAMPTZ,
  deleted       BOOLEAN NOT NULL DEFAULT false,

  -- null = sin procesar | descartado | candidato
  triage        TEXT,
  triage_motivo TEXT,
  triage_at     TIMESTAMPTZ,

  UNIQUE (channel_id, tg_msg_id)
);

CREATE INDEX IF NOT EXISTS idx_tg_msg_posted  ON tg_messages(posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_tg_msg_hash    ON tg_messages(text_hash);
CREATE INDEX IF NOT EXISTS idx_tg_msg_triage  ON tg_messages(triage) WHERE triage IS NULL;

-- --- Menciones de token identificadas ------------------------------------
CREATE TABLE IF NOT EXISTS tg_mentions (
  id            BIGSERIAL PRIMARY KEY,
  message_id    BIGINT NOT NULL REFERENCES tg_messages(id) ON DELETE CASCADE,
  channel_id    BIGINT NOT NULL REFERENCES tg_channels(id) ON DELETE CASCADE,

  chain         TEXT,
  address       TEXT,
  -- Como se identifico: 'contrato' si venia la direccion en el mensaje,
  -- 'ticker' si hubo que resolverlo. El primero es fiable; el segundo no
  -- siempre.
  resuelto_por  TEXT,

  tipo_senal    TEXT,     -- listing | lanzamiento | partnership | whale | negativo | ...
  confianza     INT,      -- 0-100, del clasificador

  posted_at     TIMESTAMPTZ NOT NULL,
  -- true si es la primera vez que CUALQUIER canal menciona este token
  es_primera    BOOLEAN NOT NULL DEFAULT false,

  -- Se rellena despues, cuando hay precio con el que comparar.
  -- Positivo = Telegram hablo antes del movimiento.
  -- Negativo = Telegram reacciono a un movimiento que ya habia pasado.
  anticipacion_seg INT,

  creado_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tg_men_token   ON tg_mentions(chain, address, posted_at);
CREATE INDEX IF NOT EXISTS idx_tg_men_canal   ON tg_mentions(channel_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_tg_men_pend    ON tg_mentions(anticipacion_seg) WHERE anticipacion_seg IS NULL;

-- --- Reputacion de cada fuente -------------------------------------------
-- Siempre DERIVADA de resultados reales, nunca escrita a mano. Se recalcula
-- periodicamente. Un canal que menciona pocos tokens pero siempre antes del
-- movimiento vale mas que uno que menciona cientos.
CREATE TABLE IF NOT EXISTS tg_source_stats (
  channel_id       BIGINT PRIMARY KEY REFERENCES tg_channels(id) ON DELETE CASCADE,
  tokens_citados   INT NOT NULL DEFAULT 0,
  veces_primero    INT NOT NULL DEFAULT 0,
  -- Media de anticipacion en segundos. Negativa = suele llegar tarde.
  anticipacion_med INT,
  -- Porcentaje de menciones que acabaron siendo tokens que el Robot 1
  -- confirmo como oportunidad.
  tasa_utiles      NUMERIC(5,2),
  -- Porcentaje de mensajes que fueron descartados como ruido.
  tasa_ruido       NUMERIC(5,2),
  actualizado      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Candidatos enviados al Robot 3 --------------------------------------
CREATE TABLE IF NOT EXISTS tg_candidatos (
  id               BIGSERIAL PRIMARY KEY,
  chain            TEXT NOT NULL,
  address          TEXT NOT NULL,

  primera_mencion  TIMESTAMPTZ NOT NULL,
  fuentes_total    INT NOT NULL DEFAULT 1,
  -- Fuentes que NO son copia unas de otras. Es el numero que importa.
  fuentes_indep    INT NOT NULL DEFAULT 1,
  anticipacion_seg INT,

  -- Componentes de convergencia, separadas a proposito. Nunca se funden
  -- en un solo numero: el usuario tiene que poder ver por que.
  score_social     INT,
  score_fuentes    INT,
  score_evidencia  INT,
  -- Estas dos llegan del Robot 1
  score_tecnica    INT,
  score_riesgo     INT,
  vetado           BOOLEAN,

  nivel            TEXT,    -- amarillo | naranja | rojo
  enviado_at       TIMESTAMPTZ,
  creado_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (chain, address, primera_mencion)
);

CREATE INDEX IF NOT EXISTS idx_tg_cand_nivel ON tg_candidatos(nivel, creado_at DESC);
