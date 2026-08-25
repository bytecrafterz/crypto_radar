# Manual de uso

Como usar el panel, entender las alertas y ajustar el sistema a tu manera de trabajar.

---

## 1. Como leer una alerta

Cada alerta de Telegram tiene siempre la misma estructura:

```
⭐ PEPE · Solana · raydium
Pepe on Solana

Oportunidad 72/100 (FUERTE)   🟡 Riesgo 28/100 (MEDIO)

Mercado
Precio: $0.0000412   Cap: $412.0K
Liquidez: $48.2K   Volumen 24 h: $186.3K
Compras/ventas 1 h: 142 / 61   Precio 1 h: +18.4%
Edad del par: 2h 14min

Seguridad
Mint authority: ✅ revocada
Freeze authority: ✅ revocada
Liquidez: ✅ asegurada al 100%

Holders
Total: 412
Top 10 real: 22.4% (sin pool ni quemado)
El creador conserva: 1.2%
Crecimiento: 87 holders/hora

Por que es interesante
✅ Seguridad limpia: sin mint, sin freeze y sin permisos peligrosos
✅ Los holders crecen a ritmo de 87 por hora
✅ Mas compras que ventas: 142 compras frente a 61 ventas (2.3 a 1)
✅ Suministro bien repartido: el top 10 real solo tiene el 22.4%

Riesgos detectados
⚠️ Liquidez de 48.2K USD: cualquier venta mueve bastante el precio
```

### Las dos puntuaciones

**Nunca se mezclan en un solo numero**, y es a proposito: un token puede ser muy interesante
y muy peligroso a la vez. Esconder eso detras de una media seria enganarte.

| Oportunidad | Significa |
|---|---|
| 85 – 100 | MUY FUERTE |
| 70 – 84 | FUERTE |
| 55 – 69 | INTERESANTE |
| 40 – 54 | OBSERVAR |
| 0 – 39 | DESCARTADO |

| Riesgo | Significa |
|---|---|
| 0 – 20 | BAJO |
| 21 – 45 | MEDIO |
| 46 – 70 | ALTO |
| 71 – 100 | CRITICO |

Si el riesgo pasa de **75** el token queda vetado: no se envia como oportunidad aunque
puntue muy alto. Ese umbral se cambia en `config/scoring.yaml` (`risk_veto_threshold`).

Ademas, cuando el riesgo pasa de 50 la puntuacion de oportunidad **se rebaja
automaticamente**. No tiene sentido presentar como buena ocasion algo que probablemente
sea una trampa.

### Lo que NO se ha podido comprobar

Si al final de la alerta aparece:

```
No se pudo comprobar: concentracion de holders, estado de la liquidez.
```

significa que alguna fuente no respondio. **La puntuacion se calcula solo con lo verificado.**
El sistema prefiere avisarte de lo que le falta antes que inventarse un dato.

---

## 2. Avisos de peligro

Ademas de las oportunidades, el sistema vigila los tokens ya detectados y avisa cuando algo
va mal, **aunque en su momento no te lo enviara como oportunidad**:

```
🔴 AVISO · PEPE · Solana

• La liquidez ha bajado un 62.4%: de 48200 USD a 18100 USD.
• El precio ha caido un 41.2% en 5 minutos.

Liquidez actual: $18.1K   Precio 1 h: -44.8%
Riesgo: 88/100 (CRITICO)
```

Estos avisos son los que evitan que te quedes dentro de un proyecto que se esta hundiendo.

---

## 3. Comandos de Telegram

| Comando | Que hace |
|---|---|
| `/estado` | Tokens detectados, analizados y vigilados hoy |
| `/top` | Los 5 tokens con mejor puntuacion |
| `/ultimas` | Las ultimas alertas enviadas |
| `/filtros` | Que criterios se estan aplicando ahora |
| `/apis` | Cuantas llamadas llevas hoy en cada servicio gratuito |
| `/pausar` | Dejar de recibir alertas (el sistema sigue analizando y guardando) |
| `/reanudar` | Volver a recibirlas |
| `/ayuda` | Lista de comandos |

---

## 4. El panel web

### Resumen
Cuantos tokens se han detectado, analizado y descartado hoy, las mejores oportunidades del
momento, las ultimas alertas y la actividad del sistema.

### Tokens
Listado completo con buscador y filtros por cadena, estado, puntuacion minima de oportunidad
y riesgo maximo. **Aqui esta todo lo que el sistema ha visto**, incluido lo descartado.

Estados posibles:

| Estado | Que significa |
|---|---|
| `nuevo` | Detectado, esperando analisis profundo |
| `vigilado` | Analizado y en seguimiento |
| `alertado` | Se te ha enviado una alerta |
| `peligro` | Se han detectado senales graves |
| `descartado` | No supero el filtro (el motivo queda guardado) |
| `archivado` | Termino su periodo de seguimiento; ya tiene resultado calculado |

### Ficha de un token
Todo lo que se sabe: puntuaciones con **todos los motivos y cuantos puntos aporta cada uno**,
graficos de precio, liquidez y holders, informe de seguridad completo, lista de los mayores
holders con su etiqueta (wallet, pool, quemado, creador), datos del creador y movimientos
sospechosos detectados con su fecha.

### Alertas
Historico completo de avisos, incluidos los que no se pudieron entregar.

### Resultados
**Aqui es donde el sistema demuestra si acierta.** Cuando un token termina su periodo de
seguimiento se calcula automaticamente que paso con el:

| Resultado | Criterio |
|---|---|
| `exito` | Llego a multiplicar por 2 o mas su capitalizacion |
| `neutro` | Se movio poco |
| `fracaso` | Perdio mas de la mitad de su valor |
| `rug` | Se retiro casi toda la liquidez |

La tabla **acierto segun la puntuacion** cruza la nota que dio el sistema con lo que paso
despues. Si funciona bien, los tramos altos deben concentrar mas exitos y menos rugs.
Con esos datos ajustas los umbrales con criterio, no a ojo.

> Esta pagina necesita tiempo. Los primeros dias estara casi vacia: cada token tarda varios
> dias en cerrarse. A partir de la segunda o tercera semana empieza a ser util.

### Sistema
Configuracion activa, que fuentes se estan usando y **cuantas llamadas llevas en cada API
gratuita**. Si algo va mal, aqui aparece el aviso.

---

## 5. Ajustar los filtros

Se edita `config/filters.yaml`. **No hace falta reiniciar**: el sistema recarga los cambios
solo en menos de un minuto.

### Recibo demasiadas alertas

```yaml
alerts:
  min_opportunity_score: 70    # subir (por defecto 55)
  max_risk_score: 40           # bajar (por defecto 60)
  max_alerts_per_hour: 6       # bajar (por defecto 12)
```

### Recibo muy pocas

```yaml
prefilter:
  min_liquidity_usd: 2000      # bajar (por defecto 4000)
  min_volume_h24_usd: 1500     # bajar (por defecto 3000)
  min_txns_h1: 6               # bajar (por defecto 12)

alerts:
  min_opportunity_score: 45    # bajar
```

### Solo quiero tokens muy recientes

```yaml
prefilter:
  max_pair_age_hours: 12       # por defecto 72
```

### Solo una cadena

```yaml
discovery:
  chains: [solana]             # o [base]
```

### Quiero ser mas estricto con la seguridad

En `config/scoring.yaml`, sube los puntos de las reglas que mas te importen:

```yaml
risk:
  mint_authority_active:
    points: 50                 # por defecto 30
  lp_not_locked:
    points: 45                 # por defecto 25
```

O desactiva una regla que no te interese:

```yaml
opportunity:
  price_uptrend:
    enabled: false
```

---

## 6. Rutina recomendada

**Los primeros dias:** deja los filtros como estan y observa. Mira el panel una vez al dia
y fijate en si las alertas que llegan tienen sentido.

**A partir de la primera semana:** entra en *Resultados*. Aunque haya pocos tokens cerrados,
ya veras si el sistema esta descartando cosas que deberia detectar (o al reves).

**A partir de la tercera semana:** la tabla de acierto por puntuacion ya tiene datos
suficientes. Ajusta `min_opportunity_score` al tramo donde de verdad se concentran los aciertos.

**Siempre:** usa las alertas para **descartar**, no solo para entrar. La mayor parte del valor
del sistema esta en evitar los proyectos que van a salir mal.

---

## 7. Aviso importante

La herramienta detecta, analiza y avisa. **No garantiza beneficios ni te dice que comprar.**
Ningun sistema automatico puede hacerlo. Lo que si hace, y hace bien, es darte en un minuto
la informacion que te llevaria media hora reunir a mano, y avisarte de las senales de alarma
que es facil pasar por alto.

La decision siempre es tuya.
