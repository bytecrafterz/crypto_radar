# Robot 3 · Comparacion y seleccion

Recoge, para cada token del que se habla en Telegram, la lectura del Robot 1 (los datos de la
cadena) y la del Robot 2 (lo que se dice y quien lo dice), las pone una al lado de la otra,
comprueba que no se contradigan y aplica unas reglas fijas para asignarle un nivel. Solo el nivel
maximo, **Convergencia fuerte**, envia aviso. Las dos lecturas nunca se mezclan en una sola nota.

## Que recibe

Todo lo lee de la base de datos que comparten los tres robots (`src/robot3/evaluador.ts`):

| Del Robot 1 (`reunirSenalTecnica()`) | De donde |
|---|---|
| Nota de oportunidad y de riesgo vigentes | `tokens.last_opportunity`, `tokens.last_risk` (la ultima fila de `scores`) |
| Si esta vetado y por que, y si fue evaluable | ultima fila de `scores`: `vetoed`, `evaluable`, `critical_vetoes` |
| Si la oportunidad ya se dio por perdida | `tokens.invalidated_at` (cuenta como veto) |
| Hechos de seguridad para contrastar lo que dicen los mensajes | ultima fila de `security_reports` |
| Riesgos detectados | ultimos `suspicious_events` de gravedad aviso o peligro |

| Del Robot 2 (`reunirSenalSocial()`) | De donde |
|---|---|
| Canales que hablaron del token y cuales son independientes | `tg_mentions` + `tg_messages` (`contarFuentes()`) |
| Reputacion media de esos canales | `tg_source_stats.tasa_utiles`, media por canal |
| Anticipacion: si se hablo antes del movimiento del precio | `tg_mentions.anticipacion_seg` (solo menciones tras las que hubo movimiento) |
| Que afirman los mensajes (liquidez bloqueada, sin permisos, sin impuestos, no honeypot, advertencia) | `tg_messages.afirmaciones` |
| Tipo de senal (listing, lanzamiento, partnership, ballena, negativo, llamada) | `tg_mentions.tipo_senal` |
| Lo que dicen, resumido en espanol | `tg_messages.resumen_es` |

## Que analiza

`src/robot3/convergencia.ts` → `decidir()`, en este orden:

1. **Veto del Robot 1:** si el token esta vetado, queda descartado, hable de el quien hable. Es
   fijo en el codigo y no se puede desactivar.
2. **Comprobacion minima:** si el Robot 1 no pudo comprobar lo esencial, queda descartado.
3. **Coherencia** (`src/robot3/coherencia.ts` → `verificarCoherencia()`): lo que afirman los
   mensajes se contrasta con la cadena. Lo que la cadena confirma es evidencia; lo que desmiente es
   una contradiccion, y con una sola contradiccion el token ya no puede llegar al nivel maximo.
   Tambien son contradicciones: varias fuentes independientes recomendando un token con riesgo
   mayor de 60, o Telegram avisando de algo negativo con los datos tecnicos por encima de 60.
4. **Reglas de cada nivel** (`reglasNivelMaximo()`, `reglasNivelIntermedio()`): cada regla dice que
   exige, que valor tiene el token y si se cumple. Un nivel se alcanza si se cumplen todas sus
   reglas. Es la misma lista que ensena el panel, asi que lo que se ve es lo que se aplico.

### Reglas de Convergencia fuerte (el unico nivel que avisa)

| Regla | Robot | Exige | Definida en |
|---|---|---|---|
| Sin veto del Robot 1 | 1 | sin veto | `convergencia.ts` → `decidir()` (fijo) |
| El Robot 1 pudo comprobar lo esencial | 1 | si | `config/scoring.yaml` → `evaluability` |
| Nota de oportunidad | 1 | 55 o mas | `config/robot3.yaml` → `nivel_maximo.tecnica_minima` |
| Nota de riesgo | 1 | 40 o menos | `config/robot3.yaml` → `nivel_maximo.riesgo_maximo` |
| Canales independientes con informacion util | 2 | 2 o mas | `config/robot3.yaml` → `nivel_maximo.fuentes_independientes_minimas` |
| Reputacion media de esos canales | 2 | 50 o mas | `config/robot3.yaml` → `nivel_maximo.reputacion_minima` |
| La informacion aparecio antes del movimiento | 2 | antes | `convergencia.ts` → `puntuarAnticipacion()` |
| La cadena no desmiente lo que dicen los mensajes | 1 y 2 | ninguna contradiccion | `coherencia.ts` → `verificarCoherencia()` |

### Los demas niveles

| Nivel | Exige | Avisa |
|---|---|---|
| Convergencia | sin veto, evaluable, oportunidad 45 o mas, riesgo 60 o menos (`nivel_intermedio`) y al menos una fuente independiente | No |
| Seguimiento | se habla del token, pero no cumple lo anterior | No |
| Descartado | vetado por el Robot 1 o sin datos suficientes | No |

### Componentes que se guardan (para explicar, no para decidir)

Ademas de las reglas, cada veredicto guarda unas puntuaciones de 0 a 100 que el panel ensena como
barras: tecnica y riesgo (las del Robot 1, tal cual), senal social (hasta 40 por fuentes
independientes, hasta 15 por numero total de fuentes, 25 si es listing, lanzamiento, partnership o
ballena y 20 si se pudo comprobar algo de lo que dicen), reputacion de las fuentes, anticipacion
(100 si fue hasta 30 minutos antes, 80 hasta 2 horas, 55 hasta 6 horas y 30 mas alla) y evidencia
(100 si la cadena confirmo algo de lo que dicen). El nivel lo deciden solo las reglas de arriba.

## Que produce

- **Un veredicto por token** en `tg_candidatos`: el nivel, cada valor comparado y, en la columna
  `detalle`, el motivo, la explicacion, las confirmaciones y contradicciones, los resumenes en
  espanol y, desde el 15 de octubre, **las reglas aplicadas con su resultado, los umbrales en vigor
  y los datos exactos de cada robot** (`reglas`, `umbrales`, `datos`, `evaluadoEn`).
- **Cada cambio de nivel** en `tg_candidatos_historial`, con los valores y el precio de ese momento.
- **El aviso**, solo en Convergencia fuerte, en `alerts` (tipo `convergencia`) y por Telegram y
  Discord.

Una vez enviado el aviso, el veredicto no se vuelve a tocar: es el registro de lo que se envio y
con que datos.

## Reglas de los avisos (`config/robot3.yaml`)

| Regla | Valor |
|---|---|
| Nivel que avisa | solo Convergencia fuerte |
| Tope | 3 al dia (`avisos_por_dia`) |
| Un aviso retenido por el tope o por la pausa caduca | a las 2 horas de llegar al nivel (`aviso_caduca_horas`) |
| Avisos por token | uno; se marca como enviado antes de enviarlo, para que nunca salga dos veces |
| Pausa | el boton "Pausar los avisos" del panel tambien para los del Robot 3 |

## Como se ejecuta

Bucle `robot3-convergencia` cada 5 minutos (`src/worker/index.ts` → `runRobot3()`): evalua los
tokens mencionados en las ultimas 24 horas que el Robot 1 ya analizo, y los que siguen en
seguimiento con un nivel distinto de descartado. Ademas, en cuanto el Robot 2 detecta que el precio
de un token se movio tras una mencion, el Robot 3 lo evalua en ese momento sin esperar a su vuelta.
Se arranca solo con `ROBOTS=3` (ver el documento 5).

## Donde verlo en el panel

- **Convergencia:** cada veredicto en una tarjeta, con las dos lecturas una al lado de la otra,
  la lista de reglas de Convergencia fuerte con su resultado y un enlace a la decision completa. El
  filtro "Convergencia fuerte" es la seleccion final.
- **Ficha de un token, seccion "Decision del Robot 3":** la tabla de reglas (que exige cada una,
  el valor del token, si la cumple y donde esta definida), la nota del Robot 1 que se uso y como se
  calculo, los canales del Robot 2 con su mensaje original, su hora y su reputacion, la explicacion,
  el historial de niveles y donde esta cada dato en la base de datos y en el codigo, con las
  consultas SQL para comprobarlo.
- **Resultados → "¿Acierta el Robot 3?":** que hizo el precio en las 24 horas siguientes a cada
  nivel.

## Como comprobar una decision a mano

```sql
-- El veredicto, con todo lo que se guardo
SELECT * FROM tg_candidatos WHERE chain = 'solana' AND address = '<direccion>';
-- Cada cambio de nivel, con valores y precio
SELECT * FROM tg_candidatos_historial WHERE candidato_id = <id> ORDER BY ts;
-- La nota del Robot 1 vigente en ese momento
SELECT * FROM scores WHERE token_id = (SELECT id FROM tokens WHERE address = '<direccion>')
  AND ts <= '<momento>' ORDER BY ts DESC LIMIT 1;
-- Lo que se dijo en Telegram hasta ese momento
SELECT me.posted_at, c.username, m.text, m.clasificacion, me.anticipacion_seg, s.tasa_utiles
  FROM tg_mentions me JOIN tg_messages m ON m.id = me.message_id
  JOIN tg_channels c ON c.id = me.channel_id LEFT JOIN tg_source_stats s ON s.channel_id = c.id
 WHERE me.address = '<direccion>' AND me.posted_at <= '<momento>' ORDER BY me.posted_at;
```

El documento 6 lo hace completo con un token real.
