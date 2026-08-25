# Fuentes de datos y APIs

De donde sale cada dato del sistema, cuanto cuesta y que limites tiene.

Todas las cuentas van **a tu nombre**, con tus claves. Ninguna fuente esta atada al
desarrollador: puedes cambiar de proveedor o de plan cuando quieras editando el fichero
`.env`, sin tocar el codigo.

---

## Resumen rapido

| Servicio | Para que | Clave | Coste | Imprescindible |
|---|---|---|---|---|
| **DexScreener** | Precio, liquidez, volumen, operaciones, redes sociales | No | Gratis | Si |
| **GeckoTerminal** | Deteccion de pools nuevas, historico OHLCV | No | Gratis | Si |
| **Helius** | RPC de Solana: mint, holders, transacciones | Si | Gratis | Muy recomendable |
| **Alchemy** | RPC de Base: contrato, eventos, holders | Si | Gratis | Muy recomendable |
| **Basescan** | Creador del contrato y codigo verificado | Si | Gratis | Recomendable |
| **GoPlus Security** | Honeypot, comisiones, blacklist, permisos | No | Gratis | Si |
| **RugCheck** | Segunda opinion de seguridad en Solana | No | Gratis | Si |
| **Honeypot.is** | Simula compra y venta reales en Base | No | Gratis | Si |
| **Telegram** | Envio de alertas | Si | Gratis | Si |
| **PostgreSQL** | Historico y backtesting | — | Gratis | Si |

**Coste total de APIs: 0 USD al mes.** El unico gasto es el servidor.

---

## 1. DexScreener

**Web:** https://docs.dexscreener.com/api/reference · **Clave:** no hace falta

Fuente principal de datos de mercado. Cubre las dos cadenas con el mismo formato.

| Endpoint | Uso en el sistema |
|---|---|
| `/token-profiles/latest/v1` | Tokens recien anadidos: deteccion barata |
| `/token-boosts/latest/v1` | Tokens que pagan por visibilidad: suelen ser lanzamientos |
| `/tokens/v1/{chain}/{addresses}` | Precio, liquidez, volumen y operaciones de **hasta 30 tokens en una peticion** |
| `/latest/dex/pairs/{chain}/{pair}` | Datos de un pool concreto |

**Limites publicados:** 300 peticiones/minuto en los endpoints de pares, 60/minuto en perfiles.
El sistema se limita a **4 peticiones/segundo**, muy por debajo.

**Datos que aporta:** precio USD, capitalizacion, FDV, liquidez, volumen (5 min, 1 h, 6 h, 24 h),
numero de compras y ventas por periodo, variacion de precio, web y redes sociales, fecha de
creacion del par.

**Codigo:** [`src/sources/dexscreener.ts`](../../src/sources/dexscreener.ts)

---

## 2. GeckoTerminal

**Web:** https://api.geckoterminal.com/docs/index.html · **Clave:** no hace falta

Es el **mejor detector gratuito de pools recien creadas**, y funciona igual en Solana y Base.

| Endpoint | Uso en el sistema |
|---|---|
| `/networks/{red}/new_pools` | Pools creadas hace minutos: detector principal |
| `/networks/{red}/trending_pools` | Tokens que empiezan a moverse |
| `/networks/{red}/pools/{pool}` | Datos de un pool concreto |
| `/networks/{red}/pools/{pool}/ohlcv/{tf}` | Historico de precios para el backtesting |

**Limite publicado:** 30 peticiones/minuto. El sistema usa 0,5/segundo con margen de sobra.

**Cabecera obligatoria:** `Accept: application/json;version=20230302`

**Codigo:** [`src/sources/geckoterminal.ts`](../../src/sources/geckoterminal.ts)

---

## 3. Helius (RPC de Solana)

**Web:** https://dashboard.helius.dev · **Clave:** si · **Plan gratuito: si**

Como conseguir la clave: crear cuenta → *Create API Key* → copiar en `HELIUS_API_KEY` del `.env`.

| Metodo | Para que |
|---|---|
| `getAccountInfo` | **Mint y freeze authority**: las dos comprobaciones de seguridad clave en Solana |
| `getTokenLargestAccounts` | Las 20 mayores cuentas del token en **una sola llamada** |
| `getMultipleAccounts` | Duenos reales de esas cuentas (una cuenta de token no es su dueno) |
| `getTokenSupply` | Suministro total, base del calculo de porcentajes |
| `getSignaturesForAddress` | Transaccion mas antigua del mint = **creacion del token** |
| `getTokenAccounts` (DAS) | **Numero total de holders** y lista completa |
| `/v0/addresses/{addr}/transactions` | Transacciones ya interpretadas: quien compro, cuanto y cuando |

### Importante: sin clave de Helius

El sistema funciona igual con el RPC publico (`api.mainnet-beta.solana.com`), pero **verificado
en pruebas reales**: el RPC publico devuelve error 429 en `getTokenLargestAccounts`. Consecuencia:

- Se sigue leyendo mint y freeze authority (lo mas importante de seguridad).
- **No se puede calcular la concentracion de holders en Solana.**

La clave gratuita de Helius resuelve esto y no cuesta nada. **Es la primera clave que conviene poner.**

**Codigo:** [`src/sources/solanaRpc.ts`](../../src/sources/solanaRpc.ts)

---

## 4. Alchemy (RPC de Base)

**Web:** https://dashboard.alchemy.com · **Clave:** si · **Plan gratuito: si**

Crear una app en la red *Base Mainnet* y copiar la clave en `ALCHEMY_API_KEY`.
Alternativas equivalentes: QuickNode, Chainstack, o el RPC publico `https://mainnet.base.org`.

| Metodo | Para que |
|---|---|
| `eth_call` | Nombre, simbolo, decimales, suministro, `owner()`, saldos |
| `eth_getCode` | Comprobar que la direccion es realmente un contrato |
| `eth_getLogs` | Eventos `Transfer`: **con esto se reconstruye la lista de holders** |
| `eth_getTransactionByHash` | Bloque de creacion del token |
| `eth_blockNumber` | Bloque actual, para acotar las busquedas |

### Aviso importante: eth_getLogs y el plan gratuito

**Comprobado en pruebas reales.** El plan gratuito de Alchemy limita `eth_getLogs` a
**10 bloques por peticion**:

> *"Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range."*

Reconstruir los holders de un token necesita leer 24 h de bloques (unos 43.200), lo que
supondria mas de 4.000 peticiones por token. Inviable.

Por eso el sistema **separa el trafico**:

| Tipo de llamada | A donde va | Variable |
|---|---|---|
| `eth_call`, `eth_getCode`, `eth_blockNumber`... | Alchemy | `BASE_RPC_URL` |
| `eth_getLogs` (holders) | RPC publico de Base | `BASE_LOGS_RPC_URL` |

Ademas, si cualquiera de los dos se queja del tamano de la consulta (por rango o por
volumen de respuesta), el sistema **reduce el rango automaticamente y reintenta el mismo
tramo**, sin dejar huecos. Funciona con cualquier proveedor sin tocar codigo.

Si algun dia se contrata Alchemy de pago, basta con poner la misma URL en las dos variables.

### Como se calculan los holders en Base

En Base **no existe** una lista de holders en la cadena: hay que reconstruirla sumando y
restando todos los eventos `Transfer` desde que el token existe. Como los tokens que analizamos
son nuevos, tienen pocos eventos y esto es viable con el plan gratuito.

Se lee en tramos de 2000 bloques (configurable en `filters.yaml`) porque los planes gratuitos
limitan el rango de cada consulta. Si no se llega hasta el bloque de creacion, la lista se
marca como **parcial** y asi se indica en el panel: preferimos avisar antes que dar un dato
aparentemente exacto que no lo es.

**Codigo:** [`src/sources/baseRpc.ts`](../../src/sources/baseRpc.ts)

---

## 5. Basescan / Etherscan V2 — YA NO ES GRATIS PARA BASE

> **Comprobado en pruebas reales (agosto de 2026).** Etherscan unifico sus APIs en la V2 y
> dejo Base fuera del plan gratuito. La respuesta literal con una clave gratuita valida es:
>
> ```json
> {"status":"0","message":"NOTOK",
>  "result":"Free API access is not supported for this chain.
>            Please upgrade your api plan for full chain coverage."}
> ```
>
> Y el endpoint clasico `api.basescan.org` responde que esta obsoleto y hay que migrar a la V2.
>
> **Conclusion: no se puede usar Basescan en Base sin pagar.**

### Que se hace en su lugar (sin coste)

| Dato que daba Basescan | De donde sale ahora |
|---|---|
| Direccion del creador | **GoPlus** (`creator_address`), gratis y funciona |
| Bloque de creacion del contrato | **Biseccion sobre la cadena** con `eth_getCode`: se busca el primer bloque en el que la direccion ya tiene codigo. Unas 20 llamadas por token, 3 segundos |
| Contrato verificado si/no | **GoPlus** (`is_open_source`) |
| Blacklist, mint, comisiones modificables, proxy | **GoPlus**, que ya los analiza |
| Tokens anteriores del creador | Se construye con **nuestro propio historico**, que crece cada dia |

**Lo unico que se pierde de verdad** es leer el codigo fuente para buscar patrones a mano
(`onlyOwner`, `setFee`, `blacklist`...). Las mismas senales llegan igualmente por GoPlus,
solo que sin poder citar la linea exacta del contrato.

El sistema detecta esta situacion automaticamente, avisa **una sola vez** en el registro y
deja de gastar peticiones en Basescan. Si algun dia se contrata el plan de pago de Etherscan,
basta con poner la clave y vuelve a usarse sin tocar codigo.

### Si en algun momento se paga el plan

**Web:** https://basescan.org/myapikey · **Clave:** si · **De pago para Base**

| Endpoint | Para que |
|---|---|
| `contract/getcontractcreation` | **Quien creo el contrato** y en que transaccion |
| `contract/getsourcecode` | Codigo verificado, deteccion de proxy |
| `account/txlist` | Quien financio al creador, contratos que desplego antes |

Sobre el codigo verificado se buscan los patrones que mas dano hacen: `blacklist`, `setFee`,
`pause`, `mint`, `maxTxAmount`, `onlyOwner` sin `renounceOwnership`. No sustituye a una
auditoria, pero detecta lo habitual.

Etherscan unifico sus APIs en la V2. El sistema prueba primero
`api.etherscan.io/v2/api?chainid=8453` y, si falla, el dominio clasico `api.basescan.org/api`.

**Si no pones esta clave:** el creador se obtiene de GoPlus, que tambien lo devuelve, aunque
se pierde el analisis del codigo fuente.

**Codigo:** [`src/sources/basescan.ts`](../../src/sources/basescan.ts)

---

## 6. GoPlus Security

**Web:** https://docs.gopluslabs.io/reference/ · **Clave:** no hace falta

Cubre **las dos cadenas** y es la comprobacion de seguridad mas completa que existe gratis.

**Base** (`/token_security/8453`): honeypot, comision de compra y de venta, si se pueden
modificar, blacklist, whitelist, contrato pausable, proxy, si el owner puede recuperar la
propiedad o modificar saldos, porcentaje del creador, LP bloqueado.

**Solana** (`/solana/token_security`): mint y freeze authority, comision de transferencia
modificable, hook de transferencia modificable, autoridad que puede cambiar saldos, si las
cuentas se pueden cerrar, token no transferible.

**Codigo:** [`src/sources/goplus.ts`](../../src/sources/goplus.ts)

---

## 7. RugCheck

**Web:** https://api.rugcheck.xyz/swagger/index.html · **Clave:** no · **Solo Solana**

Segunda opinion sobre lo que ya se lee de la cadena: lista de riesgos con su nivel,
porcentaje de LP bloqueado, mayor holder y si el token ya esta marcado como *rugged*.

**Regla que sigue el sistema:** si RugCheck y la blockchain se contradicen, **manda la
blockchain**, y la discrepancia se anota en el informe.

**Codigo:** [`src/sources/rugcheck.ts`](../../src/sources/rugcheck.ts)

---

## 8. Honeypot.is

**Web:** https://api.honeypot.is/ · **Clave:** no · **Solo Base**

Es la comprobacion mas practica que existe: **simula una compra y una venta reales** para
verificar que se puede salir. Devuelve tambien las comisiones reales y el maximo que se
puede comprar o vender.

**Codigo:** [`src/sources/honeypot.ts`](../../src/sources/honeypot.ts)

---

## 9. Canales de aviso (Telegram, Discord, correo)

El sistema **no depende de ningun canal concreto**. Envia por todos los que esten
configurados a la vez, y basta con que uno funcione. Todos son gratuitos.

| Canal | Telefono | Coste | Variables en `.env` |
|---|---|---|---|
| **Correo (SMTP)** | No | Gratis | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ALERT_EMAIL_TO` |
| **Discord** | No | Gratis | `DISCORD_WEBHOOK_URL` |
| **Telegram** | Si | Gratis | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |

### Correo (SMTP)
Funciona en cualquier pais y no necesita verificacion por SMS.

**Recomendado: Gmail con contrasena de aplicacion.** No tiene proceso de revision, no
hace falta dominio propio y el limite (500 correos al dia) es 25 veces lo que consume el
sistema. Se configura activando la verificacion en dos pasos en la cuenta de Google y
generando una clave en https://myaccount.google.com/apppasswords

> **Probado y descartado: Brevo.** Ofrece 300 correos al dia gratis, pero somete las
> cuentas nuevas a una revision manual y rechaza las que no tienen dominio propio y web
> publica. En nuestras pruebas la respuesta fue *"we are unable to validate your account
> at this time"*, sin motivo ni via de apelacion. Mailjet y SMTP2GO son alternativas si
> Gmail no encaja.

El correo se envia en HTML y en texto plano a la vez, para que se vea bien en cualquier cliente.

### Discord
Crear cuenta solo pide correo electronico. Un *webhook* no necesita bot ni programacion:
servidor propio → rueda dentada del canal → *Integraciones* → *Webhooks* → *Nuevo webhook*
→ copiar la URL. Limite de 2000 caracteres por mensaje, gestionado automaticamente.

### Telegram
1. [@BotFather](https://t.me/BotFather) → `/newbot` → devuelve el token
2. [@userinfobot](https://t.me/userinfobot) → devuelve tu *Id*
3. **Escribir `/start` al bot**: Telegram no deja que un bot escriba primero

Telegram es ademas el unico canal con comandos de consulta (`/estado`, `/top`, `/filtros`...).

### Comprobar los canales

```bash
npm run test:alertas          # en local
docker compose exec radar node dist/testAlert.js   # en el servidor
```

Envia un mensaje de prueba e informa canal por canal de cual funciono y cual no.

**Codigo:** [`src/worker/notify.ts`](../../src/worker/notify.ts) (reparto y conversion de
formatos), [`src/worker/telegram.ts`](../../src/worker/telegram.ts),
[`src/worker/notifiers/discord.ts`](../../src/worker/notifiers/discord.ts),
[`src/worker/notifiers/email.ts`](../../src/worker/notifiers/email.ts)

---

## Como se controlan los limites gratuitos

Todas las llamadas pasan por un unico cliente HTTP
([`src/core/http.ts`](../../src/core/http.ts)) que aplica, por proveedor:

- **Ritmo maximo** de peticiones por segundo y peticiones simultaneas
- **Cola de espera**: si se llega al limite, la peticion espera en vez de fallar
- **Reintentos con espera creciente** ante 429, 503 o cortes de red
- **Penalizacion temporal**: tras un 429 el proveedor entra en pausa y el resto de peticiones lo respetan
- **Contador diario** visible en el panel (*Sistema*) y por Telegram (`/apis`)

Los limites estan **deliberadamente por debajo** de los publicados. Si contratas un plan de
pago, solo hay que subir el `rps` en `PROVIDER_LIMITS`.

Ademas, el sistema esta disenado en tres etapas para que las llamadas caras solo se gasten en
tokens que ya han superado un filtro barato. Es la razon por la que funciona sin pagar APIs.

---

## Que aportaria pagar (no hace falta ahora)

| Mejora | Coste | Que ganas |
|---|---|---|
| Helius de pago | ~49 USD/mes | Mas consultas, deteccion en segundos, webhooks en tiempo real |
| Alchemy de pago | ~49 USD/mes | Rangos de `eth_getLogs` mas amplios: holders exactos en tokens con mucho movimiento |
| Birdeye | ~99 USD/mes | OHLCV detallado y metricas de trading mas finas en Solana |
| gRPC dedicado | 500+ USD/mes | Deteccion en el mismo bloque. Solo si compites por segundos |

Se cambian poniendo la clave nueva en `.env`. **No hay que tocar el codigo ni rehacer nada.**
