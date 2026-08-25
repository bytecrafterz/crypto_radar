# Verificar los datos en la blockchain

Todo lo que muestra el sistema se puede comprobar por tu cuenta. Esta guia explica, dato por
dato, **de donde sale y como confirmarlo tu misma** sin fiarte de la herramienta.

No hace falta saber programar: casi todo se comprueba con un explorador y el navegador.

---

## Solana

### Mint authority y freeze authority

Son las dos comprobaciones mas importantes. Si la *mint authority* sigue activa, el creador
puede fabricar tokens nuevos cuando quiera; si la *freeze authority* sigue activa, puede
congelar los tuyos.

**Como lo lee el sistema:** metodo `getAccountInfo` sobre la cuenta del mint, leyendo el
campo `mintAuthority` y `freezeAuthority`.

**Como comprobarlo:**

1. Entra en `https://solscan.io/token/DIRECCION-DEL-TOKEN`
2. Pestana **Metadata** o el panel de la derecha
3. Busca *Mint Authority* y *Freeze Authority*
4. Si pone `NULL`, `--` o *Revoked*, esta revocada (bien). Si aparece una direccion, esta activa.

También sirve `https://rugcheck.xyz/tokens/DIRECCION-DEL-TOKEN`.

---

### Concentracion de holders (top 10)

**Como lo calcula el sistema:** pide las 20 mayores cuentas del token
(`getTokenLargestAccounts`), resuelve el **dueno real** de cada una (`getMultipleAccounts`),
y **descuenta el pool de liquidez, las direcciones de quemado y los contratos** antes de sumar.

> Este descuento es la diferencia entre un dato util y un dato inservible. Sin descontar el
> pool, el "top 10" sale casi siempre por encima del 85% en cualquier token, incluso en los
> sanos, porque el pool de liquidez es el mayor "holder".

**Como comprobarlo:**

1. `https://solscan.io/token/DIRECCION-DEL-TOKEN` → pestana **Holders**
2. Veras la lista ordenada con su porcentaje
3. **Identifica y descarta** las que no son holders reales:
   - La cuenta del pool (Raydium, Orca, Meteora...): Solscan suele etiquetarla
   - `1nc1nerator11111111111111111111111111111111` (quemado)
4. Suma los 10 mayores de los que quedan

Ese numero es el que muestra el panel. Las direcciones que el sistema descarta estan en
`config/known-addresses.yaml` y puedes anadir mas.

---

### Quien creo el token

**Como lo hace el sistema:** busca la transaccion **mas antigua** del mint
(`getSignaturesForAddress` paginando hacia atras) y toma el primer firmante, que es quien pago.

**Como comprobarlo:**

1. `https://solscan.io/token/DIRECCION-DEL-TOKEN`
2. Pestana **Transactions** → ve a la ultima pagina (la mas antigua)
3. Abre la primera transaccion: el *Signer* / *Fee Payer* es el creador

---

### Liquidez bloqueada

En Solana lo mas fiable en el nivel gratuito es lo que reporta RugCheck.

**Como comprobarlo:** `https://rugcheck.xyz/tokens/DIRECCION-DEL-TOKEN` → apartado
*LP Locked* / *Markets*.

---

## Base

### Quien creo el contrato

**Como lo hace el sistema:** endpoint `getcontractcreation` de Basescan.

**Como comprobarlo:**

1. `https://basescan.org/token/DIRECCION-DEL-TOKEN`
2. Pestana **Contract** → arriba pone *Contract Creator ... at txn ...*
3. Ese es exactamente el dato que guarda el sistema

---

### Permisos del contrato (owner, blacklist, comisiones)

**Como lo hace el sistema:** lee `owner()` en la cadena, y analiza el codigo verificado
buscando `blacklist`, `setFee`, `pause`, `mint`, `maxTxAmount` y `onlyOwner`. Ademas lo
contrasta con GoPlus.

**Como comprobarlo:**

1. `https://basescan.org/address/DIRECCION-DEL-TOKEN#code`
2. Si el contrato esta verificado veras el codigo fuente
3. Usa `Ctrl+F` y busca: `onlyOwner`, `blacklist`, `setFee`, `pause`, `renounceOwnership`
4. En la pestana **Read Contract** puedes ejecutar `owner()` y ver la direccion actual
   (si devuelve `0x0000...0000`, la propiedad esta renunciada)

Segunda opinion: `https://gopluslabs.io/token-security/8453/DIRECCION-DEL-TOKEN`

---

### Honeypot (¿se puede vender?)

**Como lo hace el sistema:** Honeypot.is **simula una compra y una venta reales**, y lo
contrasta con GoPlus.

**Como comprobarlo:** `https://honeypot.is/base?address=DIRECCION-DEL-TOKEN`

Te dira si la venta funciona y cuales son las comisiones reales de compra y venta.

---

### Holders en Base

**Importante:** en Base **no existe** una lista de holders en la blockchain. Basescan la
muestra porque la reconstruye el mismo. El sistema hace lo mismo: lee todos los eventos
`Transfer` del token desde su creacion y suma y resta saldos.

**Como comprobarlo:**

1. `https://basescan.org/token/DIRECCION-DEL-TOKEN#balances`
2. Compara con la lista del panel

Si el panel marca la lista como **parcial**, es que no pudo leer hasta el bloque de creacion
(pasa en tokens con muchisimo movimiento y RPC gratuito). En ese caso Basescan es mas exacto,
y el panel te lo avisa expresamente en lugar de darte un numero enganoso.

---

### Liquidez quemada o bloqueada

**Como lo hace el sistema:** lee quien tiene los **tokens LP** del pool. Si estan en la
direccion de quemado o en un contrato de bloqueo conocido (Unicrypt, Team Finance, PinkLock,
UNCX), la liquidez no se puede retirar.

**Como comprobarlo:**

1. Busca la direccion del pool (aparece en la ficha del token, o en DexScreener)
2. `https://basescan.org/token/DIRECCION-DEL-POOL#balances`
3. Mira si el mayor tenedor es `0x000...dEaD` (quemado) o un contrato de lock

---

## Datos de mercado (las dos cadenas)

Precio, liquidez, volumen, capitalizacion y numero de compras y ventas vienen de
**DexScreener** y **GeckoTerminal**.

**Como comprobarlo:**
- `https://dexscreener.com/solana/DIRECCION-DEL-POOL`
- `https://dexscreener.com/base/DIRECCION-DEL-POOL`

En la ficha de cada token del panel tienes el enlace directo.

Puede haber diferencias pequenas por el momento exacto de la consulta: el panel guarda una
foto cada pocos minutos, DexScreener actualiza continuamente.

---

## Consultar la base de datos directamente

Todos los datos son tuyos y estan en tu servidor. Puedes consultarlos sin pasar por el panel:

```bash
docker exec -it radar-db psql -U radar -d radar
```

Ejemplos utiles:

```sql
-- Todo lo detectado hoy
SELECT chain, symbol, status, last_opportunity, last_risk, last_liquidity_usd
FROM tokens WHERE first_seen > CURRENT_DATE ORDER BY last_opportunity DESC;

-- Historico completo de un token
SELECT ts, price_usd, liquidity_usd, holders_count
FROM token_snapshots WHERE token_id = (
  SELECT id FROM tokens WHERE address = 'DIRECCION'
) ORDER BY ts;

-- Por que se descarto cada token
SELECT symbol, discard_reason FROM tokens
WHERE status = 'descartado' ORDER BY first_seen DESC LIMIT 20;

-- Motivos exactos de una puntuacion
SELECT opportunity, risk, jsonb_pretty(opportunity_reasons), jsonb_pretty(risk_reasons)
FROM scores WHERE token_id = (SELECT id FROM tokens WHERE symbol = 'XXX')
ORDER BY ts DESC LIMIT 1;
```

Para exportar a Excel:

```bash
docker exec radar-db psql -U radar -d radar -c "\copy (SELECT * FROM tokens) TO STDOUT WITH CSV HEADER" > tokens.csv
```

---

## Si un dato no cuadra

1. Mira en la ficha del token el apartado **Fuentes consultadas**: dice exactamente que
   servicios respondieron y cuales no.
2. Si una fuente no respondio, el dato puede faltar o venir de la fuente alternativa.
3. Cuando la blockchain y una API externa se contradicen, **el sistema hace caso a la
   blockchain** y anota la discrepancia en las notas del informe de seguridad.
