# Problemas frecuentes

Que hacer cuando algo no va como esperabas.

---

## Alertas

### No puedo crear una cuenta de Telegram (no me llega el SMS)

No hace falta Telegram. El sistema envia los avisos por **tres canales** y puedes usar
cualquiera de ellos, o varios a la vez:

| Canal | Necesita telefono | Como se configura |
|---|---|---|
| **Correo** | No | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_TO` |
| **Discord** | No (solo correo) | `DISCORD_WEBHOOK_URL` |
| **Telegram** | Si | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |

**Correo (recomendado si no puedes verificar por SMS):** crea una cuenta gratuita en
https://www.brevo.com, entra en *SMTP & API* → *SMTP* y copia el login y la clave.
Son 300 correos al dia gratis.

**Discord:** crea un servidor propio → rueda dentada del canal → *Integraciones* →
*Webhooks* → *Nuevo webhook* → *Copiar URL*. Pega esa URL en `DISCORD_WEBHOOK_URL`.

Despues comprueba que funciona:

```bash
docker compose exec radar node dist/testAlert.js
```

Te dira canal por canal cual ha entregado el mensaje y cual ha fallado, con el motivo.

### Como compruebo que los avisos funcionan

```bash
docker compose exec radar node dist/testAlert.js
```

Envia un mensaje de prueba por todos los canales configurados. No hay que esperar a que
salte una alerta real.

### No me llega ninguna alerta

Por orden, de lo mas probable a lo menos:

**1. No le has escrito al bot.** Telegram no permite que un bot escriba primero. Busca tu
bot y mandale `/start`.

**2. El chat id no es correcto.** Habla con [@userinfobot](https://t.me/userinfobot); te
devuelve tu *Id*. Debe coincidir con `TELEGRAM_CHAT_ID` del `.env`.

**3. Las alertas estan pausadas.** Manda `/estado` al bot: te dira si estan pausadas. Se
reactivan con `/reanudar`.

**4. Ningun token cumple los criterios.** Es lo mas normal los primeros dias. Comprueba con
`/estado` cuantos tokens se estan analizando. Si se analizan pero no llega ninguna alerta,
baja el umbral en `config/filters.yaml`:

```yaml
alerts:
  min_opportunity_score: 45   # por defecto 55
```

**5. Comprueba si hubo errores de envio.** En el panel, pagina *Alertas*: si aparecen alertas
marcadas como "no entregada", el problema es de Telegram, no de deteccion.

### Me llegan demasiadas alertas

```yaml
alerts:
  min_opportunity_score: 70
  max_risk_score: 40
  max_alerts_per_hour: 5
```

Los cambios se aplican solos en menos de un minuto.

### Me llegaron alertas de tokens que resultaron malos

Normal, y por eso existe la pagina *Resultados*. Revisa alli los tokens marcados como `rug`
y mira que puntuacion tenian. Si varios rugs tenian riesgo bajo, sube el peso de la regla
correspondiente en `config/scoring.yaml`. Por ejemplo, si casi todos tenian la liquidez sin
bloquear:

```yaml
risk:
  lp_not_locked:
    points: 45   # por defecto 25
```

---

## Deteccion

### No detecta nada

**Los primeros minutos es normal.** El primer ciclo tarda hasta un minuto en arrancar.

Comprueba en el panel, pagina *Sistema*:
- Si las APIs aparecen con llamadas, la deteccion funciona
- Si alguna aparece en rojo o con "esperando", esa fuente esta al limite

Registros:

```bash
docker compose logs --tail 50 radar
```

Deberias ver lineas de `vuelta de deteccion completada` con el numero de pares vistos.

### Detecta muchos pero descarta casi todos

**Es el comportamiento correcto y deseado.** El filtro descarta entre el 85% y el 95%: es
justo lo que permite que el sistema funcione con planes gratuitos, porque solo se analizan
a fondo los que merecen la pena.

En el panel, pagina *Tokens*, filtra por estado `descartado`: cada uno guarda el motivo
exacto. Si ves que descarta cosas que te interesan, ajusta `prefilter` en `filters.yaml`.

### Solo detecta tokens de Solana

Normal: en Solana se crean muchisimos mas tokens que en Base. Si quieres asegurarte de que
Base funciona, filtra por cadena en la pagina *Tokens*.

---

## Datos

### Aparece "n/d" en la concentracion de holders (Solana)

Falta la clave de Helius. El RPC publico de Solana bloquea el metodo necesario.

Solucion: crear cuenta gratuita en https://dashboard.helius.dev, copiar la clave en
`HELIUS_API_KEY` del `.env` y reiniciar:

```bash
docker compose restart radar
```

### La lista de holders sale como "parcial" (Base)

Significa que no se pudo leer hasta el bloque de creacion del token. Pasa en tokens con
mucho movimiento usando RPC gratuito.

El sistema lo avisa expresamente en lugar de dar un numero enganoso. Para ese token concreto,
consulta `https://basescan.org/token/DIRECCION#balances`.

Si te pasa a menudo, pon la clave de Alchemy (gratuita) o sube en `filters.yaml`:

```yaml
enrichment:
  base_log_chunk_blocks: 5000   # por defecto 2000
```

### Un dato no coincide con DexScreener

El panel guarda una foto cada pocos minutos; DexScreener actualiza continuamente. Diferencias
pequenas son normales. Si la diferencia es grande, mira en la ficha del token el apartado
*Fuentes consultadas*: te dira si alguna fuente no respondio.

### Dice "No se pudo comprobar: ..."

Alguna fuente externa no respondio en ese momento. **La puntuacion se calcula solo con lo que
si se verifico.** El sistema prefiere avisarte de lo que falta antes que inventar un dato.
En el siguiente ciclo de seguimiento normalmente se completa.

---

## Panel web

### No abre

**1. Puerto cerrado.** En el panel de tu proveedor (Hetzner, Contabo...) abre el puerto 3000,
y en el servidor:

```bash
ufw allow 3000
```

**2. El contenedor no esta arrancado:**

```bash
docker compose ps
docker compose logs --tail 30 radar
```

**3. Estas usando `https://` sin dominio configurado.** Sin dominio, entra con `http://`.

### No acepta la contrasena

Debe ser exactamente la de `PANEL_PASSWORD` en `.env`. Si la cambias, reinicia:

```bash
docker compose restart radar
```

### La pagina Resultados esta vacia

Es lo esperado al principio. Cada token se sigue durante varios dias y solo al cerrarse se
calcula su resultado. A partir de la segunda o tercera semana empieza a tener datos utiles.

---

## Sistema

### El servidor va lento o se queda sin memoria

```bash
docker stats
```

El sistema completo deberia usar menos de 1 GB. Si va justo, baja en `filters.yaml`:

```yaml
monitoring:
  max_tracked_tokens: 80     # por defecto 150
enrichment:
  max_per_hour: 30           # por defecto 60
```

### La base de datos crece mucho

```bash
docker exec radar-db psql -U radar -d radar -c "SELECT pg_size_pretty(pg_database_size('radar'))"
```

Con el uso normal crece unos pocos cientos de MB al mes. Para limpiar mediciones antiguas de
tokens ya archivados:

```sql
DELETE FROM token_snapshots
WHERE ts < now() - interval '90 days'
  AND token_id IN (SELECT id FROM tokens WHERE status = 'archivado');
```

> No borres la tabla `tokens` ni `token_outcomes`: son la base del backtesting.

### Aparecen muchos avisos de "limite alcanzado"

Es el comportamiento correcto: el sistema detecta que una API esta al limite, **espera y
reintenta** en vez de fallar. Si pasa constantemente, sube el intervalo de deteccion:

```yaml
discovery:
  interval_seconds: 90    # por defecto 45
```

O pon las claves gratuitas de Helius y Alchemy, que amplian bastante los limites.

### Como actualizo despues de cambiar el codigo

```bash
docker compose up -d --build
```

### Como sé que todo está bien

```bash
docker compose exec radar node dist/selftest.js
```

Comprueba configuracion, base de datos, las dos cadenas y todas las APIs una a una.

---

## Cuando nada de esto ayuda

Reune esta informacion antes de pedir ayuda:

```bash
docker compose ps
docker compose logs --tail 100 radar
docker compose exec radar node dist/selftest.js
```

Con esas tres salidas se identifica practicamente cualquier problema.
