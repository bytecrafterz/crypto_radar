# Que se acordo, que se entrego y que quedo fuera

Respuesta punto por punto a la seccion 4 de la peticion: el estado real de cada componente y si
formaba parte de lo acordado.

## Los dos encargos

**Robot 1 (busqueda general).** La descripcion del proyecto en Workana pedia un "Crypto Early
Opportunity Radar" amplio. Antes de empezar se acordo por escrito el alcance real del presupuesto
aceptado (300 USD), en dos hitos:

- **Hito 1:** deteccion temprana en Solana y Base, datos de mercado (precio, capitalizacion,
  liquidez, volumen), compras y ventas, seguridad del token y del contrato, mint y freeze authority,
  estado de la liquidez y aviso ante retiradas, alertas de Telegram con filtros configurables, y base
  de datos guardando todo desde el primer dia.
- **Hito 2:** holders y concentracion del top 10 (descontando pool y quemado), identificacion del
  creador y su historial, movimientos sospechosos y senales de manipulacion, notas de oportunidad y
  riesgo con los motivos explicados, panel web completo, instalacion en el servidor, documentacion
  en espanol y videollamada de formacion.
- **Fuera de este presupuesto, tal como se acordo:** analisis profundo de insiders, actividad de X,
  Telegram y Discord, clasificacion de narrativa, wallets con historial de aciertos y el modulo de
  backtesting completo, dejando el sistema preparado para incorporarlos y guardando los datos desde
  el primer dia.

**Robots 2 y 3.** Segundo encargo: el Robot 2 (radar de informacion en Telegram, en espanol,
portugues e ingles, separando las senales utiles del ruido, identificando fuentes de interes y
entregando la informacion en espanol), el Robot 3 (cruzar lo del Robot 2 con el analisis del
Robot 1, verificar la coherencia y decidir que oportunidades merecen atencion) y su integracion con
el Robot 1 como un solo sistema.

## Punto por punto

| Componente | ¿Estaba en lo acordado? | Estado real |
|---|---|---|
| **Redes** | Si: Solana y Base (Base es una red EVM) | **Entregado.** Las dos funcionan desde el primer dia. |
| **Rastreo de fondos de insiders** | El analisis profundo quedo fuera del presupuesto del Robot 1. Si entraban el creador, su historial y los movimientos sospechosos | **Parcial, por encima de lo acordado.** Se identifica al creador, cuanto conserva, sus tokens anteriores y como acabaron, y quien financio su cartera; y se detectan los patrones de insiders (compras de varias carteras en el mismo bloque, carteras con saldos identicos, ciclos de compra y venta). No se sigue el dinero varios saltos hacia atras para agrupar carteras con el mismo origen. |
| **Carteras que entran pronto en proyectos que funcionan** | Fuera del presupuesto del Robot 1 ("wallets con historial de aciertos") | **Datos recogidos, analisis pendiente.** Desde el primer dia se guarda cada cartera vista en cada token y, por cartera, en cuantos tokens aparecio, cuantos fueron exito o rug y cuanto tardo en entrar (`wallet_activity`: 398.198 filas, `wallet_stats`: 155.339 carteras). Falta la parte que saca de ahi la lista de carteras que aciertan y la usa en la nota. |
| **Resumenes en espanol de Telegram** | **Si**, formaba parte del encargo del Robot 2 | **Funciona, con capacidad limitada.** La clasificacion y los resumenes funcionan, pero la IA esta en un plan gratuito que da para unos 250 mensajes al dia de los unos 2.000 que pasan el primer filtro. Los demas se guardan, se sacan sus tokens y cuentan para el Robot 3, pero sin resumen. Se eligio el plan gratuito para no generar gasto mensual; con un plan de pago del mismo servicio se resumen todos, cambiando solo la clave en la configuracion (`LLM_API_KEY`, `LLM_MODEL`). |
| **Pre-ventas y airdrops** | No figuraban en los hitos acordados del Robot 1 | **No incluido.** El sistema ve los tokens en cuanto tienen pool de compraventa; una pre-venta todavia no lo tiene. El Robot 2 si recoge los mensajes de Telegram que hablan de pre-ventas o airdrops, pero no se siguen como token hasta que tienen pool. |
| **Actividad de X como fuente** | Fuera del presupuesto del Robot 1 | **No incluido.** Ademas, X ya no da acceso gratuito a su API. Telegram si se incorporo despues, con el Robot 2. Discord tampoco esta incluido. |
| **Clasificacion por narrativa** (IA, DeFi, gaming, memecoin...) | Fuera del presupuesto del Robot 1 | **No incluido.** |
| **Simulacion de operaciones** (entrada, salida, comisiones y deslizamiento) | El "modulo de backtesting completo" quedo fuera del presupuesto del Robot 1 | **Parcial.** Si existe la validacion de las senales con datos reales: desde el 20 de agosto cada token se puntua al detectarlo, sin saber que pasara, y se mide despues que paso (28.817 resultados cerrados), incluido el resultado a 5 min, 15 min, 1 h, 6 h, 24 h y 7 dias **descontando el coste real de entrar y salir** (comisiones y deslizamiento medidos con cotizaciones de Jupiter). Lo que no existe es la simulacion de reglas de entrada y salida (por ejemplo, vender al doble o cortar perdidas a cierto punto). |

## El resto del encargo de los Robots 2 y 3

| Pedido | Estado |
|---|---|
| Buscar en Telegram en espanol, portugues e ingles | Entregado: 24 busquedas, 8 en cada idioma. Hoy casi todos los canales que aportan tokens publican en ingles. |
| Analizar conversaciones y canales, y encontrar fuentes nuevas | Entregado: lee 29 canales ahora mismo y ha encontrado 345 por su cuenta. |
| Diferenciar senales utiles del ruido, spam o informacion poco fiable | Entregado: primer filtro por reglas, clasificacion con IA, deteccion de copias entre canales y de promociones pagadas. |
| Identificar fuentes de interes | Entregado: reputacion de cada canal calculada con resultados reales. |
| Cruzar el Robot 2 con el Robot 1 y verificar la coherencia | Entregado: documento 3. |
| Determinar que oportunidades merecen atencion y seguimiento | Entregado: cuatro niveles; aviso solo en el maximo. |
| Integracion como un unico sistema | Entregado: misma base de datos, mismo panel, el Robot 2 pasa cada token al Robot 1. |
