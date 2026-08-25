# Alcance del sistema

Que hace este sistema, que no hace, y donde estan sus limites reales.

Este documento existe para que no haya sorpresas: preferimos decir claramente lo que la
herramienta **no** puede hacer antes que dejarlo a la imaginacion.

---

## Incluido y funcionando

### Deteccion
- Tokens y pools nuevos en **Solana** (Raydium, Orca, Meteora, Pump.fun y demas) y **Base**
  (Uniswap, Aerodrome y demas), a traves de GeckoTerminal y DexScreener
- Deteccion tambien de tokens algo mas antiguos que **empiezan a moverse**
- Filtro configurable por liquidez, volumen, operaciones, edad y capitalizacion
- **Todo lo detectado se guarda**, incluido lo descartado y el motivo del descarte

### Datos de mercado
- Precio, capitalizacion, FDV, liquidez y volumen (5 min, 1 h, 6 h, 24 h)
- Numero de compras y ventas por periodo, y presion compradora o vendedora
- Variacion de precio en cada periodo
- Historico guardado desde el primer minuto

### Seguridad
- **Solana:** mint authority, freeze authority, Token-2022 y sus extensiones
- **Base:** permisos del owner, blacklist, honeypot, comisiones de compra y venta, si son
  modificables, contrato proxy, contrato verificado
- Estado de la liquidez: bloqueada, quemada o libre
- Triple comprobacion: blockchain + GoPlus + RugCheck (Solana) / Honeypot.is (Base)

### Holders
- Numero de holders y su crecimiento por hora
- Concentracion del top 10 y top 20 **descontando pool, quemado, contratos y custodios**
- Mayor wallet individual
- Cuanto conserva el creador

### Creador
- Identificacion de la direccion que creo el token
- Tokens que lanzo antes y como acabaron (se construye con tu propio historico)
- Quien financio esa wallet

### Movimientos sospechosos
- Compras agrupadas en el mismo bloque (bots sniper o compra coordinada)
- Wash trading: wallets que compran y venden en ciclo
- Volumen alto sin crecimiento de holders
- Wallets con saldos identicos (reparto artificial)
- Presion vendedora extrema
- **Retirada de liquidez y desplome de precio**, con aviso inmediato

### Puntuacion y alertas
- Dos notas separadas, oportunidad y riesgo, **con todos los motivos explicados**
- Pesos y umbrales configurables sin tocar codigo
- Alertas de Telegram con filtros, limite por hora y comandos de consulta
- Avisos de peligro para tokens ya detectados

### Panel web e historico
- Resumen, listado con filtros y buscador, ficha completa de cada token
- Graficos de precio, liquidez y holders
- Historico de alertas
- **Pagina de resultados**: que paso realmente con cada token detectado

---

## Fuera de este alcance

Estas partes **no** estan incluidas. El sistema esta preparado para incorporarlas mas
adelante sin rehacer nada (las tablas ya existen y los datos ya se estan guardando):

| Funcion | Estado |
|---|---|
| Analisis profundo de insiders con grafo de financiacion | No incluido |
| Actividad y crecimiento en X (Twitter) | No incluido — la API de X dejo de tener nivel gratuito |
| Actividad en Telegram y Discord de terceros | No incluido |
| Clasificacion automatica de narrativa (IA, DeFi, gaming...) | No incluido |
| Lista de wallets que historicamente aciertan | **Los datos ya se recogen**; falta la pagina que los explota |
| Modulo de backtesting con simulacion de estrategias | **Los datos ya se recogen**; la pagina *Resultados* es la version basica |
| Compra, venta o cualquier operacion con fondos | **Nunca**: no forma parte del proyecto |

### Sobre insiders

Conviene ser preciso, porque es donde mas se exagera en este sector: **no existe ninguna API
que diga quien es insider**. Lo que si se puede hacer con datos publicos, y el sistema hace,
es detectar patrones: compras en el mismo bloque, wallets con saldos identicos, ciclos de
compra-venta y quien financio al creador.

Lo que queda fuera es el analisis en profundidad: seguir el rastro del dinero varios saltos
hacia atras para agrupar wallets que comparten origen de fondos.

**Cada senal se marca con un nivel de sospecha, nunca como una certeza.**

---

## Limites reales que conviene conocer

### 1. La deteccion tarda minutos, no segundos
Con planes gratuitos, entre que se crea un pool y el sistema lo ve pasan normalmente entre
1 y 5 minutos. Es suficiente para analizar un proyecto con calma; no lo es si quisieras
competir con bots en los primeros segundos de un lanzamiento. Se puede reducir contratando
Helius de pago o streaming dedicado, cambiando solo una clave.

### 2. Holders en Solana necesitan clave de Helius
**Comprobado en pruebas reales:** el RPC publico de Solana devuelve error 429 en el metodo
que da las mayores cuentas. Sin la clave gratuita de Helius no se puede calcular la
concentracion en Solana. La clave es gratis y se pone en un minuto.

### 3. Holders en Base pueden ser parciales
La lista se reconstruye leyendo eventos de la cadena. En tokens con muchisimo movimiento, el
plan gratuito no permite leer hasta el bloque de creacion. Cuando pasa, **el panel lo marca
como parcial** en lugar de dar un numero que parece exacto y no lo es.

### 4. Numero de tokens analizados al dia
El analisis profundo esta limitado (por defecto 60 por hora, 500 al dia) para no agotar los
planes gratuitos. Es mas que suficiente: el filtro previo descarta entre el 85% y el 95% de
lo que aparece.

### 5. Las fuentes externas fallan a veces
GoPlus, RugCheck o Honeypot.is pueden no responder puntualmente. El sistema no se para:
sigue con el resto y **anota que dato falto**. Nunca inventa un valor.

### 6. Esto no predice el futuro
El sistema mide lo que ha pasado y lo que se puede verificar ahora. **No sabe si un token
va a subir.** Su mayor valor esta en descartar: evitar los proyectos con mint authority
activa, liquidez sin bloquear, concentracion extrema o senales de manipulacion, que es donde
se pierde la mayor parte del dinero al empezar.

---

## Compromiso de seguridad

- El sistema **solo lee** informacion publica de la blockchain
- **No tiene ni pide** claves privadas, frases semilla ni acceso a wallets
- **No puede** comprar, vender ni mover fondos: no hay codigo capaz de hacerlo
- Todas las cuentas de servicios van **a tu nombre**, con tus claves
- El codigo es tuyo al 100% y esta documentado para que cualquier desarrollador pueda
  mantenerlo o ampliarlo
