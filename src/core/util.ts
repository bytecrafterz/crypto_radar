/**
 * Utilidades sin dependencias externas.
 */

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Interpola linealmente entre dos umbrales y devuelve 0..1.
 * Se usa en el scoring: por debajo de `from` da 0, por encima de `to` da 1.
 */
export function ramp(value: number, from: number, to: number): number {
  if (to === from) return value >= to ? 1 : 0;
  return clamp((value - from) / (to - from), 0, 1);
}

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Codifica bytes a base58 (formato de direcciones de Solana). */
export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  // Conversion de base 256 a base 58 por division sucesiva.
  const size = Math.floor(((bytes.length - zeros) * 138) / 100) + 1;
  const b58 = new Uint8Array(size);
  let length = 0;

  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    let j = 0;
    for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
      carry += 256 * b58[k];
      b58[k] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    length = j;
  }

  let it = size - length;
  while (it < size && b58[it] === 0) it++;

  let out = '1'.repeat(zeros);
  for (; it < size; it++) out += B58_ALPHABET[b58[it]];
  return out;
}

/** Decodifica base58 a bytes. Devuelve null si la cadena no es valida. */
export function base58Decode(str: string): Uint8Array | null {
  if (str.length === 0) return new Uint8Array(0);
  let zeros = 0;
  while (zeros < str.length && str[zeros] === '1') zeros++;

  const size = Math.floor(((str.length - zeros) * 733) / 1000) + 1;
  const bytes = new Uint8Array(size);
  let length = 0;

  for (let i = zeros; i < str.length; i++) {
    const value = B58_ALPHABET.indexOf(str[i]);
    if (value === -1) return null;
    let carry = value;
    let j = 0;
    for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
      carry += 58 * bytes[k];
      bytes[k] = carry % 256;
      carry = Math.floor(carry / 256);
    }
    length = j;
  }

  let it = size - length;
  while (it < size && bytes[it] === 0) it++;

  const out = new Uint8Array(zeros + (size - it));
  out.fill(0, 0, zeros);
  out.set(bytes.subarray(it), zeros);
  return out;
}

/** Comprueba que una cadena parece una direccion de Solana. */
export function isSolanaAddress(s: string): boolean {
  if (s.length < 32 || s.length > 44) return false;
  const decoded = base58Decode(s);
  return decoded !== null && decoded.length === 32;
}

/** Comprueba que una cadena parece una direccion EVM. */
export function isEvmAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

/** Numero grande a decimal legible, respetando los decimales del token. */
export function formatUnits(raw: bigint | string, decimals: number): number {
  const v = typeof raw === 'string' ? BigInt(raw) : raw;
  if (decimals === 0) return Number(v);
  const div = 10n ** BigInt(decimals);
  const whole = v / div;
  const frac = v % div;
  return Number(whole) + Number(frac) / Number(div);
}

/** Formatea un importe en USD para mostrarlo. */
export function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/d';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  if (n === 0) return '$0';
  return `$${n.toPrecision(3)}`;
}

export function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/d';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(decimals)}%`;
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/d';
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(n);
}

/** Acorta una direccion para mostrarla: ABCD...WXYZ */
export function shortAddr(a: string | null | undefined, head = 5, tail = 4): string {
  if (!a) return 'n/d';
  if (a.length <= head + tail + 3) return a;
  return `${a.slice(0, head)}...${a.slice(-tail)}`;
}

/** Antiguedad legible en espanol. */
export function fmtAge(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return 'n/d';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}min`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Escapa texto para HTML. */
export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Numero seguro: convierte null/undefined/NaN a un valor por defecto. */
export function safeNum(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Devuelve null si el valor no es un numero finito. */
export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Devuelve la URL solo si es http o https; si no, null.
 *
 * Escapar el HTML NO basta para un enlace: una direccion como
 * "javascript:alert(1)" no lleva ningun caracter especial, pasa el escapado
 * intacto y se ejecuta al pulsarla. Los enlaces de web, X y Telegram vienen
 * de los metadatos del token, que los escribe quien lo crea, asi que hay que
 * comprobar el esquema explicitamente.
 */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const limpio = url.trim();
  if (!/^https?:\/\//i.test(limpio)) return null;
  // Sin espacios ni saltos de linea: podrian romper el atributo.
  if (/[\s"'<>]/.test(limpio)) return null;
  return limpio;
}
