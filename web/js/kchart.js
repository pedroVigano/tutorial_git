// Gráfico de um Resultado-Chave com todos os seus KPIs, compacto e interativo.
// - Escala comum "% do alvo": o alvo de todo KPI fica na mesma linha (100%), para cima = melhor
//   (≥ e =: valor/alvo; ≤: alvo/valor). KPI sem alvo (ou alvo 0) fica numa escala própria, tracejado.
//   Os valores reais aparecem no tooltip (crosshair por sprint) e na legenda.
// - Legenda = placar: clicar liga/desliga a série (fica no navegador), passar o mouse destaca.
// - Sprint sem medição depois da última medição: repete o último valor com bolinha aberta (só visual).
// - Cor do KR = posição dele no objetivo (paleta categórica --s1..--s8); KPIs em tons da cor do KR,
//   com formas de marcador diferentes (●■▲◆▼), para a relação KR → KPI ficar visível.
import { esc, fmt, store } from './util.js';
import { kpiLast, kpiStatus } from './rules.js';

export const N_SLOTS = 8;
export const krCor = (i) => (i >= 0 && i < N_SLOTS ? `var(--s${i + 1})` : 'var(--neutral)');
const TONS = [0, -0.13, 0.11, -0.24, 0.2, -0.31, 0.27];
export const kpiCor = (kr, j) => (j < TONS.length ? (TONS[j] ? `oklch(from ${kr} calc(l + ${TONS[j]}) c h)` : kr) : 'var(--neutral)');
export const MARCAS = ['circle', 'square', 'triangle', 'diamond', 'down'];
const marca = (j) => MARCAS[j % MARCAS.length];

// fração do alvo (1 = alvo atingido; maior = melhor) ou null quando o KPI não tem alvo normalizável
export function normaliza(k, v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  const a = Number(k.alvo);
  if (k.alvo == null || !Number.isFinite(a) || a === 0) return null;
  if (k.dir === '≤') return Number(v) <= 0 ? Infinity : a / Number(v);
  return Number(v) / a;
}
export const normalizavel = (k) => k.alvo != null && Number.isFinite(Number(k.alvo)) && Number(k.alvo) !== 0;

// Pontos do KPI no eixo xs (números de sprint): medições reais + repetição da última medição nas sprints
// seguintes até `ate` (inclusive). Nunca repete para trás da primeira medição.
export function pontos(k, xs, ate = xs[xs.length - 1]) {
  const out = []; let ult = null;
  xs.forEach((sp, i) => {
    const v = k.serie?.[String(sp)];
    if (v != null) { ult = { sp, v }; out.push({ sp, i, v, rep: false }); }
    else if (ult && sp <= ate) out.push({ sp, i, v: ult.v, rep: true, de: ult.sp });
  });
  return out;
}

// ---------- preferências locais: KPIs desligados ----------
const OFF_KEY = 'gt-kpi-off';
const offSet = () => new Set(Object.keys(store.get(OFF_KEY, {})));
function setOff(id, off) {
  const o = store.get(OFF_KEY, {});
  if (off) o[id] = 1; else delete o[id];
  store.set(OFF_KEY, o);
}

const comUnidade = (k, v) => `${fmt(v)}${k.unidade ? ` ${esc(k.unidade)}` : ''}`;
const pct = (f) => (f === Infinity ? '∞' : `${Math.round(f * 100)}%`);

function marcaSVG(tipo, x, y, r, attrs) {
  if (tipo === 'square') return `<rect x="${x - r * 0.9}" y="${y - r * 0.9}" width="${r * 1.8}" height="${r * 1.8}" rx="1.5" ${attrs}/>`;
  if (tipo === 'triangle') return `<path d="M${x},${y - r * 1.15} L${x + r * 1.05},${y + r * 0.8} L${x - r * 1.05},${y + r * 0.8} Z" ${attrs}/>`;
  if (tipo === 'down') return `<path d="M${x},${y + r * 1.15} L${x + r * 1.05},${y - r * 0.8} L${x - r * 1.05},${y - r * 0.8} Z" ${attrs}/>`;
  if (tipo === 'diamond') return `<path d="M${x},${y - r * 1.2} L${x + r * 1.2},${y} L${x},${y + r * 1.2} L${x - r * 1.2},${y} Z" ${attrs}/>`;
  return `<circle cx="${x}" cy="${y}" r="${r}" ${attrs}/>`;
}
export const chaveSVG = (j, cor) => `<svg class="kkey" viewBox="0 0 22 12" aria-hidden="true"><line x1="1" x2="21" y1="6" y2="6" stroke="${cor}" stroke-width="2" stroke-linecap="round"/>${marcaSVG(marca(j), 11, 6, 3.6, `fill="${cor}" stroke="var(--surface)" stroke-width="1.5"`)}</svg>`;

// ---------- modelo ----------
const modelos = new Map(); // id do gráfico → modelo (para o hover)

function modelo(id, ks, { xs, cur, kr, width }) {
  const W = Math.max(260, Math.round(width || 360)); const H = 118;
  const pl = 34; const pr = 12; const pt = 10; const pb = 20;
  const x = (i) => (xs.length > 1 ? pl + (i * (W - pl - pr)) / (xs.length - 1) : (pl + W - pr) / 2);
  const off = offSet();
  const series = ks.map((k, j) => {
    const cor = kpiCor(kr, j);
    const pts = pontos(k, xs, cur);
    const norm = normalizavel(k);
    let f;
    if (norm) f = (v) => normaliza(k, v);
    else { // escala própria: mín–máx dos valores em 15%–85% da faixa até o alvo
      const vs = pts.map((p) => Number(p.v)); const lo = Math.min(...vs); const hi = Math.max(...vs);
      f = (v) => (hi === lo ? 0.5 : 0.15 + (0.7 * (Number(v) - lo)) / (hi - lo));
    }
    return { k, j, cor, pts: pts.map((p) => ({ ...p, f: f(p.v) })), norm, off: off.has(k.id) };
  });
  const vis = series.filter((s) => !s.off);
  const maxF = Math.max(1, ...vis.flatMap((s) => s.pts.map((p) => (p.f === Infinity ? 0 : p.f))));
  const top = Math.min(2, Math.max(1.25, maxF * 1.08));
  const y = (f) => H - pb - (Math.min(f, top) / top) * (H - pt - pb);
  return { id, ks, xs, cur, W, H, pl, pr, pt, pb, x, y, top, series };
}

function svgHTML(M) {
  const { W, H, pl, pr, pb, x, y, top, xs, cur } = M;
  let s = `<svg class="kchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="KPIs do KR por sprint, em % do alvo" tabindex="0">`;
  // eixo: 0%, 50%, 100% (alvo) e, se couber, o topo
  [0, 0.5].forEach((f) => { s += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(f)}" y2="${y(f)}"/><text class="ax" x="${pl - 4}" y="${y(f) + 3.5}" text-anchor="end">${pct(f)}</text>`; });
  s += `<line class="alvo" x1="${pl}" x2="${W - pr}" y1="${y(1)}" y2="${y(1)}"/><text class="ax alvo-t" x="${pl - 4}" y="${y(1) + 3.5}" text-anchor="end">alvo</text>`;
  if (top >= 1.5) s += `<text class="ax" x="${pl - 4}" y="${y(top) + 8}" text-anchor="end">${pct(top)}</text>`;
  M.series.forEach((se) => {
    const { j, cor, pts } = se;
    let g = `<g class="s${se.off ? ' off' : ''}${se.norm ? '' : ' propria'}" data-k="${esc(se.k.id)}">`;
    // linha contínua só entre sprints vizinhas medidas; trecho com valor repetido fica pontilhado
    for (let q = 1; q < pts.length; q += 1) {
      const a = pts[q - 1]; const b = pts[q];
      const cheio = !a.rep && !b.rep && b.i === a.i + 1;
      g += `<line class="ln${cheio ? '' : ' rep'}" style="stroke:${cor}" x1="${x(a.i)}" y1="${y(a.f)}" x2="${x(b.i)}" y2="${y(b.f)}"/>`;
    }
    pts.forEach((p) => {
      const atual = p.sp === cur;
      const attrs = p.rep ? `class="mk rep" style="fill:var(--surface-2);stroke:${cor}"` : `class="mk" style="fill:${cor}"`;
      g += marcaSVG(marca(j), x(p.i), y(p.f), atual ? 4.6 : 3.8, attrs);
      if (p.f > top) g += `<text class="over" x="${x(p.i)}" y="${y(top) - 2}" text-anchor="middle">▲</text>`;
    });
    s += `${g}</g>`;
  });
  xs.forEach((sp, i) => { s += `<text class="sp${sp === cur ? ' cur' : ''}" x="${x(i)}" y="${H - 5}" text-anchor="middle">#${sp}</text>`; });
  s += `<line class="xh" y1="${M.pt}" y2="${H - pb}" x1="-10" x2="-10"/>`;
  return `${s}</svg>`;
}

function legendaHTML(M, { edit }) {
  return M.series.map((se) => {
    const { k, j, cor } = se; const l = kpiLast(k); const st = kpiStatus(k);
    const alvo = k.alvo == null ? 'sem alvo' : `${esc(k.dir || '')} ${comUnidade(k, k.alvo)}`;
    const atual = l ? `<b>${comUnidade(k, l.v)}</b>${l.s !== M.cur ? `<small> #${l.s}</small>` : ''}` : '<b>—</b>';
    return `<div class="kl${se.off ? ' off' : ''}" data-k="${esc(k.id)}"><button type="button" class="kl-t" aria-pressed="${!se.off}" title="${esc(k.titulo)}${se.norm ? '' : ' — sem alvo: escala própria (tracejado)'} · clique para ${se.off ? 'mostrar' : 'esconder'}">${chaveSVG(j, cor)}<span class="kl-n">${esc(k.titulo)}</span><span class="kl-v">${atual} → ${alvo}</span><span class="pill ${st.cls}">${esc(st.txt)}</span></button><span class="kl-a">${edit ? `<button type="button" class="linkbtn" data-kpi="${esc(k.id)}" title="Registrar medição">＋</button>` : ''}${k.url ? `<a href="${esc(k.url)}" target="_blank" rel="noopener" title="Abrir no Notion">↗</a>` : ''}</span></div>`;
  }).join('');
}

// HTML do gráfico + legenda de um KR. `kr` = cor do KR (krCor(i)). Depois de inserir, chamar bindKrChart.
export function krChartHTML(id, ks, { xs, cur, kr, width, edit = false }) {
  if (!ks.length) return '<div class="empty">Sem KPIs cadastrados.</div>';
  const M = modelo(id, ks, { xs, cur, kr, width });
  modelos.set(id, { M, opts: { xs, cur, kr, width, edit } });
  const leg = `<div class="kc-leg">${legendaHTML(M, { edit })}</div>`;
  // sem nenhuma medição no trimestre: só a legenda (o gráfico vazio só ocuparia espaço)
  if (!M.series.some((s) => s.pts.length)) return `<div class="kc vazio" data-kc="${esc(id)}" style="--kr:${kr}"><div class="kc-note">nenhuma medição de ${M.xs.length > 1 ? `#${M.xs[0]} a #${M.xs[M.xs.length - 1]}` : 'neste trimestre'}</div>${leg}</div>`;
  const temRep = M.series.some((s) => !s.off && s.pts.some((p) => p.rep));
  const temPropria = M.series.some((s) => !s.off && !s.norm && s.pts.length);
  return `<div class="kc" data-kc="${esc(id)}" style="--kr:${kr}"><div class="kc-plot">${svgHTML(M)}<div class="kc-tip" role="status" hidden></div></div><div class="kc-note">% do alvo · para cima = melhor${temRep ? ' · ○ sem medição: repete a última' : ''}${temPropria ? ' · tracejado = sem alvo (escala própria)' : ''}</div>${leg}</div>`;
}

function tipHTML(M, i) {
  const sp = M.xs[i];
  const linhas = M.series.filter((s) => !s.off).map((s) => {
    const p = s.pts.find((q) => q.i === i);
    const v = p ? `<b>${comUnidade(s.k, p.v)}</b>` : '<b>—</b>';
    const extra = p ? [s.norm ? pct(p.f) + ' do alvo' : 'sem alvo', p.rep ? `repetido da #${p.de}` : null].filter(Boolean).join(' · ') : 'sem medição';
    return `<div class="tl"><span class="key" style="background:${s.cor}"></span>${v}<small>${esc(extra)}</small><span class="nm">${esc(s.k.titulo)}</span></div>`;
  }).join('');
  return `<div class="th">Sprint #${sp}${sp === M.cur ? ' (atual)' : ''}</div>${linhas || '<div class="tl"><small>nenhum KPI visível</small></div>'}`;
}

// Liga hover/crosshair, teclado e legenda. onToggle: re-renderização do chamador (a escala muda).
export function bindKrChart(root, { onToggle } = {}) {
  const els = root.matches?.('.kc') ? [root] : [...root.querySelectorAll('.kc')];
  els.forEach((el) => {
    const reg = modelos.get(el.dataset.kc); if (!reg) return;
    const { M } = reg;
    const svg = el.querySelector('svg.kchart'); const tip = el.querySelector('.kc-tip'); const xh = svg?.querySelector('.xh');
    let idx = null;
    const show = (i) => {
      idx = i;
      const X = M.x(i);
      xh.setAttribute('x1', X); xh.setAttribute('x2', X);
      tip.innerHTML = tipHTML(M, i); tip.hidden = false;
      const frac = X / M.W;
      tip.style.left = frac > 0.55 ? '' : `calc(${(frac * 100).toFixed(1)}% + 10px)`;
      tip.style.right = frac > 0.55 ? `calc(${((1 - frac) * 100).toFixed(1)}% + 10px)` : '';
    };
    const hide = () => { idx = null; tip.hidden = true; xh.setAttribute('x1', -10); xh.setAttribute('x2', -10); };
    if (svg) svg.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const vx = ((e.clientX - r.left) / r.width) * M.W;
      let best = 0; let d = Infinity;
      M.xs.forEach((_, i) => { const dd = Math.abs(M.x(i) - vx); if (dd < d) { d = dd; best = i; } });
      show(best);
    });
    svg?.addEventListener('pointerleave', hide);
    svg?.addEventListener('blur', hide);
    svg?.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const n = idx == null ? M.xs.length - 1 : Math.max(0, Math.min(M.xs.length - 1, idx + (e.key === 'ArrowRight' ? 1 : -1)));
        show(n);
      } else if (e.key === 'Escape') hide();
    });
    el.querySelectorAll('.kl').forEach((row) => {
      const id = row.dataset.k;
      const g = () => svg?.querySelector(`g.s[data-k="${CSS.escape(id)}"]`);
      row.addEventListener('pointerenter', () => { el.classList.add('hl'); g()?.classList.add('on'); });
      row.addEventListener('pointerleave', () => { el.classList.remove('hl'); g()?.classList.remove('on'); });
      row.querySelector('.kl-t').addEventListener('click', () => {
        const se = M.series.find((s) => s.k.id === id);
        setOff(id, !se.off);
        if (onToggle) { onToggle(); return; }
        const t = document.createElement('div'); t.innerHTML = krChartHTML(M.id, M.ks, reg.opts);
        const novo = t.firstElementChild; el.replaceWith(novo); bindKrChart(novo);
      });
    });
  });
}
