# Base de datos

PostgreSQL 16, base de datos `radar`. Las tablas se crean y actualizan solas al arrancar el sistema
con las migraciones de `db/migrations/` (registradas en `schema_migrations`). El esquema completo,
con indices y restricciones, esta en [anexos/esquema.sql](anexos/esquema.sql).

Cifras del 15 de octubre de 2026. Las filas son el recuento aproximado de PostgreSQL.

## Resumen

| Tabla | Robot | Filas | Tamano | Datos desde | Hasta |
|---|---|---:|---:|---|---|
| `tokens` | Robot 1 | 754.834 | 412 MB | 2026-04-15 | 2026-10-15 |
| `token_snapshots` | Robot 1 | 2.516.682 | 687 MB | 2026-08-15 | 2026-10-15 |
| `scores` | Robot 1 | 257.501 | 483 MB | 2026-08-15 | 2026-10-15 |
| `security_reports` | Robot 1 | 94.842 | 53 MB | 2026-08-15 | 2026-10-15 |
| `holder_snapshots` | Robot 1 | 67.196 | 103 MB | 2026-08-15 | 2026-10-15 |
| `deployer_reports` | Robot 1 | 38.011 | 12 MB |  |  |
| `suspicious_events` | Robot 1 | 56.034 | 21 MB |  |  |
| `security_changes` | Robot 1 | 911 | 312 kB |  |  |
| `token_horizons` | Robot 1 | 23.459 | 4832 kB | 2026-08-20 | 2026-10-15 |
| `token_outcomes` | Robot 1 | 29.280 | 5448 kB | 2026-08-22 | 2026-10-15 |
| `alerts` | Robots 1 y 3 | 1.582 | 2360 kB | 2026-08-15 | 2026-10-15 |
| `wallet_activity` | Robot 1 | 398.198 | 132 MB |  |  |
| `wallet_stats` | Robot 1 | 155.339 | 40 MB |  |  |
| `tg_channels` | Robot 2 | 81 | 112 kB |  |  |
| `tg_messages` | Robot 2 | 105.345 | 55 MB | 2024-05-11 | 2026-10-15 |
| `tg_mentions` | Robot 2 | 17.687 | 6992 kB | 2026-02-12 | 2026-10-15 |
| `tg_source_stats` | Robot 2 | 30 | 56 kB |  |  |
| `tg_canales_descubiertos` | Robot 2 | 345 | 184 kB |  |  |
| `tg_uniones` | Robot 2 | 130 | 80 kB |  |  |
| `tg_candidatos` | Robot 3 | 7.255 | 9528 kB | 2026-04-15 | 2026-10-15 |
| `tg_candidatos_historial` | Robot 3 | 9.579 | 2160 kB |  |  |
| `activity_log` | Sistema | 75.476 | 20 MB | 2026-08-15 | 2026-10-15 |
| `api_usage` | Sistema | 476 | 104 kB |  |  |
| `system_state` | Sistema | 18 | 64 kB |  |  |
| `schema_migrations` | Sistema | 12 | 32 kB |  |  |

Notas sobre las fechas:

- Los mensajes de Telegram empiezan antes que el sistema porque, al entrar en un canal, se lee tambien su historico reciente.
- Algunos tokens tienen fecha de deteccion anterior a agosto porque el Robot 2 los encontro mencionados en mensajes antiguos.
- Del 9 al 26 de septiembre, tras el bloqueo del servidor anterior, los avisos se reconstruyeron a partir del historico de Discord; las mediciones de precio de esos dias no existen.

## Copia completa

Cada noche se hace una copia completa (`pg_dump`, formato propio de PostgreSQL) en
`/var/backups/crypto-radar/bd/` del servidor, y cada copia se comprueba antes de darla por buena
(`scripts/copia-seguridad.sh`). Ocupa unos 340 MB. Se restaura con
`pg_restore --no-owner --role=radar -d radar <fichero>.dump` (ver el documento 5).

## Tablas y campos

### `tokens` · Robot 1

Cada token visto: datos de mercado del momento de la deteccion y los ultimos, estado (nuevo, vigilado, alertado, peligro, descartado, archivado), motivo de descarte, ultimas notas y tiempos de cada etapa.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `id` | bigint | no |
| `chain` | text | no |
| `address` | text | no |
| `pair_address` | text | si |
| `symbol` | text | si |
| `name` | text | si |
| `decimals` | integer | si |
| `dex` | text | si |
| `quote_symbol` | text | si |
| `deployer` | text | si |
| `pair_created_at` | timestamp with time zone | si |
| `first_seen` | timestamp with time zone | no |
| `last_seen` | timestamp with time zone | no |
| `status` | text | no |
| `discard_reason` | text | si |
| `website` | text | si |
| `twitter` | text | si |
| `telegram` | text | si |
| `discord` | text | si |
| `image_url` | text | si |
| `last_opportunity` | numeric | si |
| `last_risk` | numeric | si |
| `first_liquidity_usd` | numeric | si |
| `first_market_cap_usd` | numeric | si |
| `first_price_usd` | numeric | si |
| `peak_liquidity_usd` | numeric | si |
| `peak_market_cap_usd` | numeric | si |
| `peak_price_usd` | numeric | si |
| `last_price_usd` | numeric | si |
| `last_liquidity_usd` | numeric | si |
| `last_market_cap_usd` | numeric | si |
| `enriched_at` | timestamp with time zone | si |
| `alerted_at` | timestamp with time zone | si |
| `tracked_until` | timestamp with time zone | si |
| `analysis_started_at` | timestamp with time zone | si |
| `analysis_finished_at` | timestamp with time zone | si |
| `first_alert_at` | timestamp with time zone | si |
| `latency_ms` | jsonb | si |
| `light` | text | si |
| `evaluable` | boolean | si |
| `invalidated_at` | timestamp with time zone | si |
| `invalidation_reason` | text | si |

### `token_snapshots` · Robot 1

Cada medicion de mercado: precio, capitalizacion, liquidez, volumen, compras y ventas por periodo, holders. La columna source dice de donde salio.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `id` | bigint | no |
| `token_id` | bigint | no |
| `ts` | timestamp with time zone | no |
| `price_usd` | numeric | si |
| `market_cap_usd` | numeric | si |
| `fdv_usd` | numeric | si |
| `liquidity_usd` | numeric | si |
| `volume_m5` | numeric | si |
| `volume_h1` | numeric | si |
| `volume_h6` | numeric | si |
| `volume_h24` | numeric | si |
| `txns_m5_buys` | integer | si |
| `txns_m5_sells` | integer | si |
| `txns_h1_buys` | integer | si |
| `txns_h1_sells` | integer | si |
| `txns_h24_buys` | integer | si |
| `txns_h24_sells` | integer | si |
| `price_change_m5` | numeric | si |
| `price_change_h1` | numeric | si |
| `price_change_h6` | numeric | si |
| `price_change_h24` | numeric | si |
| `holders_count` | integer | si |
| `top10_pct` | numeric | si |
| `source` | text | si |

### `scores` · Robot 1

Cada calculo de las notas: oportunidad, riesgo, cada motivo con sus puntos, vetos, datos que faltaron, semaforo y coste real de operar.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `id` | bigint | no |
| `token_id` | bigint | no |
| `ts` | timestamp with time zone | no |
| `opportunity` | numeric | no |
| `risk` | numeric | no |
| `opportunity_label` | text | no |
| `risk_label` | text | no |
| `vetoed` | boolean | no |
| `opportunity_reasons` | jsonb | no |
| `risk_reasons` | jsonb | no |
| `missing_data` | jsonb | no |
| `critical_vetoes` | jsonb | no |
| `evaluable` | boolean | si |
| `light` | text | si |
| `execution` | jsonb | si |

### `security_reports` · Robot 1

Cada analisis de seguridad: autoridades, permisos, comisiones, honeypot, liquidez bloqueada o quemada, fuentes consultadas y las que no respondieron.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `id` | bigint | no |
| `token_id` | bigint | no |
| `ts` | timestamp with time zone | no |
| `mint_authority_active` | boolean | si |
| `mint_authority` | text | si |
| `freeze_authority_active` | boolean | si |
| `freeze_authority` | text | si |
| `is_token_2022` | boolean | si |
| `has_extensions` | boolean | si |
| `owner_can_modify` | boolean | si |
| `owner_address` | text | si |
| `has_blacklist` | boolean | si |
| `has_mint_function` | boolean | si |
| `is_proxy` | boolean | si |
| `is_verified` | boolean | si |
| `buy_tax_pct` | numeric | si |
| `sell_tax_pct` | numeric | si |
| `tax_modifiable` | boolean | si |
| `is_honeypot` | boolean | si |
| `lp_locked_pct` | numeric | si |
| `lp_burned_pct` | numeric | si |
| `lp_locker_name` | text | si |
| `total_supply` | text | si |
| `notes` | jsonb | no |
| `sources` | jsonb | no |
| `failed_sources` | jsonb | no |
| `raw` | jsonb | si |
| `can_sell` | boolean | si |
| `round_trip_loss_pct` | numeric | si |

### `holder_snapshots` · Robot 1

Cada foto de holders: total, top 10 y top 20 reales, mayor cartera, parte del creador y la lista de las mayores carteras.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `id` | bigint | no |
| `token_id` | bigint | no |
| `ts` | timestamp with time zone | no |
| `holders_count` | integer | si |
| `top10_pct` | numeric | si |
| `top20_pct` | numeric | si |
| `largest_real_pct` | numeric | si |
| `deployer_pct` | numeric | si |
| `partial` | boolean | no |
| `note` | text | si |
| `top_holders` | jsonb | no |

### `deployer_reports` · Robot 1

El creador de cada token: direccion, transaccion de creacion, tokens anteriores, veredicto de su historial y quien le financio.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `id` | bigint | no |
| `token_id` | bigint | no |
| `ts` | timestamp with time zone | no |
| `deployer` | text | si |
| `deploy_tx` | text | si |
| `deployed_at` | timestamp with time zone | si |
| `prior_token_count` | integer | no |
| `prior_tokens` | jsonb | no |
| `history_verdict` | text | no |
| `funded_by` | text | si |
| `note` | text | si |

### `suspicious_events` · Robot 1

Cada movimiento sospechoso detectado: tipo, gravedad, explicacion y datos.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `id` | bigint | no |
| `token_id` | bigint | no |
| `ts` | timestamp with time zone | no |
| `kind` | text | no |
| `severity` | text | no |
| `detail` | text | no |
| `data` | jsonb | si |

### `security_changes` · Robot 1

Cambios de seguridad detectados durante el seguimiento (por ejemplo, liquidez que se desbloquea).

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `id` | bigint | no |
| `token_id` | bigint | no |
| `ts` | timestamp with time zone | no |
| `field` | text | no |
| `before_val` | text | si |
| `after_val` | text | si |
| `severity` | text | no |
| `detail` | text | no |

### `token_horizons` · Robot 1

Precio exacto a los 5 min, 15 min, 1 h, 6 h, 24 h y 7 dias de la deteccion, con el multiplo neto descontando costes.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `id` | bigint | no |
| `token_id` | bigint | no |
| `horizon` | text | no |
| `captured_at` | timestamp with time zone | no |
| `minutes_after` | numeric | si |
| `price_usd` | numeric | si |
| `liquidity_usd` | numeric | si |
| `market_cap_usd` | numeric | si |
| `holders_count` | integer | si |
| `price_multiple` | numeric | si |
| `cap_multiple` | numeric | si |
| `net_multiple` | numeric | si |

### `token_outcomes` · Robot 1

Resultado final de cada token seguido: pico, final, caida maxima, rug, exito, fracaso o neutro, y la nota que tenia al detectarlo.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `token_id` | bigint | no |
| `evaluated_at` | timestamp with time zone | no |
| `hours_tracked` | numeric | si |
| `entry_market_cap` | numeric | si |
| `peak_market_cap` | numeric | si |
| `final_market_cap` | numeric | si |
| `peak_multiple` | numeric | si |
| `final_multiple` | numeric | si |
| `max_drawdown_pct` | numeric | si |
| `minutes_to_peak` | numeric | si |
| `rugged` | boolean | no |
| `rug_reason` | text | si |
| `outcome` | text | no |
| `score_at_detection` | numeric | si |
| `risk_at_detection` | numeric | si |

### `alerts` · Robots 1 y 3

Cada aviso: tipo (oportunidad, peligro, convergencia), notas, el texto exacto enviado y si llego a cada canal.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `id` | bigint | no |
| `token_id` | bigint | no |
| `ts` | timestamp with time zone | no |
| `kind` | text | no |
| `opportunity` | numeric | si |
| `risk` | numeric | si |
| `message` | text | no |
| `sent_ok` | boolean | no |
| `error` | text | si |
| `channels` | jsonb | no |

### `wallet_activity` · Robot 1

Carteras vistas en cada token (creador, primeros compradores...), con su papel, su porcentaje y cuanto tardaron en entrar.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `id` | bigint | no |
| `chain` | text | no |
| `wallet` | text | no |
| `token_id` | bigint | no |
| `ts` | timestamp with time zone | no |
| `role` | text | no |
| `balance_pct` | numeric | si |
| `minutes_after_launch` | numeric | si |
| `note` | text | si |

### `wallet_stats` · Robot 1

Resumen por cartera: tokens en los que aparecio, cuantos fueron exito o rug y su tiempo medio de entrada. Es la base para el analisis de carteras que entran pronto.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `chain` | text | no |
| `wallet` | text | no |
| `tokens_seen` | integer | no |
| `tokens_success` | integer | no |
| `tokens_rugged` | integer | no |
| `avg_entry_minutes` | numeric | si |
| `score` | numeric | no |
| `flags` | jsonb | no |
| `first_seen` | timestamp with time zone | no |
| `updated_at` | timestamp with time zone | no |

### `tg_channels` · Robot 2

Los canales de Telegram que se leen o se leyeron, con su origen y si siguen activos.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `id` | bigint | no |
| `tg_id` | bigint | no |
| `username` | text | si |
| `title` | text | si |
| `lang` | text | si |
| `added_at` | timestamp with time zone | no |
| `active` | boolean | no |
| `notas` | text | si |
| `ultimo_msg_id` | bigint | no |
| `leido_at` | timestamp with time zone | si |
| `via` | text | no |

### `tg_messages` · Robot 2

Cada mensaje leido, tal cual, con su hora; el resultado del primer filtro y de la clasificacion, el resumen en espanol, el idioma, el tipo de senal y lo que afirma.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `id` | bigint | no |
| `channel_id` | bigint | no |
| `tg_msg_id` | bigint | no |
| `posted_at` | timestamp with time zone | no |
| `received_at` | timestamp with time zone | no |
| `text` | text | si |
| `text_hash` | text | si |
| `edited_at` | timestamp with time zone | si |
| `deleted` | boolean | no |
| `triage` | text | si |
| `triage_motivo` | text | si |
| `triage_at` | timestamp with time zone | si |
| `clasificacion` | text | si |
| `clasificacion_motivo` | text | si |
| `clasificacion_confianza` | integer | si |
| `clasificado_at` | timestamp with time zone | si |
| `clasificacion_intentos` | integer | no |
| `resumen_es` | text | si |
| `idioma` | text | si |
| `tipo_senal` | text | si |
| `afirmaciones` | jsonb | si |

### `tg_mentions` · Robot 2

Cada mencion de un token en un mensaje, con su anticipacion respecto al movimiento del precio.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `id` | bigint | no |
| `message_id` | bigint | no |
| `channel_id` | bigint | no |
| `chain` | text | si |
| `address` | text | si |
| `resuelto_por` | text | si |
| `tipo_senal` | text | si |
| `confianza` | integer | si |
| `posted_at` | timestamp with time zone | no |
| `es_primera` | boolean | no |
| `anticipacion_seg` | integer | si |
| `creado_at` | timestamp with time zone | no |
| `anticipacion_veredicto` | text | si |

### `tg_source_stats` · Robot 2

La reputacion de cada canal y de donde sale: tokens citados, veces primero, anticipacion media y tasa de acierto.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `channel_id` | bigint | no |
| `tokens_citados` | integer | no |
| `veces_primero` | integer | no |
| `anticipacion_med` | integer | si |
| `tasa_utiles` | numeric | si |
| `tasa_ruido` | numeric | si |
| `actualizado` | timestamp with time zone | no |

### `tg_canales_descubiertos` · Robot 2

Canales encontrados por el propio robot y que se hizo con cada uno (unido, descartado, abandonado) y por que.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `id` | bigint | no |
| `username` | text | si |
| `tg_id` | bigint | si |
| `title` | text | si |
| `miembros` | integer | si |
| `lang` | text | si |
| `descubierto_por` | text | no |
| `origen_id` | bigint | si |
| `score` | integer | si |
| `motivo_score` | text | si |
| `estado` | text | no |
| `motivo_estado` | text | si |
| `visto_at` | timestamp with time zone | no |
| `unido_at` | timestamp with time zone | si |
| `revisado_at` | timestamp with time zone | si |

### `tg_uniones` · Robot 2

Registro de cada union a un canal, para respetar el limite diario.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `id` | bigint | no |
| `canal_id` | bigint | si |
| `username` | text | si |
| `accion` | text | no |
| `resultado` | text | si |
| `detalle` | text | si |
| `ts` | timestamp with time zone | no |

### `tg_candidatos` · Robot 3

Un veredicto por token: nivel, cada valor comparado de los dos robots, hora del aviso y, en detalle, las reglas aplicadas con su resultado y la explicacion.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `id` | bigint | no |
| `chain` | text | no |
| `address` | text | no |
| `primera_mencion` | timestamp with time zone | no |
| `fuentes_total` | integer | no |
| `fuentes_indep` | integer | no |
| `anticipacion_seg` | integer | si |
| `score_social` | integer | si |
| `score_fuentes` | integer | si |
| `score_evidencia` | integer | si |
| `score_tecnica` | integer | si |
| `score_riesgo` | integer | si |
| `vetado` | boolean | si |
| `nivel` | text | si |
| `enviado_at` | timestamp with time zone | si |
| `creado_at` | timestamp with time zone | no |
| `detalle` | jsonb | si |

### `tg_candidatos_historial` · Robot 3

Cada cambio de nivel de un veredicto, con los valores y el precio de ese momento.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `id` | bigint | no |
| `candidato_id` | bigint | no |
| `ts` | timestamp with time zone | no |
| `nivel` | text | no |
| `nivel_antes` | text | si |
| `score_tecnica` | integer | si |
| `score_riesgo` | integer | si |
| `fuentes_indep` | integer | si |
| `precio_usd` | numeric | si |

### `activity_log` · Sistema

Registro de actividad que se ve en el panel (Sistema): arranques, errores, avisos del vigilante.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `id` | bigint | no |
| `ts` | timestamp with time zone | no |
| `level` | text | no |
| `area` | text | no |
| `message` | text | no |
| `data` | jsonb | si |

### `api_usage` · Sistema

Llamadas de cada dia a cada proveedor de datos, con errores y limites alcanzados.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `day` | date | no |
| `provider` | text | no |
| `calls` | bigint | no |
| `errors` | bigint | no |
| `rate_hits` | bigint | no |

### `system_state` · Sistema

Valores internos: latidos de cada tarea, avisos pausados, sal de las sesiones del panel.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `key` | text | no |
| `value` | jsonb | no |
| `updated_at` | timestamp with time zone | no |

### `schema_migrations` · Sistema

Que migraciones de la base de datos se han aplicado.

| Campo | Tipo | Puede estar vacio |
|---|---|---|
| `name` | text | no |
| `applied_at` | timestamp with time zone | no |
