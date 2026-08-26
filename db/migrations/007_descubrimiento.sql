-- ==========================================================
--  Robot 2: descubrimiento automatico de canales
--
--  El sistema busca canales por su cuenta en vez de trabajar con una
--  lista escrita a mano. Encuentra muchos mas de los que conviene
--  seguir, asi que hay una cola: primero se apuntan, se miran de lejos,
--  y solo se entra en los que valen la pena.
--
--  POR QUE NO ENTRAR EN TODOS
--  Unirse a canales en masa es la forma mas rapida de que Telegram
--  bloquee la cuenta. Ademas hay un tope de unos 500 canales por cuenta,
--  asi que el sitio es limitado y hay que elegir.
-- ==========================================================

CREATE TABLE IF NOT EXISTS tg_canales_descubiertos (
  id             BIGSERIAL PRIMARY KEY,

  -- Identificacion. El username puede cambiar; el tg_id no, pero solo se
  -- conoce despues de entrar.
  username       TEXT UNIQUE,
  tg_id          BIGINT,
  title          TEXT,
  miembros       INT,
  lang           TEXT,

  -- Como aparecio. Los reenvios son la mejor pista: alguien decidio
  -- relayar ese contenido, lo cual dice mas que salir en una busqueda.
  descubierto_por TEXT NOT NULL,   -- busqueda | enlace | reenvio
  -- Canal desde el que se llego, si fue por enlace o reenvio.
  origen_id      BIGINT REFERENCES tg_canales_descubiertos(id),

  -- Puntuacion previa, antes de entrar. Solo con lo que se ve de fuera.
  score          INT,
  motivo_score   TEXT,

  -- candidato  : encontrado, sin decidir
  -- unido      : dentro, leyendo
  -- rechazado  : no merece la pena entrar
  -- abandonado : se entro y resulto inutil, se salio
  estado         TEXT NOT NULL DEFAULT 'candidato',
  motivo_estado  TEXT,

  visto_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  unido_at       TIMESTAMPTZ,
  revisado_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_desc_estado ON tg_canales_descubiertos(estado, score DESC);
CREATE INDEX IF NOT EXISTS idx_desc_visto  ON tg_canales_descubiertos(visto_at DESC);

-- Registro de uniones, para respetar el ritmo diario y poder revisarlo
-- despues si Telegram se queja.
CREATE TABLE IF NOT EXISTS tg_uniones (
  id          BIGSERIAL PRIMARY KEY,
  canal_id    BIGINT REFERENCES tg_canales_descubiertos(id) ON DELETE CASCADE,
  username    TEXT,
  accion      TEXT NOT NULL,       -- union | salida
  resultado   TEXT,                -- ok | error
  detalle     TEXT,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uniones_ts ON tg_uniones(ts DESC);
