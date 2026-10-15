# Instalacion, ejecucion y registros

## Requisitos

| Pieza | Version |
|---|---|
| Sistema | Linux; probado en Ubuntu 24.04 |
| Node.js | 20.10 o superior (en produccion, 24) |
| PostgreSQL | 16 |
| Servidor | 2 nucleos, 4 GB de RAM y 20 GB de disco van holgados; la base de datos ocupa hoy unos 2 GB |
| Opcional | nginx y certbot para servir el panel por HTTPS con un dominio |

Las versiones exactas de todas las librerias estan fijadas en `package-lock.json`; `npm ci` instala
exactamente esas.

## Instalar en un servidor nuevo, paso a paso

```bash
# 1. Codigo
git clone <repositorio> /opt/crypto-radar && cd /opt/crypto-radar

# 2. Base de datos vacia (o restaurar una copia, ver mas abajo)
sudo -u postgres createuser --pwprompt radar
sudo -u postgres createdb -O radar radar

# 3. Configuracion: copiar la plantilla y rellenarla (cada variable esta explicada dentro)
cp .env.example .env && nano .env

# 4. Dependencias y compilacion (servidor y panel)
npm ci
npm run build

# 5. Arrancar. Las tablas se crean solas en el primer arranque.
npm start
```

El panel queda en `http://<servidor>:3000` (o el puerto de `PORT`). Para dejarlo como servicio que
arranca solo y se levanta si se cae, ver "Como servicio" mas abajo.

**Con todo automatizado:** `scripts/instalar-servidor-nuevo.sh` monta el sistema completo en un
Ubuntu 24.04 limpio a partir de una copia de la base de datos: usuario de sistema, codigo,
dependencias, base de datos restaurada, `.env` con secretos nuevos, servicio, copia nocturna, nginx
con HTTPS y cortafuegos. Arranca con los avisos silenciados (`ALERTS_MUTED=true`) para que un
servidor nuevo no duplique los avisos del viejo mientras conviven. Las instrucciones estan al
principio del propio script.

## Trasladar el sistema con todos sus datos

1. En el servidor de origen, la copia mas reciente esta en `/var/backups/crypto-radar/bd/`
   (o se hace una al momento con `sudo -u radar bash scripts/copia-seguridad.sh`).
2. Llevarla al servidor nuevo: `scp radar-AAAAMMDD-HHMM.dump root@<nuevo>:/root/`
3. Restaurarla: `pg_restore --no-owner --role=radar -d radar radar-AAAAMMDD-HHMM.dump`
   (o usar `scripts/instalar-servidor-nuevo.sh`, que lo hace solo).
4. Copiar el `.env` del servidor de origen o rellenar uno nuevo con las claves (documento 8).
5. Arrancar en el nuevo con `ALERTS_MUTED=true`, comprobar que todo va (panel, `/robots`) y, al
   apagar el viejo, quitar `ALERTS_MUTED` y reiniciar.

## Arrancar todo junto o cada robot por separado

Por defecto un solo proceso arranca el panel y los tres robots. Dos variables permiten repartirlos:

| Variable | Valores | Para que |
|---|---|---|
| `ROBOTS` | `1,2,3` (por defecto), o cualquier combinacion | Que robots arranca este proceso |
| `WEB_ENABLED` | `true` (por defecto) / `false` | Si este proceso abre el panel |
| `WORKER_ENABLED` | `true` (por defecto) / `false` | `false` = solo panel, sin ningun robot |

```bash
npm start                                       # todo junto (lo normal)
ROBOTS=1 npm start                              # panel + Robot 1
ROBOTS=2 WEB_ENABLED=false npm start            # solo Robot 2
ROBOTS=3 WEB_ENABLED=false npm start            # solo Robot 3
WORKER_ENABLED=false npm start                  # solo el panel
```

Cosas a tener en cuenta al repartirlos:

- Comparten la base de datos, asi que el Robot 3 cruza lo que guarden los otros dos aunque corran en
  otro proceso (o en otra maquina, apuntando `DATABASE_URL` a la misma base de datos).
- El Robot 2 entrega cada token al Robot 1 llamando al panel en `http://127.0.0.1:<PORT>/api/candidato`,
  con la clave `API_SHARED_SECRET`. Por eso tiene que haber un proceso con el panel en la misma
  maquina, y los dos con el mismo `API_SHARED_SECRET` y `PORT`.
- Los comandos del bot de Telegram (`/robots`, `/hoy`...) los atiende el proceso que lleva el
  Robot 1. Los demas usan el bot solo para enviar avisos.
- Cada robot puede pararse sin que los demas fallen: el Robot 3 simplemente no tendra datos nuevos
  que cruzar del que este parado.
- Las tarjetas de estado de la portada del panel ven los robots de todos los procesos, por los
  latidos que cada uno deja en la base de datos.
- En desarrollo, `npm run dev` arranca todo con recarga automatica al cambiar el codigo.

## Como servicio

La unidad de produccion, en `/etc/systemd/system/crypto-radar.service`:

```ini
[Unit]
Description=Crypto Radar - panel y avisos
After=network-online.target postgresql.service
Requires=postgresql.service

[Service]
User=radar
WorkingDirectory=/opt/crypto-radar
EnvironmentFile=/opt/crypto-radar/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Para un robot en su propio servicio, se copia la unidad con otro nombre y se le anade, por
ejemplo, `Environment=ROBOTS=2 WEB_ENABLED=false`; a la principal, `Environment=ROBOTS=1,3`.

```bash
systemctl status crypto-radar        # estado
systemctl restart crypto-radar       # reiniciar
curl http://127.0.0.1:3000/salud     # responde 200 si esta vivo
```

## Registros para la revision

| Que | Donde |
|---|---|
| Todo lo que hace cada robot | `journalctl -u crypto-radar` (en formato JSON; `-f` para seguirlo en directo) |
| Solo un modulo | `journalctl -u crypto-radar -o cat \| grep '"mod":"robot3"'` |
| Registro de actividad (arranques, errores, avisos del vigilante) | panel → Sistema → Registro de actividad; tabla `activity_log` |
| Estado de cada robot y de cada tarea | portada del panel, panel → Sistema, comando `/robots` |
| Consumo de cada proveedor de datos | panel → Sistema; tabla `api_usage` |
| Cada aviso enviado, con su texto y si llego | panel → Alertas; tabla `alerts` |
| Cada decision del Robot 3 | panel → ficha del token; tablas `tg_candidatos`, `tg_candidatos_historial` |

Modulos del registro (`"mod"`): Robot 1 → `deteccion`, `analisis`, `seguimiento`, `alertas`,
`security`, `holders`, `deployer`, `manipulacion`, `mercado`, y uno por fuente (`dexscreener`,
`goplus`, `rugcheck`, `jupiter`...). Robot 2 → `colector-mt`, `colector`, `descubrimiento`,
`resolver`, `clasificador`, `anticipacion`, `mtproto`, `llm`. Robot 3 → `robot3`. Sistema → `motor`,
`vigilante`, `panel`, `telegram` (bot de avisos), `db`. El nivel de detalle se cambia con `LOG_LEVEL`
(`debug`, `info`, `warn`).

## Pruebas

```bash
npm test             # 126 comprobaciones automaticas; deben salir todas correctas
npm run typecheck    # comprobacion de tipos del servidor y del panel
```

Las pruebas estan en `src/pruebas/`. No comprueban detalles internos sino lo que promete el sistema:
que el veto del Robot 1 gana siempre, que las dos notas no se funden, que una sola fuente no es
convergencia, que las fuentes que se copian no cuentan como independientes, que la tabla de reglas
del panel coincide con la decision, etc.

## Configuracion sin tocar codigo

| Fichero | Que controla |
|---|---|
| `config/filters.yaml` | Robot 1: deteccion, filtro previo, limites de analisis, seguimiento, avisos |
| `config/scoring.yaml` | Robot 1: puntos de cada motivo, vetos, umbral de veto por riesgo |
| `config/robot3.yaml` | Robot 3: umbrales de cada nivel, avisos al dia, caducidad |

Se recargan solos al guardarlos; no hace falta reiniciar.

## Copias de seguridad

- **Cada noche a las 03:30**, `crypto-radar-backup.timer` lanza `scripts/copia-seguridad.sh`: copia
  completa de la base de datos en `/var/backups/crypto-radar/bd/`, comprobada antes de darla por
  buena, y borra las de mas de 14 dias (`BACKUP_DIAS`).
- **Restaurar:** `pg_restore --no-owner --role=radar -d radar <copia>.dump` sobre una base de datos
  vacia, como en "Trasladar el sistema". (`scripts/backup.sh` y `scripts/restaurar.sh` son de la
  instalacion con Docker y no se usan en este servidor.)

## Actualizar el codigo

```bash
cd /opt/crypto-radar
git pull                 # o traer los cambios como se prefiera
npm ci                   # solo si cambio package.json
npm run build
systemctl restart crypto-radar
```
