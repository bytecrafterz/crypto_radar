# Robot 1 · Busqueda general

Detecta tokens nuevos en Solana y Base, los filtra, analiza a fondo los que pasan el filtro, les
pone dos notas (oportunidad y riesgo) con los motivos escritos, los sigue durante 7 dias y avisa.

## Que recibe

- **Nada que haya que darle:** busca por su cuenta pools nuevos cada 45 segundos en DexScreener y
  GeckoTerminal, en Solana y Base (`config/filters.yaml` → `discovery`).
- **Direcciones del Robot 2:** cuando el Robot 2 encuentra un token en Telegram, lo manda a
  `POST /api/candidato` (`src/web/server.ts`). El Robot 1 busca sus datos de mercado por su cuenta
  (nunca se fia de los numeros del mensaje) y lo analiza igual que los que encuentra el mismo.

## Que analiza, en tres etapas

### 1. Deteccion y filtro previo
`src/worker/discovery.ts`, `src/worker/prefilter.ts`. Reglas en `config/filters.yaml` → `prefilter`:

| Regla | Valor |
|---|---|
| Antiguedad del pool | entre 3 minutos y 72 horas |
| Liquidez | entre 4.000 y 3.000.000 USD |
| Volumen 24 h minimo | 3.000 USD |
| Operaciones en la ultima hora | 12 o mas |
| Compras en 24 h | 15 o mas |
| Volumen / liquidez | 60 como maximo (por encima suele ser volumen inflado) |
| Capitalizacion maxima | 20.000.000 USD |
| Moneda del par | Solana: SOL, USDC, USDT · Base: WETH, ETH, USDC, USDbC, DAI |

**Se guarda todo**, tambien lo descartado y el motivo (`tokens.status`, `tokens.discard_reason`).

### 2. Analisis a fondo
`src/worker/enrichment.ts`. Como mucho 55 tokens por hora y 1.200 al dia (`enrichment`), para no
agotar los planes gratuitos de las APIs.

| Que | Codigo | Fuentes | Se guarda en |
|---|---|---|---|
| Seguridad del contrato y de la liquidez | `src/analysis/security.ts` | blockchain, GoPlus, RugCheck (Solana), Honeypot.is (Base) | `security_reports` |
| Holders y concentracion (descontando pool, quemado y contratos) | `src/analysis/holders.ts` | Helius o RPC de Solana con RugCheck de respaldo; en Base, eventos de transferencia via Alchemy | `holder_snapshots` |
| Creador, sus tokens anteriores y quien le financio | `src/analysis/deployer.ts` | blockchain (RPC de Solana; en Base, Basescan cuando hay clave), GoPlus, historico propio | `deployer_reports`, `wallet_activity`, `wallet_stats` |
| Movimientos sospechosos | `src/analysis/manipulation.ts` | transacciones en la blockchain, datos de mercado | `suspicious_events` |
| Contexto del mercado general | `src/analysis/market.ts` | DexScreener | (se aplica a la nota) |
| Coste real de comprar y vender | `src/analysis/execution.ts` | Jupiter (cotizacion real, Solana) o formula del pool (Base) | `scores.execution` |
| Notas de oportunidad y riesgo | `src/scoring/engine.ts` | todo lo anterior + `config/scoring.yaml` | `scores` |

### 3. Seguimiento
`src/worker/monitor.ts`. Cada 5 minutos las primeras 24 horas y cada hora hasta los 7 dias, con un
maximo de 150 tokens a la vez (`monitoring`). En cada vuelta:

- Guarda una medicion de mercado (`token_snapshots`).
- Captura el precio exacto a los 5 min, 15 min, 1 h, 6 h, 24 h y 7 dias de la deteccion
  (`token_horizons`), con el resultado neto descontando el coste de entrar y salir.
- Vuelve a comprobar la seguridad cada 30 minutos y anota cualquier cambio (`security_changes`).
- Avisa de peligro si la liquidez cae un 20 % o el precio un 35 % (`liquidity_drop_alert_pct`,
  `price_crash_alert_pct`).
- Al terminar, guarda el resultado final en `token_outcomes`: **rug** si se retiro la liquidez,
  **exito** si llego a multiplicar por 2 su capitalizacion, **fracaso** si acabo por debajo de la
  mitad y **neutro** en el resto (`src/core/repo.ts` → `computeOutcome()`).

## Que produce

- Cada token con su analisis y sus dos notas, con todos los motivos (`tokens`, `scores`).
- Avisos por Telegram y Discord (`alerts`, con el texto exacto enviado y si llego a cada canal).
- Todo lo anterior en el panel: paginas **Tokens** (y la ficha de cada token), **Alertas** y
  **Resultados**.

## Como se calculan las notas

`src/scoring/engine.ts`, con los pesos de `config/scoring.yaml`. Las dos notas van de 0 a 100, se
calculan por separado y nunca se suman. En la ficha de cada token del panel se ve cada motivo con
sus puntos, el calculo completo (apartado "Como sale la nota") y de donde sale cada dato y a que
hora se tomo (apartado "De donde sale cada dato").

- **Oportunidad** = puntos a favor / maximo posible x 100. Con las reglas actuales el maximo es
  189 puntos (los de `opportunity` mas la bonificacion de `market_context.bonus_fuerza_relativa`).
  Despues, un riesgo de 50 o mas la rebaja hasta un 60 %, y el contexto del mercado la ajusta
  (`market_context`: x0,92 con el mercado muy fuerte, x0,90 con el mercado debil).
- **Riesgo** = suma de los puntos en contra, con un maximo de 100. Con el mercado debil suma 10.

### Puntos a favor (`config/scoring.yaml` → `opportunity`)

| Clave | Motivo | Puntos |
|---|---|---|
| `base_score` | Token nuevo detectado y analizado | 25 |
| `clean_security` | Sin mint, sin freeze y sin permisos peligrosos | 20 |
| `holder_growth` | Holders creciendo de 20 a 120 nuevos por hora | hasta 18 |
| `buy_pressure` | Compras / ventas entre 1,2 y 2,5 | hasta 15 |
| `deployer_good_history` | El creador ya lanzo algun token que funciono | 15 |
| `lp_locked_or_burned` | Liquidez bloqueada o quemada | 12 |
| `volume_growth` | El volumen de la ultima hora es el 15 % o mas del de 24 h | 12 |
| `distributed_holders` | Top 10 real del 25 % o menos | 12 |
| `market_context.bonus_fuerza_relativa` | Sube 10 % o mas por encima del mercado | 12 |
| `healthy_liquidity` | Liquidez de 15.000 a 60.000 USD | hasta 10 |
| `deployer_clean` | El creador no conserva suministro ni tiene historial malo | 10 |
| `price_uptrend` | Precio +5 % o mas en 1 h | 10 |
| `no_suspicious_activity` | Sin bots ni operaciones sospechosas | 10 |
| `has_socials` | Publica web y redes | 8 |

### Puntos en contra (`config/scoring.yaml` → `risk`)

| Clave | Motivo | Puntos |
|---|---|---|
| `honeypot` | Se puede comprar pero no vender | 60 |
| `liquidity_removed` | Se ha retirado liquidez | 45 |
| `deployer_bad_history` | El creador ya lanzo tokens que acabaron mal | 35 |
| `mint_authority_active` | Pueden crear mas tokens | 30 |
| `blacklist_function` | Pueden bloquear direcciones | 30 |
| `freeze_authority_active` | Pueden congelar tus tokens | 25 |
| `lp_not_locked` / `lp_partially_locked` | Liquidez sin bloquear / bloqueada menos del 80 % | 25 / 10 |
| `owner_can_modify` | El dueno puede cambiar comisiones o permisos | 25 |
| `wash_trading` | Operaciones repetidas para inflar el volumen | hasta 25 |
| `top10_concentration` | Top 10 real entre el 45 % y el 80 % | hasta 25 |
| `high_or_mutable_tax` | Comisiones del 10 % o mas, o modificables | 20 |
| `single_holder_dominant` | Una cartera con mas del 15 % | hasta 20 |
| `deployer_holds` | El creador conserva mas del 5 % | hasta 20 |
| `low_liquidity` | Liquidez de menos de 8.000 USD | hasta 20 |
| `sniper_cluster` | Varias carteras compran en el mismo bloque | hasta 20 |
| `volume_without_holders` | Mucho volumen sin holders nuevos | hasta 20 |
| `proxy_contract` | El codigo del contrato se puede sustituir | 15 |
| `deployer_serial` | El creador lanza 4 tokens o mas | 15 |
| `sell_pressure_extreme` | Ventas el doble que compras en 1 h | hasta 15 |
| `token2022_extensions` | Token-2022 con extensiones | 12 |
| `not_verified` | Contrato sin verificar | 10 |
| `no_social` | Sin web ni redes | 5 |

### Vetos (`config/scoring.yaml` → `critical_vetoes`)

Un token vetado no puede generar ningun aviso, ni del Robot 1 ni del Robot 3:
honeypot, lista negra, mint activa, freeze activa, liquidez retirada, `no_operable` (comprar y
vender cuesta mas del 10 %, `config/filters.yaml` → `execution.veto_round_trip_pct`),
`sin_ruta_de_venta` (Jupiter no encuentra forma de vender), y un riesgo total de 75 o mas
(`risk_veto_threshold`).

**No evaluable** (`evaluability`): si falta el analisis de seguridad o el estado de la liquidez, o
faltan mas de 3 comprobaciones, el token no puede avisar. El sistema no afirma lo que no ha podido
comprobar.

## Reglas de los avisos (`config/filters.yaml` → `alerts`)

| Regla | Valor |
|---|---|
| Aviso de oportunidad | oportunidad 55 o mas, riesgo 60 o menos, sin veto y evaluable |
| Tope | 4 por hora y 10 al dia, repartidos a lo largo del dia |
| No repetir el mismo token | 120 minutos |
| Avisos de peligro | solo de tokens que ya se avisaron como oportunidad; 4 por hora y 12 al dia |
| Una oportunidad deja de valer | a las 24 h, o si el volumen cae por debajo del 15 % de su maximo o la liquidez por debajo del 60 % (`invalidation`) |

## Como se ejecuta

Tres bucles del proceso de los robots (`src/worker/index.ts`): `deteccion` (cada 45 s), `analisis`
(cada minuto) y `seguimiento` (cada 5 minutos). Se arranca solo con `ROBOTS=1` (ver el documento 5).
Cada vuelta deja un latido; si un bucle se queda callado, el sistema avisa (`src/worker/vigilante.ts`)
y la tarjeta del Robot 1 en la portada del panel se pone en rojo.

## Donde verlo en el panel

- **Tokens:** todo lo detectado, con filtros por cadena, estado y notas.
- **Ficha de un token:** notas, motivos con sus puntos, "Como sale la nota", "De donde sale cada
  dato" con la fuente y la hora, seguridad, holders, creador, movimientos sospechosos, graficos y
  "Que paso despues".
- **Alertas:** cada aviso enviado y si llego a Telegram y a Discord.
- **Resultados:** que paso con lo detectado, por tramos de nota.
