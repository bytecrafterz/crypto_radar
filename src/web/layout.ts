/**
 * Plantilla HTML y estilos del panel.
 * Todo va incrustado: no hace falta compilar nada ni descargar recursos
 * externos, asi el panel funciona igual en un servidor pequeno.
 */
import { escapeHtml } from '../core/util.js';

export const CSS = `
:root{
  --bg:#0e1117; --panel:#161b22; --panel2:#1c222b; --border:#2a313c;
  --text:#e6edf3; --muted:#8b949e; --dim:#6e7681;
  --green:#3fb950; --yellow:#d29922; --orange:#db6d28; --red:#f85149;
  --blue:#58a6ff; --purple:#bc8cff;
  --radius:10px;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  font-size:14px;line-height:1.5}
html{-webkit-text-size-adjust:100%}
img,svg,canvas{max-width:100%;height:auto}
a{color:var(--blue);text-decoration:none;overflow-wrap:anywhere}
a:hover{text-decoration:underline}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;
  background:var(--panel2);padding:2px 5px;border-radius:4px;word-break:break-all}

header{background:var(--panel);border-bottom:1px solid var(--border);padding:0 20px;
  position:sticky;top:0;z-index:10}
.nav{max-width:1280px;margin:0 auto;display:flex;align-items:center;gap:22px;height:56px;flex-wrap:wrap}
.brand{font-weight:700;font-size:16px;color:var(--text);display:inline-flex;align-items:center;gap:8px}
.brand .logo{flex:none;display:block}
.brand span{color:var(--blue)}
.nav a{color:var(--muted);font-weight:500;padding:6px 0}
.nav a.active,.nav a:hover{color:var(--text);text-decoration:none}
.nav .right{margin-left:auto;display:flex;gap:16px;align-items:center}

main{max-width:1280px;margin:0 auto;padding:22px 20px 60px}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:16px;margin:26px 0 12px;color:var(--text)}
h3{font-size:14px;margin:18px 0 8px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px}
.sub{color:var(--muted);margin:0 0 20px}

.grid{display:grid;gap:14px}
/* Sin esto, una tabla ancha dentro de una tarjeta empuja el ancho de toda
   la pagina y el movil queda inservible. min-width:0 le permite encogerse
   para que el scroll ocurra dentro del .table-wrap, que es donde debe. */
.grid > *,.card{min-width:0}

/* Filas de alerta: insignia, nombre y fecha. En una pantalla estrecha las
   tres cosas juntas no caben, y como la insignia no parte, la fila entera
   estiraba el ancho de la pagina. Se permite que baje de linea. */
.fila-alerta{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.fila-alerta .fecha{margin-left:auto;white-space:nowrap}
.table-wrap{max-width:100%}
.grid.stats{grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr))}
.grid.two{grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))}
.grid.three{grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))}

.card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:16px}
.card h3{margin-top:0}
.stat .label{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.4px}
.stat .value{font-size:26px;font-weight:700;margin-top:4px}
.stat .hint{color:var(--dim);font-size:12px;margin-top:2px}

table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;
  letter-spacing:.4px;padding:8px 10px;border-bottom:1px solid var(--border);white-space:nowrap}
td{padding:9px 10px;border-bottom:1px solid var(--border);vertical-align:middle}
tr:last-child td{border-bottom:none}
tbody tr:hover{background:var(--panel2)}
.table-wrap{overflow-x:auto;background:var(--panel);border:1px solid var(--border);border-radius:var(--radius)}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}

.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;
  border:1px solid transparent;white-space:nowrap}
.badge.green{background:rgba(63,185,80,.14);color:var(--green);border-color:rgba(63,185,80,.3)}
.badge.yellow{background:rgba(210,153,34,.14);color:var(--yellow);border-color:rgba(210,153,34,.3)}
.badge.orange{background:rgba(219,109,40,.14);color:var(--orange);border-color:rgba(219,109,40,.3)}
.badge.red{background:rgba(248,81,73,.14);color:var(--red);border-color:rgba(248,81,73,.3)}
.badge.blue{background:rgba(88,166,255,.14);color:var(--blue);border-color:rgba(88,166,255,.3)}
.badge.gray{background:var(--panel2);color:var(--muted);border-color:var(--border)}

.score{display:flex;align-items:center;gap:8px}
.bar{width:60px;height:6px;background:var(--panel2);border-radius:3px;overflow:hidden;flex-shrink:0}
.bar > div{height:100%;border-radius:3px}

.reasons{list-style:none;padding:0;margin:0}
.reasons li{padding:8px 0;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:flex-start}
.reasons li:last-child{border-bottom:none}
.reasons .pts{flex-shrink:0;font-variant-numeric:tabular-nums;font-weight:700;font-size:12px;
  min-width:34px;text-align:right}

.kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px}
.kv dt{color:var(--muted)}
.kv dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}

form.filters{display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:16px}
label.field{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--muted);
  text-transform:uppercase;letter-spacing:.4px}
input,select{background:var(--panel2);border:1px solid var(--border);color:var(--text);
  padding:7px 10px;border-radius:6px;font-size:13px;font-family:inherit}
input:focus,select:focus{outline:none;border-color:var(--blue)}
button{background:var(--blue);color:#0d1117;border:none;padding:8px 16px;border-radius:6px;
  font-weight:600;cursor:pointer;font-size:13px;font-family:inherit}
button:hover{opacity:.9}
button.ghost{background:transparent;color:var(--muted);border:1px solid var(--border)}

.note{background:var(--panel2);border-left:3px solid var(--blue);padding:10px 14px;
  border-radius:0 6px 6px 0;color:var(--muted);font-size:13px;margin:12px 0}
.note.warn{border-left-color:var(--yellow)}
.note.danger{border-left-color:var(--red)}

.empty{text-align:center;padding:44px 20px;color:var(--dim)}
.muted{color:var(--muted)}
.dim{color:var(--dim)}
.small{font-size:12px}
.right{text-align:right}
.nowrap{white-space:nowrap}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}

.login{max-width:340px;margin:14vh auto;background:var(--panel);border:1px solid var(--border);
  border-radius:var(--radius);padding:28px}
.login h1{font-size:19px;margin-bottom:18px}
.login input{width:100%;margin-bottom:14px}
.login button{width:100%}

.pager{display:flex;gap:8px;justify-content:center;margin-top:18px}
.pager a{padding:6px 12px;border:1px solid var(--border);border-radius:6px;color:var(--muted)}
.pager a:hover{color:var(--text);text-decoration:none}

.tokenhead{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;margin-bottom:6px}
.tokenhead .sym{font-size:26px;font-weight:700}
.links{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 18px}
.links a{background:var(--panel2);border:1px solid var(--border);padding:5px 12px;
  border-radius:6px;font-size:12px;color:var(--muted)}
.links a:hover{color:var(--text);text-decoration:none}
/* El de comprar va destacado: es la accion, no una consulta mas. */
.links a.comprar{background:var(--accent,#2f81f7);border-color:var(--accent,#2f81f7);color:#fff;font-weight:600}
.links a.comprar:hover{filter:brightness(1.12);color:#fff}

.chart{width:100%;height:auto;display:block}
footer{max-width:1280px;margin:0 auto;padding:20px;color:var(--dim);font-size:12px;
  border-top:1px solid var(--border);margin-top:40px}
/* ---------- Movil ----------
   El panel se consulta sobre todo desde el telefono: llega una alerta a
   Discord y se abre la ficha alli mismo. Lo que se ajusta aqui es que nada
   obligue a mover la pagina de lado, que es lo que la vuelve inservible en
   una pantalla estrecha. */
@media(max-width:860px){
  .nav{gap:16px}
  main{padding:18px 14px 48px}
}

@media(max-width:640px){
  header{padding:0 14px}

  /* La navegacion pasa a una tira que se desliza, en vez de partirse en
     varias filas y comerse media pantalla. */
  .nav{height:auto;padding:10px 0;gap:18px;flex-wrap:nowrap;overflow-x:auto;
    scrollbar-width:none;-webkit-overflow-scrolling:touch}
  .nav::-webkit-scrollbar{display:none}
  .nav a{white-space:nowrap;padding:8px 0}
  .brand{font-size:15px;flex:none}
  .nav .right{margin-left:12px;flex:none}

  main{padding:16px 12px 40px}

  /* Columnas fijadas a mano en vez de dejarlo a auto-fit: en el movil el
     resultado tiene que ser predecible. Dos tarjetas de cifras por fila,
     y todo lo demas a una sola columna. */
  .grid.stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .grid.two,.grid.three{grid-template-columns:minmax(0,1fr)}

  h1{font-size:19px}
  h2{font-size:15px;margin:22px 0 10px}
  .sub{font-size:13px;margin-bottom:16px}

  .grid{gap:10px}
  .card{padding:13px}
  .stat .value{font-size:20px}

  /* Objetivos de pulsacion mas comodos con el dedo. */
  .nav a,.badge,.btn{min-height:32px;display:inline-flex;align-items:center}

  /* Las tablas se deslizan dentro de su caja, nunca arrastran la pagina.
     El indicador de sombra avisa de que hay mas contenido a la derecha. */
  .table-wrap{-webkit-overflow-scrolling:touch;
    background-image:linear-gradient(to right,var(--panel),var(--panel)),
      linear-gradient(to right,rgba(0,0,0,.35),rgba(0,0,0,0));
    background-position:right center,right center;
    background-repeat:no-repeat;
    background-size:24px 100%,14px 100%;
    background-attachment:local,scroll}
  th,td{padding:8px 9px;font-size:13px}
  th{white-space:nowrap}

  /* Las direcciones largas parten de linea en vez de estirar la tabla. */
  .mono,code{font-size:11px}
  .links{gap:8px}
  .links a{padding:6px 10px}
}

/* Telefonos pequenos */
@media(max-width:380px){
  main{padding:14px 10px 36px}
  h1{font-size:17px}
  .stat .value{font-size:18px}
  th,td{padding:7px 7px;font-size:12px}
}
`;

export interface PageOptions {
  title: string;
  active?: string;
  showNav?: boolean;
}

const NAV = [
  { href: '/', label: 'Resumen', key: 'resumen' },
  { href: '/tokens', label: 'Tokens', key: 'tokens' },
  { href: '/alertas', label: 'Alertas', key: 'alertas' },
  { href: '/resultados', label: 'Resultados', key: 'resultados' },
  { href: '/telegram', label: 'Telegram', key: 'telegram' },
  { href: '/sistema', label: 'Sistema', key: 'sistema' },
];

export function page(opts: PageOptions, body: string): string {
  const nav = opts.showNav === false
    ? ''
    : `<header><div class="nav">
        <div class="brand"><svg class="logo" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="12" cy="12" r="7.1" fill="none" stroke="currentColor" stroke-width=".9" opacity=".38"/><path d="M12 12 L12 3.4 A8.6 8.6 0 0 1 19.45 7.7 Z" fill="var(--blue)" opacity=".5"/><line x1="12" y1="12" x2="19.45" y2="7.7" stroke="var(--blue)" stroke-width="1.5" stroke-linecap="round"/><circle cx="15.9" cy="7.4" r="1.45" fill="var(--blue)"/><circle cx="12" cy="12" r="1.15" fill="currentColor"/></svg>Crypto <span>Radar</span></div>
        ${NAV.map(
          (n) =>
            `<a href="${n.href}" class="${opts.active === n.key ? 'active' : ''}">${n.label}</a>`,
        ).join('')}
        <div class="right"><a href="/salir" class="small">Salir</a></div>
      </div></header>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='11' fill='%230e1117'/><circle cx='12' cy='12' r='9.2' fill='none' stroke='%23e6edf3' stroke-width='1.8'/><path d='M12 12 L12 4.2 A7.8 7.8 0 0 1 18.7 8 Z' fill='%2358a6ff' opacity='.55'/><line x1='12' y1='12' x2='18.7' y2='8' stroke='%2358a6ff' stroke-width='1.6' stroke-linecap='round'/><circle cx='15.6' cy='7.8' r='1.5' fill='%2358a6ff'/><circle cx='12' cy='12' r='1.2' fill='%23e6edf3'/></svg>">
<title>${escapeHtml(opts.title)} · Crypto Radar</title>
<style>${CSS}</style>
</head>
<body>
${nav}
<main>${body}</main>
<footer>
  Crypto Radar · Herramienta de deteccion y analisis. La informacion que muestra no es
  una recomendacion de compra ni de venta: la decision siempre es tuya.
</footer>
</body>
</html>`;
}

// --------------------------------------------------------------------------
//  Componentes reutilizables
// --------------------------------------------------------------------------

export function statCard(label: string, value: string, hint?: string): string {
  return `<div class="card stat">
    <div class="label">${escapeHtml(label)}</div>
    <div class="value">${escapeHtml(value)}</div>
    ${hint ? `<div class="hint">${escapeHtml(hint)}</div>` : ''}
  </div>`;
}

export function riskBadge(risk: number | null): string {
  if (risk === null) return '<span class="badge gray">n/d</span>';
  const cls = risk < 20 ? 'green' : risk < 45 ? 'yellow' : risk < 70 ? 'orange' : 'red';
  return `<span class="badge ${cls}">${risk}</span>`;
}

export function opportunityBadge(op: number | null): string {
  if (op === null) return '<span class="badge gray">n/d</span>';
  const cls = op >= 70 ? 'green' : op >= 55 ? 'blue' : op >= 40 ? 'yellow' : 'gray';
  return `<span class="badge ${cls}">${op}</span>`;
}

export function scoreBar(value: number | null, kind: 'op' | 'risk'): string {
  if (value === null) return '<span class="dim">n/d</span>';
  const color =
    kind === 'risk'
      ? value < 20
        ? 'var(--green)'
        : value < 45
          ? 'var(--yellow)'
          : value < 70
            ? 'var(--orange)'
            : 'var(--red)'
      : value >= 70
        ? 'var(--green)'
        : value >= 55
          ? 'var(--blue)'
          : 'var(--muted)';
  return `<span class="score"><span class="bar"><div style="width:${Math.min(100, value)}%;background:${color}"></div></span><span class="num">${value}</span></span>`;
}

export function statusBadge(status: string): string {
  const map: Record<string, string> = {
    nuevo: 'blue',
    vigilado: 'green',
    alertado: 'green',
    peligro: 'red',
    descartado: 'gray',
    archivado: 'gray',
  };
  return `<span class="badge ${map[status] ?? 'gray'}">${escapeHtml(status)}</span>`;
}

export function chainBadge(chain: string): string {
  return `<span class="badge ${chain === 'solana' ? 'purple' : 'blue'}" style="${
    chain === 'solana' ? 'background:rgba(188,140,255,.14);color:var(--purple);border-color:rgba(188,140,255,.3)' : ''
  }">${chain === 'solana' ? 'Solana' : 'Base'}</span>`;
}

export function boolBadge(
  value: boolean | null,
  goodWhenFalse = true,
  labels: [string, string] = ['si', 'no'],
): string {
  if (value === null) return '<span class="badge gray">n/d</span>';
  const good = goodWhenFalse ? !value : value;
  return `<span class="badge ${good ? 'green' : 'red'}">${value ? labels[0] : labels[1]}</span>`;
}
