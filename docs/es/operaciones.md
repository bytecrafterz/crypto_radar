# Manual de administracion

Todo lo que hay que saber para instalar, mantener y traspasar el sistema.
Cada tarea es un comando. No hay que tocar codigo para nada de lo que hay aqui.

---

## Instalacion desde cero (una sola vez, ~20 minutos)

### 1. Preparar el servidor

```bash
ssh root@LA-IP-DEL-SERVIDOR
```

Subir el proyecto a `/opt/crypto-radar`. Desde tu ordenador:

```bash
scp -r ./crypto-radar root@LA-IP:/opt/
```

O si esta en un repositorio:

```bash
mkdir -p /opt && cd /opt && git clone LA-URL crypto-radar
```

Despues, en el servidor:

```bash
cd /opt/crypto-radar
bash scripts/instalar-servidor.sh
```

Instala Docker, abre los puertos, ajusta la zona horaria y crea memoria de
intercambio si el servidor tiene poca RAM. Tarda 2-3 minutos.

> **Si da un error raro tipo "bad interpreter"**, los ficheros se subieron con
> finales de linea de Windows. Se arregla con:
> `apt install -y dos2unix && dos2unix scripts/*.sh`

### 2. Configurar

```bash
cp .env.example .env
bash scripts/generar-secretos.sh
nano .env
```

`generar-secretos.sh` crea las tres contrasenas (panel, sesion y base de datos) y las
escribe solo. **Apunta la del panel**, que es con la que se entra.

En `nano` hay que rellenar a mano las claves de los servicios:

```bash
# Alertas por correo (Brevo)
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=login-de-brevo
SMTP_PASS=clave-smtp-de-brevo
SMTP_FROM=radar@tucorreo.com
ALERT_EMAIL_TO=donde-quieres-recibir-las-alertas@correo.com

# Claves gratuitas de las cadenas
HELIUS_API_KEY=...
ALCHEMY_API_KEY=...
BASESCAN_API_KEY=...
```

Guardar con `Ctrl+O`, `Enter`, salir con `Ctrl+X`.

### 3. Arrancar

```bash
bash scripts/desplegar.sh
```

Construye, arranca, espera a que responda y pasa las 14 comprobaciones.
Al terminar te dice la direccion del panel.

### 4. Comprobar que llegan las alertas

```bash
docker compose exec radar node dist/testAlert.js
```

Envia un mensaje de prueba por todos los canales configurados y dice cual funciono.

### 5. Programar las copias de seguridad

```bash
crontab -e
```

Anadir esta linea (copia diaria a las 4 de la manana):

```
0 4 * * * cd /opt/crypto-radar && bash scripts/backup.sh >> /var/log/radar-backup.log 2>&1
```

---

## Uso diario

### Ver como va todo

```bash
bash scripts/estado.sh
```

Contenedores, memoria, disco, tamano de la base de datos, cuantos tokens se han detectado
y analizado hoy, alertas enviadas, y los ultimos errores. **Es lo primero que hay que
mirar siempre.**

### Ver el registro en directo

```bash
docker compose logs -f radar
```

Salir con `Ctrl+C` (solo cierra la vista, no para el sistema).

### Reiniciar

```bash
docker compose restart radar
```

### Parar y arrancar

```bash
docker compose down      # para todo
docker compose up -d     # arranca todo
```

---

## Cambios habituales

### Ajustar los filtros o la puntuacion

```bash
nano config/filters.yaml     # que tokens entran y cuando avisar
nano config/scoring.yaml     # cuanto pesa cada criterio
```

**No hace falta reiniciar.** El sistema los recarga solo en menos de un minuto.

### Cambiar una clave de API o el correo de destino

```bash
nano .env
docker compose restart radar
```

Aqui si hace falta reiniciar, porque las variables de entorno se leen al arrancar.

### Anadir o cambiar el canal de alertas

En `.env`, rellenar el bloque que corresponda y reiniciar:

| Canal | Variables |
|---|---|
| Correo | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_TO` |
| Discord | `DISCORD_WEBHOOK_URL` |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |

Se pueden tener varios a la vez. Comprobar despues con `dist/testAlert.js`.

### Actualizar despues de cambiar el codigo

```bash
bash scripts/actualizar.sh
```

Hace copia de seguridad, reconstruye, reinicia, aplica las migraciones nuevas,
comprueba que responde y limpia las imagenes viejas.

---

## Copias de seguridad

### Hacer una ahora

```bash
bash scripts/backup.sh
```

Guarda en `/opt/backups` y borra las de mas de 14 dias.

### Ver las que hay

```bash
ls -lh /opt/backups/
```

### Restaurar

```bash
bash scripts/restaurar.sh /opt/backups/radar-2026-08-16-0400.sql.gz
```

Pide confirmacion escribiendo `SI`, y **antes de restaurar guarda una copia del estado
actual**, por si acaso.

### Descargar una copia a tu ordenador

```bash
scp root@LA-IP:/opt/backups/radar-2026-08-16-0400.sql.gz .
```

---

## Consultas directas a la base de datos

```bash
docker exec -it radar-db psql -U radar -d radar
```

Salir con `\q`. Consultas utiles:

```sql
-- Lo detectado hoy, lo mejor primero
SELECT chain, symbol, status, last_opportunity, last_risk, last_liquidity_usd
FROM tokens WHERE first_seen > CURRENT_DATE
ORDER BY last_opportunity DESC NULLS LAST LIMIT 20;

-- Por que se ha descartado cada token
SELECT symbol, discard_reason FROM tokens
WHERE status = 'descartado' ORDER BY first_seen DESC LIMIT 20;

-- Alertas y si se entregaron
SELECT ts, kind, opportunity, risk, sent_ok, channels FROM alerts
ORDER BY ts DESC LIMIT 20;

-- Consumo de las APIs por dia
SELECT * FROM api_usage ORDER BY day DESC, calls DESC LIMIT 20;
```

Exportar a Excel:

```bash
docker exec radar-db psql -U radar -d radar \
  -c "\copy (SELECT * FROM tokens) TO STDOUT WITH CSV HEADER" > tokens.csv
```

---

## Problemas y solucion rapida

| Sintoma | Que hacer |
|---|---|
| El panel no abre | `bash scripts/estado.sh` · comprobar que el puerto 3000 esta abierto en el panel del proveedor |
| No llegan alertas | `docker compose exec radar node dist/testAlert.js` — dice el motivo exacto |
| No detecta nada | `docker compose logs --tail 50 radar` · buscar "vuelta de deteccion completada" |
| Holders vacios en Solana | Falta `HELIUS_API_KEY`. El RPC publico bloquea ese metodo |
| Va lento o sin memoria | Bajar `max_tracked_tokens` y `max_per_hour` en `filters.yaml` |
| Disco lleno | `docker image prune -af` y borrar copias antiguas de `/opt/backups` |
| Muchos avisos de "limite alcanzado" | Es normal: espera y reintenta. Si es constante, subir `interval_seconds` |
| Todo raro sin motivo | `docker compose down && docker compose up -d` |

Lista completa en [problemas frecuentes](faq.md).

---

## Seguridad basica

```bash
# Cambiar la contrasena de root
passwd

# Ver quien ha entrado
last -n 20

# Mantener el sistema actualizado (una vez al mes)
apt update && apt upgrade -y

# Cambiar la contrasena del panel
nano .env        # editar PANEL_PASSWORD
docker compose restart radar
```

El puerto de la base de datos **no esta abierto al exterior**: solo se puede llegar a ella
desde dentro del servidor. El panel pide contrasena y la API devuelve error sin sesion.

---

## Traspasar el sistema a otra persona

Todo lo que hay que entregar:

1. **Accesos del servidor**: IP, usuario y contrasena de root, y la cuenta del proveedor
2. **Contrasena del correo del proyecto**: con ella hereda las cuentas de Helius, Alchemy,
   Basescan y Brevo de una sola vez
3. **Contrasena del panel** y de la base de datos (estan en `.env`)
4. **El codigo fuente** y esta documentacion
5. **Cambiar la facturacion**: en el proveedor del servidor, Facturacion → Metodo de pago

Comprobacion final antes de traspasar:

```bash
bash scripts/estado.sh
docker compose exec radar node dist/selftest.js
docker compose exec radar node dist/testAlert.js
bash scripts/backup.sh
```

Si esas cuatro cosas salen bien, el sistema esta en condiciones de entregarse.

---

## Resumen de comandos

```bash
bash scripts/instalar-servidor.sh    # preparar el servidor (una vez)
bash scripts/generar-secretos.sh     # crear las contrasenas
bash scripts/desplegar.sh            # arrancar todo
bash scripts/estado.sh               # ver como va
bash scripts/actualizar.sh           # actualizar tras cambiar el codigo
bash scripts/backup.sh               # copia de seguridad
bash scripts/restaurar.sh FICHERO    # restaurar una copia

docker compose logs -f radar                        # registro en directo
docker compose restart radar                        # reiniciar
docker compose exec radar node dist/selftest.js     # comprobar las 14 fuentes
docker compose exec radar node dist/testAlert.js    # probar las alertas
docker exec -it radar-db psql -U radar -d radar     # entrar en la base de datos
```
