# Instalacion

Guia completa para montar el sistema desde cero. Tiempo aproximado: **30 minutos**.

---

## 1. Que necesitas antes de empezar

| Cosa | Donde se consigue | Coste |
|---|---|---|
| Un servidor Linux | Hetzner, Contabo, DigitalOcean... | 5 – 15 USD/mes |
| Bot de Telegram | [@BotFather](https://t.me/BotFather) en Telegram | Gratis |
| Tu id de Telegram | [@userinfobot](https://t.me/userinfobot) en Telegram | Gratis |
| Clave de Helius | https://dashboard.helius.dev | Gratis |
| Clave de Alchemy | https://dashboard.alchemy.com | Gratis |
| ~~Clave de Basescan~~ | *ya no se usa: Etherscan dejo de dar acceso gratuito a Base* | — |

**Servidor recomendado:** Hetzner CX22 (2 nucleos, 4 GB RAM, 40 GB disco) por unos 4,50 €/mes.
Con eso sobra. Elige **Ubuntu 24.04**.

Las claves de Helius y Alchemy son opcionales para arrancar, pero conviene ponerlas: son
gratis, y sin la de Helius no se puede medir la concentracion de holders en Solana.

**Basescan ya no hace falta:** Etherscan dejo de incluir Base en su plan gratuito. El
sistema obtiene el creador del contrato de GoPlus y deduce el bloque de creacion leyendo
la propia cadena, asi que no se pierde nada. Detalle completo en [APIs](apis.md).

---

## 2. Preparar el servidor

Conectate por SSH:

```bash
ssh root@LA-IP-DE-TU-SERVIDOR
```

Instala Docker (un solo comando, tarda un par de minutos):

```bash
curl -fsSL https://get.docker.com | sh
```

Comprueba que ha ido bien:

```bash
docker --version && docker compose version
```

---

## 3. Copiar el proyecto

```bash
mkdir -p /opt/crypto-radar && cd /opt/crypto-radar
```

Sube aqui los ficheros del proyecto (con `scp`, `git clone` o el metodo que prefieras).

---

## 4. Configurar

```bash
cp .env.example .env
nano .env
```

Rellena como minimo estas lineas:

```bash
# Telegram (imprescindible para recibir alertas)
TELEGRAM_BOT_TOKEN=8123456789:AAF...el-token-que-te-dio-BotFather
TELEGRAM_CHAT_ID=123456789

# Claves gratuitas (muy recomendables)
HELIUS_API_KEY=tu-clave-de-helius
ALCHEMY_API_KEY=tu-clave-de-alchemy

# Seguridad: CAMBIA ESTAS DOS
PANEL_PASSWORD=una-contrasena-buena-y-tuya
SESSION_SECRET=un-texto-largo-y-aleatorio-de-al-menos-32-caracteres
POSTGRES_PASSWORD=otra-contrasena-distinta-para-la-base-de-datos
```

Para generar contrasenas seguras:

```bash
openssl rand -base64 32
```

Guarda con `Ctrl+O`, `Enter`, y sal con `Ctrl+X`.

---

## 5. Arrancar

```bash
docker compose up -d --build
```

La primera vez tarda 2-3 minutos (compila la imagen). Despues arranca en segundos.

Comprueba que los dos servicios estan en marcha:

```bash
docker compose ps
```

Deberias ver `radar-db` y `radar-app` como *running*.

Mira los registros:

```bash
docker compose logs -f radar
```

Cuando veas `Crypto Radar en marcha` ya esta funcionando. Sal con `Ctrl+C` (eso solo cierra
la vista de registros, no el sistema).

---

## 6. Comprobar que todo responde

```bash
docker compose exec radar node dist/selftest.js
```

Revisa una a una la configuracion, la base de datos, las dos cadenas y todas las APIs.
Debe terminar con `15 de 15 comprobaciones correctas`.

Si alguna fuente externa falla, normalmente es temporal. Vuelve a lanzarlo en unos minutos.

---

## 7. Entrar en el panel

Abre en el navegador:

```
http://LA-IP-DE-TU-SERVIDOR:3000
```

Introduce la contrasena que pusiste en `PANEL_PASSWORD`.

---

## 8. Activar el bot de Telegram

Busca tu bot en Telegram y **escribele `/start`**. Es obligatorio: Telegram no permite que un
bot escriba a alguien que no le ha hablado antes.

Si todo esta bien, recibiras el mensaje de arranque. Prueba con `/estado`.

---

## 9. (Opcional) Dominio con HTTPS

Si tienes un dominio, apunta un registro `A` a la IP del servidor y anade al `.env`:

```bash
DOMINIO=radar.tudominio.com
```

Arranca con el perfil publico:

```bash
docker compose --profile publico up -d
```

Caddy obtiene el certificado automaticamente. El panel queda en `https://radar.tudominio.com`.

Cierra entonces el puerto 3000 al exterior. **Atencion: no basta con ufw.**

Docker publica los puertos escribiendo directamente en las reglas de red, por
debajo de ufw, asi que `ufw deny 3000` **no cierra** un puerto publicado por
Docker. Hay que dejar de publicarlo.

En `docker-compose.yml`, cambia la linea de puertos del servicio `radar`:

```yaml
    ports:
      - '127.0.0.1:${PANEL_PORT:-3000}:3000'   # solo accesible desde el propio servidor
```

Y aplica el cambio:

```bash
docker compose up -d
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
```

Para comprobar desde tu ordenador que ya no responde:

```bash
curl -m 5 http://LA-IP-DEL-SERVIDOR:3000/salud    # debe fallar
```

---

## Cortafuegos (recomendado, aunque no uses dominio)

```bash
ufw allow 22
ufw allow 3000
ufw enable
```

---

## Copias de seguridad

Copia diaria de la base de datos:

```bash
mkdir -p /opt/backups
crontab -e
```

Anade esta linea:

```
0 4 * * * docker exec radar-db pg_dump -U radar radar | gzip > /opt/backups/radar-$(date +\%F).sql.gz && find /opt/backups -name '*.sql.gz' -mtime +14 -delete
```

Guarda una copia cada dia a las 4 de la manana y borra las de mas de 14 dias.

Para restaurar:

```bash
gunzip -c /opt/backups/radar-2026-08-15.sql.gz | docker exec -i radar-db psql -U radar radar
```

---

## Mantenimiento habitual

```bash
# Ver los registros
docker compose logs -f radar

# Reiniciar
docker compose restart radar

# Parar todo
docker compose down

# Actualizar despues de cambiar el codigo
docker compose up -d --build

# Ver cuanto ocupa la base de datos
docker exec radar-db psql -U radar -d radar -c "SELECT pg_size_pretty(pg_database_size('radar'))"
```

**Los filtros no necesitan reinicio.** Edita `config/filters.yaml` o `config/scoring.yaml` y
el sistema los recarga solo en menos de un minuto.

---

## Si algo falla

Consulta [problemas frecuentes](faq.md). Los tres fallos mas habituales:

1. **No llegan alertas** → comprueba el canal con `docker compose exec radar node dist/testAlert.js`.
2. **El panel no abre** → falta abrir el puerto 3000 en el cortafuegos del proveedor.
3. **No detecta nada** → normal durante los primeros minutos; mira `Sistema` en el panel.
