# Crypto Radar

Sistema de deteccion, analisis y alertas de tokens en etapa temprana en **Solana** y **Base**.

Detecta tokens y pools nuevos, los analiza automaticamente (mercado, seguridad, holders,
creador y movimientos sospechosos), calcula una puntuacion de **oportunidad** y otra de
**riesgo** explicando siempre los motivos, y avisa por **Telegram**. Todo queda guardado
en tu propia base de datos desde el primer minuto.

> El sistema **solo lee informacion publica de la blockchain**. No compra, no vende y no
> tiene ningun acceso a wallets ni a fondos.

---

## Que hace, en orden

```
   1. DETECCION            2. FILTRO           3. ANALISIS PROFUNDO      4. SEGUIMIENTO
   cada 45 segundos        instantaneo         solo los que pasan        cada 5 minutos
   ┌──────────────┐        ┌──────────┐        ┌────────────────┐        ┌──────────────┐
   │ GeckoTerminal│───────▶│ liquidez │───────▶│ seguridad      │───────▶│ liquidez     │
   │ DexScreener  │        │ volumen  │        │ holders        │        │ precio       │
   │              │        │ edad     │        │ creador        │        │ holders      │
   │ Solana +Base │        │ ratios   │        │ manipulacion   │        │ ventas       │
   └──────────────┘        └──────────┘        └────────────────┘        └──────────────┘
      ~2000/dia            descarta 90-95%        50-150/dia                 avisos
                                                       │                        │
                                                       ▼                        ▼
                                            ┌─────────────────────────────────────────┐
                                            │  PUNTUACION  oportunidad + riesgo        │
                                            │  con los motivos explicados uno a uno    │
                                            └─────────────────────────────────────────┘
                                                       │
                                    ┌──────────────────┴──────────────────┐
                                    ▼                                     ▼
                            Alertas de Telegram                    Panel web + historico
```

**La clave del diseno:** las llamadas caras (RPC, holders, seguridad) solo se gastan en los
tokens que superan el filtro barato. Por eso el sistema funciona con planes gratuitos.

---

## Que analiza

| Area | Que mira |
|---|---|
| **Mercado** | Precio, capitalizacion, liquidez, volumen y su evolucion |
| **Operaciones** | Compras y ventas, presion compradora o vendedora |
| **Holders** | Numero de holders, crecimiento y concentracion del top 10 **descontando pool, quemado y contratos** |
| **Creador** | Quien creo el token, que lanzo antes y como acabo |
| **Seguridad Solana** | Mint authority, freeze authority, extensiones de Token-2022 |
| **Seguridad Base** | Permisos del owner, blacklist, honeypot, comisiones, proxy, contrato verificado |
| **Liquidez** | Si esta bloqueada o quemada, y aviso inmediato ante retiradas |
| **Manipulacion** | Compras agrupadas en el mismo bloque, wash trading, volumen sin holders, bots |
| **Puntuacion** | Oportunidad y riesgo por separado, con los motivos concretos |

---

## Puesta en marcha

```bash
bash scripts/instalar-servidor.sh   # Docker, cortafuegos, carpetas (una sola vez)
cp .env.example .env
bash scripts/generar-secretos.sh    # genera las contrasenas
nano .env                           # pega las claves de las APIs y del correo
bash scripts/desplegar.sh           # arranca y comprueba que todo responde
```

Panel: `http://IP-DEL-SERVIDOR:3000` · Alertas: tu bot de Telegram

Guia completa paso a paso: **[docs/es/instalacion.md](docs/es/instalacion.md)**

### Comprobar que todo funciona

```bash
docker compose exec radar node dist/selftest.js
```

Verifica configuracion, base de datos, las dos cadenas y todas las APIs, una por una.

---

## Coste mensual

| Concepto | Coste |
|---|---|
| Servidor (unico gasto imprescindible) | 5 – 15 USD |
| DexScreener, GeckoTerminal, GoPlus, RugCheck, Honeypot.is | **gratis** |
| Avisos: Telegram, Discord o correo (uno o varios) | **gratis** |
| Helius (Solana), Alchemy (Base) | **gratis** (planes gratuitos) |
| Basescan | *no se usa: Etherscan ya no cubre Base gratis* |
| Base de datos y panel | **gratis** (van en el mismo servidor) |

Detalle de cada fuente, sus limites y que aporta pagar: **[docs/es/apis.md](docs/es/apis.md)**

---

## Documentacion

| Documento | Para que sirve |
|---|---|
| [Instalacion](docs/es/instalacion.md) | Montarlo desde cero en un servidor |
| [Administracion](docs/es/operaciones.md) | Mantenerlo: copias, actualizaciones, traspaso |
| [Manual de uso](docs/es/manual-uso.md) | Usar el panel, las alertas y ajustar los filtros |
| [APIs y fuentes](docs/es/apis.md) | De donde sale cada dato, limites y costes |
| [Verificar los datos](docs/es/verificar-datos.md) | Comprobar en la blockchain cualquier dato del panel |
| [Alcance](docs/es/alcance.md) | Que incluye el sistema y que no |
| [Problemas frecuentes](docs/es/faq.md) | Que hacer cuando algo falla |

---

## Estructura del codigo

```
config/                 Filtros y pesos de la puntuacion (YAML, se editan sin tocar codigo)
db/migrations/          Esquema de la base de datos
src/
  core/                 Configuracion, base de datos, HTTP con control de limites, utilidades
  sources/              Una fuente de datos por fichero (DexScreener, Helius, GoPlus...)
  analysis/             Seguridad, holders, creador, manipulacion
  scoring/              Motor de puntuacion y explicaciones
  worker/               Deteccion, analisis, seguimiento, alertas, bot de Telegram
  web/                  Panel web (paginas generadas en el servidor)
```

## Comandos

```bash
npm run dev         # desarrollo con recarga automatica
npm run build       # compilar
npm start           # arrancar (compilado)
npm run migrate     # aplicar migraciones
npm run selftest    # comprobar que todo responde
npm run typecheck   # revisar tipos
```

---

## Aviso

Esta herramienta **detecta, analiza y avisa**. Da informacion para decidir mejor y, sobre
todo, para evitar proyectos con mala pinta. **No garantiza beneficios ni dice que comprar.**
La decision siempre es tuya.
