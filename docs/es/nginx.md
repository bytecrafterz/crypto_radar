# Nginx delante del panel

El panel funciona perfectamente solo, pero poner Nginx delante aporta tres cosas:

- **El puerto 3000 deja de estar expuesto**: solo Nginx habla con la aplicacion.
- **Freno a los intentos de acceso**: 10 por minuto. Sin esto, alguien puede probar
  contrasenas sin limite contra el formulario.
- **Cabeceras de seguridad y compresion** para todas las paginas.

Hay dos configuraciones, segun donde lo ejecutes.

---

## En el servidor (con Docker)

Ya viene preparado. Arranca con el perfil `nginx`:

```bash
docker compose --profile nginx up -d
```

El panel queda en `http://LA-IP-DEL-SERVIDOR:8080`.

**Importante:** una vez tengas Nginx delante, deja de publicar el puerto 3000. En
`docker-compose.yml`, en el servicio `radar`:

```yaml
    ports:
      - '127.0.0.1:${PANEL_PORT:-3000}:3000'
```

Con eso la aplicacion solo escucha dentro del servidor y la unica puerta de entrada
es Nginx. Aplica el cambio con `docker compose up -d`.

Para cambiar el puerto publico, en el `.env`:

```bash
NGINX_PORT=8080
```

### ¿Nginx o Caddy?

Los dos hacen lo mismo aqui. La diferencia practica:

| | Caddy | Nginx |
|---|---|---|
| HTTPS automatico | Si, sin configurar nada | Hay que gestionar el certificado aparte |
| Necesita dominio | Si | No |
| Freno de fuerza bruta | No configurado | Si, incluido |

**Con dominio propio: Caddy** (`--profile publico`), por el HTTPS automatico.
**Sin dominio, solo por IP: Nginx** (`--profile nginx`).

No arranques los dos a la vez.

---

## En tu ordenador (Windows, sin Docker)

Sirve para probar el sistema en local antes de subirlo.

**1. Descargar Nginx**

Desde https://nginx.org/en/download.html, la version *Stable*, y descomprimir
en `C:\tools\`.

**2. Arrancar la aplicacion** (en una ventana de PowerShell):

```powershell
cd c:\Users\Administrator\Documents\Blockchain

$env:DATABASE_URL='postgres://radar:LA-CONTRASENA@127.0.0.1:5433/radar'
$env:PANEL_PASSWORD='la-que-quieras'
$env:SESSION_SECRET='un-texto-largo-de-mas-de-32-caracteres'
$env:HOST='127.0.0.1'
$env:PORT='3000'

node dist/index.js
```

`HOST=127.0.0.1` es importante: hace que la aplicacion solo acepte conexiones desde
el propio ordenador, y que la unica via de entrada sea Nginx.

**3. Arrancar Nginx** (en otra ventana):

```powershell
$nginx = 'C:\tools\nginx-1.28.0'
$cfg   = 'c:\Users\Administrator\Documents\Blockchain\nginx\local.windows.conf'

# Comprobar la configuracion antes de arrancar
& "$nginx\nginx.exe" -p "$nginx\" -c $cfg -t

# Arrancar
Start-Process -FilePath "$nginx\nginx.exe" -ArgumentList @('-p', "$nginx\", '-c', $cfg) -WindowStyle Hidden
```

**4. Abrir el panel**

```
http://localhost:8080
```

Se usa el 8080 porque en Windows los puertos 80 y 443 suelen estar ocupados.

**Para parar Nginx:**

```powershell
& "$nginx\nginx.exe" -p "$nginx\" -s stop
```

---

## Comprobar que funciona

```bash
curl http://localhost:8080/salud
```

Debe responder `{"ok":true,...}`.

Y para comprobar el freno de fuerza bruta, lanza varios intentos seguidos con una
contrasena incorrecta: a partir del quinto, Nginx responde **429** en lugar de
dejarlos pasar.

---

## Problemas frecuentes

**"CreateFile() mime.types failed"**
Estas usando la configuracion del servidor en local. Usa `nginx/local.windows.conf`,
que no depende de ficheros de la carpeta de Nginx.

**El panel da 502**
La aplicacion no esta arrancada, o esta escuchando en otro puerto. Comprueba con
`curl http://127.0.0.1:3000/salud`.

**El puerto 8080 esta ocupado**
Cambia `listen 8080;` en `nginx/local.windows.conf` por otro puerto libre.

**Nginx no arranca y no dice por que**
Mira `C:\tools\nginx-1.28.0\logs\error.log`.
