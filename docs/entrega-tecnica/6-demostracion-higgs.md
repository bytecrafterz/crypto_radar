# Demostracion: HIGGS, de principio a fin

Un token real que el sistema selecciono (Convergencia fuerte, aviso enviado el 4 de octubre de
2026 a las 14:46, hora de Madrid), seguido por los tres robots, con la consulta SQL que comprueba
cada dato y el codigo que lo produjo.

- **Token:** HIGGS (Higgspad), Solana, `DoVAVzViX8Bjy3r15nwikSaSbzE6dV4ovd28aWpJpump`
- **En el panel:** `/token/solana/DoVAVzViX8Bjy3r15nwikSaSbzE6dV4ovd28aWpJpump`, seccion
  "Decision del Robot 3" (o desde Convergencia → filtro "Convergencia fuerte" → HIGGS)
- **Identificadores:** token `tokens.id = 3872029`, veredicto `tg_candidatos.id = 412091`,
  nota del Robot 1 usada `scores.id = 173199`, aviso `alerts.id = 1774`

Las horas de la base de datos estan en UTC (Madrid = UTC+2 en octubre).

## 1. Robot 1: deteccion

| Hora (Madrid) | Hecho | Comprobacion |
|---|---|---|
| 14:26:34 | Se crea el pool en PumpSwap | `SELECT pair_created_at FROM tokens WHERE id = 3872029;` |
| 14:28:10 | El Robot 1 lo detecta: capitalizacion 24.646 USD, liquidez 8.459 USD, fuente GeckoTerminal | `SELECT first_seen, first_market_cap_usd, first_liquidity_usd FROM tokens WHERE id = 3872029;` y `SELECT ts, source FROM token_snapshots WHERE token_id = 3872029 ORDER BY ts LIMIT 1;` |

Codigo: `src/worker/discovery.ts` (deteccion), `src/worker/prefilter.ts` (filtro previo).

## 2. Robot 2: Telegram

| Hora (Madrid) | Canal | Mensaje (resumido) |
|---|---|---|
| 14:33:49 | @pumpfunnevadie (Pumpfun Ultimate Alert) | Higgspad ($HIGGS/SOL) en Pump.fun, con la direccion, capitalizacion 43.070 USD |
| 14:36:15 | @pumpdotfunalert | Alerta de compras: 5 SOL en 5 compras en 3 minutos, +1.211 % |
| 14:38:11 | @KOLscope | "Call" de un KOL a 109.000 USD de capitalizacion |

Tres canales distintos, cada uno con su propio texto: tres fuentes independientes.

```sql
SELECT me.posted_at, c.username, m.text, m.clasificacion, me.anticipacion_seg, me.anticipacion_veredicto
  FROM tg_mentions me
  JOIN tg_messages m ON m.id = me.message_id
  JOIN tg_channels c ON c.id = me.channel_id
 WHERE me.address = 'DoVAVzViX8Bjy3r15nwikSaSbzE6dV4ovd28aWpJpump'
 ORDER BY me.posted_at;
```

La primera mencion tiene `anticipacion_seg = 518`: el mensaje llego 518 segundos (9 minutos) antes
de que el precio cruzara una subida del 25 % (`src/telegram/anticipacion.ts` →
`calcularAnticipacion()`). La reputacion de los canales esta en `tg_source_stats`.

Codigo: `src/telegram/colector-mt.ts` (lectura), `triaje.ts` (primer filtro), `resolver.ts`
(direccion del token), `anticipacion.ts` (anticipacion y reputacion).

## 3. Robot 1: analisis a fondo

A las 14:42:27 termina el analisis; la nota que uso el Robot 3 es la de las 14:43:46
(`scores.id = 173199`):

```sql
SELECT ts, opportunity, risk, vetoed, evaluable, opportunity_reasons, risk_reasons, execution
  FROM scores WHERE id = 173199;
SELECT * FROM security_reports WHERE token_id = 3872029 ORDER BY ts LIMIT 1;
SELECT * FROM holder_snapshots WHERE token_id = 3872029 ORDER BY ts LIMIT 1;
SELECT * FROM deployer_reports WHERE token_id = 3872029;
```

| Lo que encontro | Valor | Puntos |
|---|---|---|
| Mint y freeze authority | revocadas (fuentes: RPC de Solana, RugCheck, GoPlus, Jupiter) | +20 |
| Liquidez | bloqueada o quemada al 100 % | +12 |
| Holders | 1.608 reales; top 10 con el 15,4 % (sin pool); mayor cartera 3,1 % | +12 |
| Creador | conserva el 0 % | +10 |
| Volumen | la ultima hora concentra todo el volumen del dia | +12 |
| Frente al mercado | sube un 793 % mas que el mercado general | +12 |
| Precio | +794 % en la ultima hora | +10 |
| Liquidez | 62.021 USD | +10 |
| Sin actividad sospechosa · web y X | | +10 +8 |
| Punto de partida | | 25 |
| **Oportunidad** | **141 de 189 puntos posibles = 74,6** | |
| Creador en serie | habia lanzado 25 tokens antes | riesgo +15 |
| Token-2022 con extensiones | | riesgo +12 |
| **Riesgo** | **27** | |
| Compra y venta | cotizacion real de Jupiter: comprar y vender 200 USD costaba un 3,2 % | |

Codigo: `src/worker/enrichment.ts`, `src/analysis/*.ts`, `src/scoring/engine.ts`; reglas en
`config/scoring.yaml`.

## 4. Robot 3: comparacion y decision

```sql
SELECT nivel, score_tecnica, score_riesgo, vetado, fuentes_total, fuentes_indep,
       score_fuentes, anticipacion_seg, enviado_at, detalle
  FROM tg_candidatos WHERE id = 412091;
SELECT ts, nivel_antes, nivel, score_tecnica, score_riesgo, fuentes_indep, precio_usd
  FROM tg_candidatos_historial WHERE candidato_id = 412091 ORDER BY ts;
```

| Hora (Madrid) | Paso |
|---|---|
| 14:45:50 | Primer veredicto: Convergencia (precio 0,0004806 USD) |
| 14:46:35 | Sube a Convergencia fuerte (precio 0,0006582 USD) y sale el aviso por Telegram y Discord |

| Regla de Convergencia fuerte | Exige | HIGGS | Resultado |
|---|---|---|---|
| Sin veto del Robot 1 | sin veto | sin veto | cumple |
| El Robot 1 pudo comprobar lo esencial | si | si | cumple |
| Oportunidad (Robot 1) | 55 o mas | 75 | cumple |
| Riesgo (Robot 1) | 40 o menos | 27 | cumple |
| Canales independientes (Robot 2) | 2 o mas | 3 | cumple |
| Reputacion media de esos canales (Robot 2) | 50 o mas | 51 | cumple |
| Informacion antes del movimiento (Robot 2) | antes | 9 min antes | cumple |
| La cadena no desmiente lo que dicen los mensajes | ninguna contradiccion | ninguna | cumple |

Explicacion guardada (`tg_candidatos.detalle`): "Analisis tecnico fuerte (74.6) con riesgo bajo
(27). 3 fuentes independientes, no copias unas de otras. La informacion aparecio 9 min antes del
movimiento."

Este veredicto es anterior a que cada decision guardara su tabla de reglas (15 de octubre); el panel
la recalcula con los valores que si se guardaron y lo indica. Desde el 15 de octubre cada veredicto
guarda en `detalle.reglas` la tabla exacta con la que se decidio.

Codigo: `src/robot3/evaluador.ts` → `evaluarToken()` (reune los datos y guarda el veredicto),
`src/robot3/convergencia.ts` → `decidir()` y `reglasNivelMaximo()`, `src/robot3/fuentes.ts` →
`contarFuentes()`, `src/robot3/coherencia.ts`; umbrales en `config/robot3.yaml`.

## 5. El aviso

```sql
SELECT ts, kind, opportunity, risk, sent_ok, channels, message FROM alerts WHERE id = 1774;
```

Tipo `convergencia`, enviado a las 14:46 por Telegram y Discord, con el texto exacto en `message`.

## 6. Que paso despues

Medido desde el precio del aviso (0,0006582 USD): en las 24 horas siguientes llego a 8,4 veces ese
precio, su punto mas bajo fue 0,52 veces, y a las 24 horas estaba a 2,03 veces. A las 15:20 el
Robot 1 aviso de peligro (caida del 36 % en 5 minutos) y desde entonces detecto wash trading.

```sql
SELECT MAX(price_usd) / 0.0006582 AS maximo_24h, MIN(price_usd) / 0.0006582 AS minimo_24h
  FROM token_snapshots
 WHERE token_id = 3872029
   AND ts > '2026-10-04 12:46:35+00' AND ts <= '2026-10-05 12:46:35+00';
SELECT * FROM suspicious_events WHERE token_id = 3872029 ORDER BY ts;
```

Cuando salio el aviso el precio ya habia subido unas 40 veces desde la deteccion (estos tokens se
mueven muchisimo en sus primeros minutos); por eso el resultado se mide desde el aviso y no desde la
deteccion. Las tres fuentes de Telegram eran canales automaticos de alertas y de "calls": el
Robot 3 no se fia de lo que dicen, sino de cuando lo dicen y del historial real de cada canal.
