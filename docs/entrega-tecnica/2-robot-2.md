# Robot 2 · Analisis de Telegram

Lee canales de Telegram en espanol, portugues e ingles, separa la informacion del ruido, saca los
tokens de los que se habla, resume en espanol lo que dicen, mide si cada canal se adelanta al
movimiento del precio y le pasa cada token al Robot 1 para que lo analice. No envia avisos propios:
lo que encuentra lo analiza el Robot 1 y lo cruza el Robot 3.

## Que recibe

- **Mensajes de canales de Telegram**, leidos con una cuenta de usuario de Telegram (protocolo
  MTProto, libreria `telegram`; `src/telegram/mtproto.ts`, `src/telegram/colector-mt.ts`). Es la via
  principal: una cuenta de usuario puede buscar canales publicos y unirse a ellos.
- **Mensajes de grupos donde se invite al bot del Robot 2** (`src/telegram/colector.ts`). Es una
  via secundaria: un bot solo lee donde alguien lo mete a mano.
- **Canales nuevos que encuentra el mismo** (`src/telegram/descubrimiento.ts`): cada 2 horas busca
  en Telegram con 24 consultas, 8 en cada idioma, y se une como mucho a 3 canales al dia (Telegram
  restringe las cuentas que se unen deprisa). Descarta los canales con titulo en otros alfabetos y
  abandona los que llevan un mes sin aportar ninguna mencion de token.

La lista de canales que se leen hoy, con su reputacion, esta en `anexos/canales-telegram.csv` y en
el panel (Telegram → Fuentes).

## Que analiza, paso a paso

| Paso | Que hace | Codigo | Se guarda en |
|---|---|---|---|
| 1. Lectura | Guarda cada mensaje tal cual, con su canal y su hora exacta | `colector-mt.ts`, `colector.ts` | `tg_messages` |
| 2. Primer filtro (gratis) | Pasa solo lo que nombra una direccion de contrato, un ticker ($XXX) o palabras de informacion en los tres idiomas (listing, launch, liquidity, rug...). Las palabras de puro entusiasmo ("moon", "gem") no cuentan. Ante la duda, pasa | `triaje.ts` | `tg_messages.triage`, `triage_motivo` |
| 3. Token del que se habla | Si el mensaje trae la direccion del contrato, se usa. Si solo trae un ticker y hay cualquier duda sobre cual es, se descarta: los tickers no son unicos | `resolver.ts` | `tg_mentions` |
| 4. Entrega al Robot 1 | Manda la direccion a `POST /api/candidato`; el Robot 1 busca sus datos y lo analiza | `colector-mt.ts` | (las tablas del Robot 1) |
| 5. Clasificacion y resumen en espanol | Un modelo de lenguaje clasifica cada mensaje que paso el filtro (informacion, promocion, hype o indeterminado), con su confianza, idioma, tipo de senal, lo que afirma y un resumen en espanol | `clasificador.ts` (instrucciones en `INSTRUCCION`), `src/core/llm.ts` | `tg_messages.clasificacion`, `resumen_es`, `idioma`, `tipo_senal`, `afirmaciones` |
| 6. Anticipacion | Para cada mencion mira si en las 24 horas siguientes el precio subio un 25 %, y si el mensaje llego antes (**se adelanto**) o despues de que empezara la subida (**reacciono**). Si no subio: **sin movimiento**; si no hay precios: **sin datos** | `anticipacion.ts` → `calcularAnticipacion()`, `actualizarPendientes()` | `tg_mentions.anticipacion_seg`, `anticipacion_veredicto` |
| 7. Reputacion de cada canal | Ver abajo | `anticipacion.ts` → `recalcularReputacion()` | `tg_source_stats` |

### Como se valora cada fuente (reputacion)

La reputacion de un canal es el **porcentaje de sus menciones medidas que aparecieron antes de que
el precio subiera un 25 %** en las 24 horas siguientes. Las menciones sin datos no cuentan ni a
favor ni en contra. Se recalcula sola cada 30 minutos con resultados reales; nadie la pone a mano.

Junto a ella se guardan, por canal: tokens distintos citados, cuantas veces fue el primero en
nombrar un token y la anticipacion media (`tg_source_stats`). El panel ensena todo en Telegram →
Fuentes, y en la ficha de cada token, la reputacion de cada canal que hablo de el.

### Fuentes que se copian entre si

Dos canales que publican el mismo texto (cambiando emojis o enlaces) cuentan como una sola fuente:
el texto pertenece al canal que lo publico primero. Y una promocion pagada no cuenta como fuente
independiente aunque venga de otro canal. Es el recuento que usa el Robot 3
(`src/robot3/fuentes.ts` → `contarFuentes()`).

## El modelo de lenguaje y su limite

El proveedor se cambia con variables de entorno, sin tocar codigo (`LLM_PROVIDER`, `LLM_MODEL`,
`LLM_API_KEY`; ver `src/core/llm.ts`): sirve cualquier servicio compatible con la API de OpenAI,
Gemini o Anthropic. Hoy usa la capa gratuita de Groq, que da para unos 250 mensajes al dia.
El primer filtro deja pasar unos 2.000 al dia, asi que la mayoria se quedan sin resumen en espanol.
Sin resumen, el mensaje se guarda igual, se sacan sus tokens igual y el Robot 3 lo cuenta como
fuente (sin clasificar se trata como posible informacion). Con un plan de pago del mismo servicio
se clasificarian y resumirian todos.

## Que produce

- Los mensajes, con su clasificacion y su resumen en espanol (`tg_messages`).
- Las menciones de tokens, con su anticipacion (`tg_mentions`).
- La reputacion de cada canal (`tg_source_stats`).
- Los tokens que pasa al Robot 1 y, a traves de las menciones, la materia prima del Robot 3.

## Como se ejecuta

Bucles del proceso de los robots (`src/worker/index.ts`), todos con nombre `robot2-...`:
`lectura` (cada 90 s), `descubrimiento` (cada 2 h), `sincronizar` (cada hora), `colector` (bot,
cada 30 s), `clasificador` (cada 3 min), `anticipacion` (cada 5 min) y `reputacion` (cada 30 min).
Se arranca solo con `ROBOTS=2` (ver el documento 5). La cuenta de usuario se conecta una vez con
`node scripts/telegram-login.mjs`, que guarda la sesion en `TELEGRAM_SESSION`.

## Donde verlo en el panel

- **Telegram:** cuatro pestanas. Tokens mencionados (canal, hora, mensaje y anticipacion),
  Mensajes (resumen en espanol y original, filtrable por clase), Fuentes (reputacion de cada canal
  y su criterio) y Canales encontrados por el propio robot.
- **Ficha de un token:** seccion "Telegram y Robot 3", con cada mencion, su canal, su hora, la
  reputacion del canal, el mensaje original y la anticipacion.
