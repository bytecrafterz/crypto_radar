# Cuentas, accesos, licencias y derechos

## Cuentas y claves que usa el sistema

Las claves se guardan solo en el fichero `.env` del servidor (`/opt/crypto-radar/.env`), nunca en
el codigo ni en el repositorio. La plantilla con todas las variables explicadas es `.env.example`.
Las claves nunca van dentro del codigo ni de estos documentos.

Mientras el desarrollador opera el servidor, las cuentas siguen como estan. Cuando se traspase la
gestion a otro equipo o proveedor, cada una se pasa a nombre de la propietaria del sistema como se
explica debajo.

| Servicio | Variables | Para que | Robot | Coste |
|---|---|---|---|---|
| Bot de avisos de Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_ALLOWED_IDS` | Enviar avisos y atender los comandos (`/robots`, `/hoy`...) | 1 y 3 | gratis |
| Bot del Robot 2 | `TELEGRAM_RADAR_TOKEN` | Leer los grupos donde se le invite | 2 | gratis |
| Cuenta de usuario de Telegram | `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION` | Buscar canales, unirse a ellos y leerlos (la via principal del Robot 2) | 2 | gratis |
| Helius | `HELIUS_API_KEY` | Datos de Solana (holders, transacciones) | 1 | gratis, 1 millon de creditos al mes |
| Alchemy | `ALCHEMY_API_KEY` | Datos de Base (transferencias, holders) | 1 | gratis |
| Proveedor de IA (hoy Groq) | `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY` | Clasificar y resumir en espanol los mensajes | 2 | gratis, unos 250 mensajes al dia |
| Discord | `DISCORD_WEBHOOK_URL` | Enviar los avisos a un canal de Discord | 1 y 3 | gratis |
| Correo (opcional) | `SMTP_*`, `ALERT_EMAIL_TO` | Avisos por correo | 1 y 3 | depende |
| Dominio del panel (DuckDNS) | (fuera del `.env`) | La direccion `crypto-radar.duckdns.org` | panel | gratis |
| Servidor (Contabo) | (fuera del `.env`) | Donde corre todo | todos | de pago |

Fuentes que no piden cuenta ni clave: DexScreener, GeckoTerminal, GoPlus, RugCheck, Honeypot.is,
Jupiter y los RPC publicos de Solana y Base.

Claves internas, que no son cuentas de ningun servicio y se pueden regenerar cuando se quiera:
`DATABASE_URL` (base de datos local), `PANEL_PASSWORD` (contrasena del panel), `SESSION_SECRET`
(firma de las sesiones del panel) y `API_SHARED_SECRET` (clave entre el Robot 2 y el Robot 1).
`scripts/generar-secretos.sh` genera valores nuevos.

### Como sustituir cada cuenta

- **Helius, Alchemy, proveedor de IA:** crear la cuenta gratuita a su nombre, copiar la clave nueva
  en `.env` y reiniciar (`systemctl restart crypto-radar`). Los pasos con capturas son los de la
  lista de credenciales que se entrego con el primer encargo.
- **Bots de Telegram:** traspasar la propiedad del bot a su cuenta desde @BotFather, o crear uno
  nuevo con @BotFather y poner su token en `.env`. Para recibir los avisos en su chat, su id de
  Telegram va en `TELEGRAM_CHAT_ID`.
- **Cuenta de usuario de Telegram del Robot 2:** es la mas delicada, porque la sesion da acceso
  completo a esa cuenta. Se usa una cuenta suya (mejor con un numero dedicado), se sacan `api_id` y
  `api_hash` en my.telegram.org y se ejecuta `node scripts/telegram-login.mjs`, que pide el codigo
  que llega a la app y guarda la sesion en `TELEGRAM_SESSION`. La cuenta nueva tiene que unirse a los
  canales: el propio Robot 2 lo hace solo, a 3 por dia, o se puede hacer a mano con la lista de
  `anexos/canales-telegram.csv`.
- **Discord:** crear un webhook en su servidor de Discord (Ajustes del canal → Integraciones →
  Webhooks) y poner su direccion en `DISCORD_WEBHOOK_URL`.
- **Dominio:** crear el dominio en una cuenta suya de DuckDNS (o usar uno propio) apuntando a la IP
  del servidor y renovar el certificado HTTPS (`certbot --nginx -d <dominio>`).

## Donde esta cada cosa

| Pieza | Donde |
|---|---|
| Panel | `https://crypto-radar.duckdns.org`, con su contrasena |
| Servidor | Es suyo (Contabo). El sistema esta en `/opt/crypto-radar` (usuario de sistema `radar`), la configuracion en `/opt/crypto-radar/.env`, el servicio es `crypto-radar` y las copias nocturnas en `/var/backups/crypto-radar/bd/` |
| Base de datos | PostgreSQL en el mismo servidor, base de datos `radar`; usuario y contrasena en `DATABASE_URL` del `.env`. Ademas, una copia completa en un fichero |
| Codigo fuente | El repositorio Git con todo su historial (entregado en el zip del codigo) |
| Cuentas de servicios | Las de la tabla de arriba |

## Licencias

El codigo escrito para este proyecto se cede entero, como se explica en el documento de cesion de
derechos ([9-cesion-de-derechos.md](9-cesion-de-derechos.md)).

El sistema usa ademas 311 librerias de terceros (las de `package-lock.json`), que no son obra del
desarrollador y siguen sujetas a sus propias licencias de codigo abierto. La lista completa esta en
`anexos/licencias.txt`:

- 309 tienen licencias permisivas (MIT, ISC, BSD, Apache-2.0, BlueOak y similares), que permiten
  usarlas, modificarlas y distribuirlas, tambien en productos comerciales.
- `caniuse-lite` (CC-BY-4.0) solo se usa para compilar el panel.
- `@cryptography/aes` (GPL-3.0) la usa la libreria de Telegram del Robot 2 para cifrar la conexion.
  Usar y modificar el sistema para uso propio no tiene ninguna restriccion. Si algun dia se
  distribuyera el programa a terceros (venderlo como producto, por ejemplo), esa pieza obliga a
  publicar el codigo de lo que la incluye bajo la misma licencia; en ese caso conviene sustituirla
  o consultarlo con un abogado.
