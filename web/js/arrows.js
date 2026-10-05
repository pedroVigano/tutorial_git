// Setas de dependência entre metas (estilo Miro). Pontas e ordem dos cards calculadas em layout.js.
// Arrastar de uma bolinha da meta bloqueadora até a meta bloqueada → plano "Bloqueado por".
// Clicar numa seta → plano de remoção da dependência.
import { S, canWrite } from './store.js';
import { state, persist } from './state.js';
import { hooks } from './hooks.js';
import { portas, planejar, desenhar } from './layout.js';
import { esc, toast, $ } from './util.js';
import { stageChange } from './rascunho.js';

const metaOf = (id) => S.I.metaById[id];

function anchor(r, side, R) {
  const m = { n: [r.left + r.width / 2, r.top], s: [r.left + r.width / 2, r.bottom], w: [r.left, r.top + r.height / 2], e: [r.right, r.top + r.height / 2] }[side];
  return { x: m[0] - R.left, y: m[1] - R.top };
}
export function startConnect(e, card, side) {
  e.preventDefault(); e.stopPropagation();
  const wrap = $('#lanes-wrap'); const svg = $('#arrows');
  state.connect = { from: card.dataset.meta, side };
  document.body.classList.add('connecting');
  const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  tmp.setAttribute('class', 'tmp'); tmp.setAttribute('marker-end', 'url(#ah)'); svg.appendChild(tmp);
  const a = anchor(card.getBoundingClientRect(), side, wrap.getBoundingClientRect());
  let hover = null;
  const move = (ev) => {
    const R = wrap.getBoundingClientRect(); const x = ev.clientX - R.left; const y = ev.clientY - R.top;
    const c = Math.max(30, Math.abs(x - a.x) / 2);
    tmp.setAttribute('d', `M${a.x},${a.y} C${a.x + (side === 'e' ? c : side === 'w' ? -c : 0)},${a.y + (side === 's' ? c : side === 'n' ? -c : 0)} ${x},${y} ${x},${y}`);
    const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.card');
    if (hover && hover !== under) hover.classList.remove('hover-target');
    hover = under && under.dataset.meta !== state.connect.from ? under : null;
    if (hover) hover.classList.add('hover-target');
  };
  const up = (ev) => {
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
    tmp.remove(); document.body.classList.remove('connecting'); if (hover) hover.classList.remove('hover-target');
    const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.card');
    const from = state.connect.from; state.connect = null;
    if (!target || target.dataset.meta === from) { toast('Solte sobre outra meta para ligar a dependência'); return; }
    const to = target.dataset.meta;
    if ((metaOf(to)?.bloq || []).includes(from)) { toast('Essa dependência já existe'); return; }
    stageChange('dependencia.criar', { bloqueada: to, bloqueadora: from });
  };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}

// Ponta visível de uma meta para as setas: o card (o mais próximo da outra ponta, quando a meta aparece em
// várias lanes) ou, se a meta está num grupo recolhido, o cabeçalho do ancestral recolhido mais próximo.
function grupoRecolhido(sub) {
  const { I } = S;
  let n = I.byId[sub]; const seen = new Set();
  while (n && !seen.has(n.id)) {
    seen.add(n.id);
    const lane = document.querySelector(`#lanes .lane[data-lane="${CSS.escape(n.id)}"]`);
    if (lane && lane.offsetParent) return n.id === sub ? null : { grupo: n.id, el: lane.querySelector('.lane-h') };
    if (!n.pai) {
      const ph = document.querySelector(`#lanes .proj.closed > .proj-h[data-toggle="${CSS.escape(n.id)}"]`);
      return ph ? { grupo: n.id, el: ph } : null;
    }
    n = I.byId[n.pai];
  }
  return null;
}
function pontasDe(id) {
  const cards = [...document.querySelectorAll(`#lanes .card[data-meta="${CSS.escape(id)}"]`)];
  if (cards.length) return cards.map((el) => ({ el, card: true }));
  const m = metaOf(id);
  if (!m || m.fora || !m.sprints.includes(S.D.sprint)) return [];
  const gs = new Map();
  (m.subs || []).forEach((s) => { const g = grupoRecolhido(s); if (g && !gs.has(g.grupo)) gs.set(g.grupo, g); });
  return [...gs.values()];
}

let hoverLigado = false;
function ligarHover() { // passar o mouse num card destaca as setas dele
  if (hoverLigado) return; hoverLigado = true;
  const lanes = $('#lanes'); const svg = $('#arrows');
  lanes.addEventListener('pointerover', (e) => {
    const c = e.target.closest('.card'); if (!c) return;
    const id = c.dataset.meta; let algum = false;
    svg.querySelectorAll('path[data-de]').forEach((p) => {
      const on = p.dataset.de.split(' ').includes(id) || p.dataset.para.split(' ').includes(id);
      p.classList.toggle('on', on); algum = algum || on;
    });
    svg.classList.toggle('hl', algum);
  });
  lanes.addEventListener('pointerout', (e) => {
    if (e.relatedTarget && e.target.closest('.card')?.contains(e.relatedTarget)) return;
    svg.classList.remove('hl'); svg.querySelectorAll('path.on').forEach((p) => p.classList.remove('on'));
  });
}

export function drawArrows() {
  const svg = $('#arrows'); const wrap = $('#lanes-wrap');
  if (!svg || !S.D || document.getElementById('page-board').hidden) return;
  ligarHover();
  const R = wrap.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${R.width} ${R.height}`); svg.style.height = `${R.height}px`;
  const chave = new Map(); const rects = new Map();
  const keyOf = (el) => {
    if (!chave.has(el)) {
      const k = `p${chave.size}`; chave.set(el, k);
      const r = el.getBoundingClientRect();
      rects.set(k, { x: r.left - R.left, y: r.top - R.top, w: r.width, h: r.height });
    }
    return chave.get(el);
  };
  const centro = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const sprint = S.D.sprint;
  const edges = [];
  S.D.metas.forEach((m) => (m.bloq || []).forEach((b) => edges.push({ from: b, to: m.id })));
  // uma ligação por par de pontas visíveis; setas para o mesmo grupo recolhido se juntam (×N)
  const ligs = new Map();
  edges.forEach((e, idx) => {
    const A = pontasDe(e.from); const B = pontasDe(e.to);
    if (!A.length || !B.length) return;
    let best = null;
    A.forEach((a) => B.forEach((b) => {
      if (a.el === b.el) return;
      const [ax, ay] = centro(a.el); const [bx, by] = centro(b.el);
      const d = Math.hypot(ax - bx, ay - by);
      if (!best || d < best.d) best = { a, b, d };
    }));
    if (!best) return;
    const ka = keyOf(best.a.el); const kb = keyOf(best.b.el);
    const k = `${ka}>${kb}`;
    if (!ligs.has(k)) ligs.set(k, { a: ka, b: kb, pa: best.a, pb: best.b, edges: [] });
    ligs.get(k).edges.push({ ...e, idx });
  });
  const lista = [...ligs.values()];
  lista.forEach((g) => Object.assign(g, planejar(rects.get(g.a), rects.get(g.b), { grupoA: !g.pa.card, grupoB: !g.pb.card })));
  const ps = portas(rects, lista);
  // corredor das rotas longas: entre as colunas Desejos e Metas (alinhadas em todos os projetos)
  const colMetas = wrap.querySelector('.proj:not(.closed) .cols-h > div:nth-child(3)');
  const gx0 = colMetas ? colMetas.getBoundingClientRect().left - R.left - 3 : 8;
  let nGuia = 0;
  let out = '<defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke"/></marker></defs>';
  lista.forEach((g, i) => {
    const { p1, p2 } = ps[i];
    const crit = g.edges.some((e) => { const bl = metaOf(e.from); return bl && (!bl.sprints.includes(sprint) || bl.status === 'Não iniciada' || bl.status === 'Abortado'); });
    const pend = g.edges.some((e) => (S.D.pendEdges || []).includes(`${e.from}>${e.to}`));
    const rem = g.edges.every((e) => (S.D.remEdges || []).includes(`${e.from}>${e.to}`));
    const direta = g.pa.card && g.pb.card && g.edges.length === 1;
    const grupo = g.pa.grupo || g.pb.grupo;
    const titulo = g.edges.map((e) => `${metaOf(e.from)?.titulo || e.from} bloqueia ${metaOf(e.to)?.titulo || e.to}`).join('\n');
    const acao = rem ? ' — remoção no rascunho (clique para desfazer)' : pend ? ' — no rascunho, ainda não gravada (clique para desfazer)' : direta ? (canWrite() ? ' — clique para remover' : '') : grupo ? `\n(${S.I.byId[grupo]?.nome || 'grupo'} recolhido — clique para expandir)` : '';
    const off = g.tipo === 'guia' ? (nGuia++ % 3) * 3 : 0;
    const d = desenhar(g.tipo, p1, p2, { gx: gx0 - off, off });
    out += `<path d="${d}" class="${crit ? 'crit' : ''}${grupo ? ' agr' : ''}${pend ? ' pend' : ''}${rem ? ' rem' : ''}" ${direta ? `data-edge="${g.edges[0].idx}"` : ''} ${grupo ? `data-grupo="${esc(grupo)}"` : ''} data-de="${esc(g.edges.map((e) => e.from).join(' '))}" data-para="${esc(g.edges.map((e) => e.to).join(' '))}" marker-end="url(#ah)"><title>${esc(titulo + acao)}</title></path>`;
    const [mx, my] = g.tipo === 'guia' ? [gx0 - off - 4, (p1.y + p2.y) / 2] : [(p1.x + p2.x) / 2, (p1.y + p2.y) / 2];
    if (g.edges.length > 1 || grupo) out += `<text class="lab n" x="${mx}" y="${my - 5}" text-anchor="middle">×${g.edges.length}</text>`;
    else if (crit) out += `<text class="lab" x="${mx}" y="${my - 6}" text-anchor="middle">bloqueio fora da sprint / não iniciado</text>`;
  });
  svg.innerHTML = out;
  svg.querySelectorAll('path[data-grupo]').forEach((p) => {
    p.onclick = () => { // expande o grupo recolhido (e os ancestrais recolhidos, se houver)
      let n = S.I.byId[p.dataset.grupo];
      while (n) { state.closed.delete(n.id); n = n.pai ? S.I.byId[n.pai] : null; }
      persist(); hooks.render();
    };
  });
  if (!canWrite()) { svg.querySelectorAll('path[data-edge]').forEach((p) => { p.style.pointerEvents = 'none'; }); return; }
  svg.querySelectorAll('path[data-edge]').forEach((p) => {
    p.onclick = () => {
      const e = edges[+p.dataset.edge];
      // remover uma dependência que está para ser removida = desfazer a remoção (volta a "criar")
      if ((S.D.remEdges || []).includes(`${e.from}>${e.to}`)) stageChange('dependencia.criar', { bloqueada: e.to, bloqueadora: e.from });
      else stageChange('dependencia.remover', { bloqueada: e.to, bloqueadora: e.from });
    };
  });
}
