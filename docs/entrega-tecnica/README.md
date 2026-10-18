# Crypto Radar · Entrega tecnica

Documentacion para que cualquier programador pueda revisar, instalar, mantener y modificar el
sistema sin depender de quien lo construyo. Esta organizada por robot, como se pidio.

Todo lo que aqui se describe esta en este mismo repositorio. Cada regla indica el fichero de
configuracion o la funcion del codigo donde esta definida, y cada dato la tabla donde se guarda.

## Contenido

| Documento | Que contiene |
|---|---|
| [1-robot-1.md](1-robot-1.md) | Robot 1 (busqueda general): que recibe, que analiza, que produce, fuentes, reglas y notas |
| [2-robot-2.md](2-robot-2.md) | Robot 2 (Telegram): canales, lectura, filtro, clasificacion, anticipacion y reputacion |
| [3-robot-3.md](3-robot-3.md) | Robot 3 (comparacion y seleccion): datos que cruza, reglas, niveles y avisos |
| [4-base-de-datos.md](4-base-de-datos.md) | Las 25 tablas, sus campos, cuantos datos hay y desde cuando |
| [5-instalacion-y-ejecucion.md](5-instalacion-y-ejecucion.md) | Instalar en otro servidor, arrancar cada robot por separado o juntos, registros, copias |
| [6-demostracion-higgs.md](6-demostracion-higgs.md) | Un token real seguido de principio a fin, con las consultas SQL para comprobar cada valor |
| [7-alcance-y-estado.md](7-alcance-y-estado.md) | Que se acordo, que se entrego y que quedo fuera, punto por punto |
| [8-cuentas-accesos-y-derechos.md](8-cuentas-accesos-y-derechos.md) | Cuentas y claves que usa el sistema, accesos, licencias y cesion de derechos |
| [9-cesion-de-derechos.md](9-cesion-de-derechos.md) | Confirmacion por escrito de los derechos de uso, modificacion y transferencia del codigo |
| [anexos/](anexos/) | Esquema SQL completo, lista de canales de Telegram y licencias de las dependencias |

Documentacion anterior que sigue vigente, en [../es/](../es/): manual de uso, APIs utilizadas,
como verificar datos en la blockchain, operaciones y alcance.

## El sistema en pocas lineas

- **Lenguaje y piezas:** TypeScript sobre Node.js (20.10 o superior; en produccion, 24),
  PostgreSQL 16, servidor web Fastify y panel en React. Todo en este repositorio.
- **Un proceso o varios:** por defecto un solo proceso arranca el panel y los tres robots. Con las
  variables `ROBOTS` y `WEB_ENABLED` se puede arrancar cada robot por separado (ver el documento 5).
- **Una base de datos compartida:** los tres robots escriben y leen la misma base de datos. El
  Robot 2 pasa cada token que encuentra al Robot 1 mediante `POST /api/candidato`, y el Robot 3 lee
  lo que han guardado los otros dos.
- **Configuracion sin tocar codigo:** `config/filters.yaml` (Robot 1: filtros y avisos),
  `config/scoring.yaml` (Robot 1: notas) y `config/robot3.yaml` (Robot 3: umbrales). Se recargan
  solas al guardarlas.
- **Pruebas automaticas:** `npm test` ejecuta 126 comprobaciones; deben salir todas correctas.

## Codigo por robot

| Pieza | Carpeta o fichero |
|---|---|
| Arranque | `src/index.ts` (panel + robots), `src/worker/index.ts` (bucles de cada robot) |
| Robot 1 | `src/worker/discovery.ts`, `src/worker/enrichment.ts`, `src/worker/monitor.ts`, `src/analysis/`, `src/scoring/engine.ts`, `src/sources/`, `src/worker/alerts.ts` |
| Robot 2 | `src/telegram/` (lectura, descubrimiento, triaje, clasificador, anticipacion), `src/worker/telegram.ts` (bot de avisos y comandos) |
| Robot 3 | `src/robot3/` (evaluador, reglas, fuentes independientes, coherencia, umbrales) |
| Panel | `src/web/` (servidor y API) y `web/` (interfaz) |
| Base de datos | `db/migrations/` (se aplican solas al arrancar), `src/core/repo.ts` |
| Pruebas | `src/pruebas/` |

## Como comprobar que la entrega es verificable

Es la lista de la seccion 5 de la peticion, con donde se comprueba cada punto:

| Punto | Donde |
|---|---|
| Codigo fuente completo, dependencias y versiones | Este repositorio; `package.json` y `package-lock.json` fijan cada version |
| Fuentes y datos de cada robot | Documentos 1, 2 y 3, apartado "Fuentes" |
| Bases de datos | Documento 4 y `anexos/esquema.sql`; la copia completa de la base de datos se hace cada noche en el servidor |
| Reglas con su ubicacion | Documentos 1, 2 y 3, apartado "Reglas"; en el panel, cada regla del Robot 3 dice donde esta definida |
| Instrucciones de ejecucion y registros | Documento 5 |
| Consultar cada robot por separado | Panel: Tokens y Alertas (Robot 1), Telegram (Robot 2), Convergencia (Robot 3), con el filtro "Hoy"; en la portada, una tarjeta por robot con su estado y la lista "Cuales son (hoy)" de sus tokens; en Telegram, `/robots` y la lista de cada robot con `/robot1`, `/robot2` y `/robot3` |
| Ver la comparacion real del Robot 3 | Panel: ficha de cualquier token evaluado, seccion "Decision del Robot 3" |
| Seguir una decision hasta el codigo, la configuracion y los registros | Documento 6 (HIGGS) y, en el panel, el apartado "Para revisarlo en el codigo y en la base de datos" de cada decision |
