// Setas de dependência entre metas (estilo Miro), portadas do mock v2.2.
// Arrastar de uma bolinha da meta bloqueadora até a meta bloqueada → plano "Bloqueado por".
// Clicar numa seta → plano de remoção da dependência.
import { S } from './store.js';
import { state } from './state.js';
import { esc, toast, $ } from './util.js';
import { requestWrite } from './plan-modal.js';

const metaOf = (id) => S.I.metaById[id];

function anchor(r, side, R) {
  const m = { n: [r.left + r.width / 2, r.top], s: [r.left + r.width / 2, r.bottom], w: [r.left, r.top + r.height / 2], e: [r.right, r.top + r.height / 2] }[side];
  return { x: m[0] - R.left, y: m[1] - R.top };
}
function autoSides(a, b) {
  const overlapX = a.left < b.right && b.left < a.right;
  if (overlapX) return b.top > a.top ? ['s', 'n'] : ['n', 's'];
  return b.left >= a.right ? ['e', 'w'] : ['w', 'e'];
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
    requestWrite('dependencia.criar', { bloqueada: to, bloqueadora: from });
  };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}

export function drawArrows() {
  const svg = $('#arrows'); const wrap = $('#lanes-wrap');
  if (!svg || !S.D || document.getElementById('page-board').hidden) return;
  const R = wrap.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${R.width} ${R.height}`); svg.style.height = `${R.height}px`;
  const firstCard = (id) => wrap.querySelector(`.card[data-meta="${id}"]`);
  let out = '<defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke"/></marker></defs>';
  const edges = [];
  S.D.metas.forEach((m) => (m.bloq || []).forEach((b) => edges.push({ from: b, to: m.id })));
  const sprint = S.D.sprint;
  edges.forEach((e, idx) => {
    const A = firstCard(e.from); const B = firstCard(e.to);
    if (!A || !B) return;
    const a = A.getBoundingClientRect(); const b = B.getBoundingClientRect();
    const blocker = metaOf(e.from);
    const crit = blocker && (!blocker.sprints.includes(sprint) || blocker.status === 'Não iniciada' || blocker.status === 'Abortado');
    const [sa, sb] = autoSides(a, b);
    const p1 = anchor(a, sa, R); const p2 = anchor(b, sb, R);
    const dir = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };
    const c = Math.max(30, Math.min(140, Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2));
    const d = `M${p1.x},${p1.y} C${p1.x + dir[sa][0] * c},${p1.y + dir[sa][1] * c} ${p2.x + dir[sb][0] * c},${p2.y + dir[sb][1] * c} ${p2.x},${p2.y}`;
    out += `<path d="${d}" class="${crit ? 'crit' : ''}" data-edge="${idx}" marker-end="url(#ah)"><title>${esc(blocker ? blocker.titulo : e.from)} bloqueia ${esc(metaOf(e.to)?.titulo || e.to)}${S.meta?.pode_gravar && !state.tv ? ' — clique para remover' : ''}</title></path>`;
    if (crit) out += `<text class="lab" x="${(p1.x + p2.x) / 2}" y="${(p1.y + p2.y) / 2 - 6}" text-anchor="middle">bloqueio fora da sprint / não iniciado</text>`;
  });
  svg.innerHTML = out;
  if (!S.meta?.pode_gravar || state.tv) { svg.querySelectorAll('path[data-edge]').forEach((p) => { p.style.pointerEvents = 'none'; }); return; }
  svg.querySelectorAll('path[data-edge]').forEach((p) => {
    p.onclick = () => { const e = edges[+p.dataset.edge]; requestWrite('dependencia.remover', { bloqueada: e.to, bloqueadora: e.from }); };
  });
}
