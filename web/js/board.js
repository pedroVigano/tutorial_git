// Página Board: barra de objetivos, coluna OKR (KPIs com série por sprint), lanes Projeto › Sistema ›
// Subsistema com desejos e metas, legenda e alertas. Portado do mock v2.2 — agora com dados ao vivo.
import { S } from './store.js';
import { state, persist, order } from './state.js';
import { esc, fmt, dm, toast, $, $$ } from './util.js';
import { kpiLast, kpiStatus, krStatus, objStatus, coverage, stColor, visibleProjects, computeAlerts, OUTROS } from './rules.js';
import { hooks, writeLog } from './hooks.js';
import { requestWrite } from './plan-modal.js';
import { openDrawer } from './drawer.js';
import { openMetaForm } from './meta-form.js';
import { openKpiForm } from './kpi-form.js';
import { drawArrows, startConnect } from './arrows.js';

export const canWrite = () => !!S.meta?.pode_gravar && !state.tv;

// ---------- cores das equipes (vêm do snapshot) ----------
export function applyAreaColors(areas) {
  let el = document.getElementById('area-colors');
  if (!el) { el = document.createElement('style'); el.id = 'area-colors'; document.head.appendChild(el); }
  const light = Object.entries(areas).map(([k, a]) => `--${k}:${a.c}`).join(';');
  const dark = Object.entries(areas).map(([k, a]) => `--${k}:${a.cd}`).join(';');
  el.textContent = `:root{${light}}@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${dark}}}:root[data-theme="dark"]{${dark}}`;
}

// ---------- filtros ----------
const matchEquipe = (m) => {
  if (state.equipe === 'todas') return true;
  if (state.equipe === '_pd') return !S.D.areas[m.area]?.ext;
  return m.area === state.equipe || (m.areas || []).includes(state.equipe);
};
const matchObj = (m) => state.modo !== 'filtrar' || state.obj === 'all' || (m.okrs || []).includes(state.obj);
export const showMeta = (m) => matchObj(m) && matchEquipe(m);

// ---------- barra de objetivos ----------
function renderObjbar() {
  const { D, I } = S;
  const bar = $('#objbar'); bar.innerHTML = '';
  const mk = (id, html, title) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.innerHTML = html; if (title) b.title = title;
    b.setAttribute('aria-pressed', state.obj === id);
    b.onclick = () => { state.obj = id; persist(); hooks.render(); };
    return b;
  };
  bar.appendChild(mk('all', '<span class="ico">◎</span>Todos os objetivos'));
  D.objetivos.forEach((o) => {
    const s = objStatus(I, o);
    bar.appendChild(mk(o.id, `<span class="ico">${esc(o.icone)}</span><span>${o.label} · ${esc(o.curto)}</span><span class="st" style="background:${stColor(s.cls)}" title="${s.txt}"></span>`, o.titulo));
  });
  const eq = document.createElement('label');
  eq.className = 'ctl eq';
  const pdTeams = Object.entries(D.areas).filter(([, a]) => !a.ext);
  const others = Object.entries(D.areas).filter(([, a]) => a.ext);
  eq.innerHTML = `Equipe <select id="sel-equipe"><option value="todas">Todas</option><option value="_pd">Só P&amp;D</option><optgroup label="P&amp;D">${pdTeams.map(([k, a]) => `<option value="${k}">${esc(a.nome)}</option>`).join('')}</optgroup><optgroup label="Outras diretorias">${others.map(([k, a]) => `<option value="${k}">${esc(a.nome)}</option>`).join('')}</optgroup></select>`;
  bar.appendChild(eq);
  const sel = eq.querySelector('select');
  sel.value = D.areas[state.equipe] || state.equipe === '_pd' ? state.equipe : 'todas';
  sel.onchange = () => { state.equipe = sel.value; persist(); hooks.render(); };
  const seg = document.createElement('div');
  seg.className = 'seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Metas de outros objetivos');
  [['destacar', 'Destacar'], ['filtrar', 'Filtrar']].forEach(([v, l]) => {
    const b = document.createElement('button');
    b.textContent = l; b.setAttribute('aria-pressed', state.modo === v);
    b.title = v === 'destacar' ? 'Metas de outros objetivos ficam esmaecidas' : 'Só metas do objetivo ativo';
    b.onclick = () => { state.modo = v; persist(); hooks.render(); };
    seg.appendChild(b);
  });
  bar.appendChild(seg);
}

// ---------- coluna OKR ----------
// Um gráfico por KR com todos os KPIs juntos. Cada KPI tem a sua própria escala (unidades diferentes),
// então a altura de cada linha só compara a trajetória dela com o próprio alvo; os valores reais ficam
// no tooltip dos pontos e na legenda (placar de cada KPI logo abaixo).
const N_SERIES = 8; // --s1..--s8 em app-real.css; a partir daí cinza, nunca cor repetida
const serieCor = (i) => (i < N_SERIES ? `var(--s${i + 1})` : 'var(--neutral)');
const comUnidade = (k, v) => `${fmt(v)}${k.unidade ? ` ${esc(k.unidade)}` : ''}`;

function krChart(ks) {
  if (!ks.length) return '';
  const xs = S.I.sprintNums;
  const W = 320; const H = 150; const pl = 16; const pr = 16; const pt = 12; const pb = 22;
  const x = (i) => (xs.length > 1 ? pl + (i * (W - pl - pr)) / (xs.length - 1) : W / 2);
  const base = H - pb;
  const scale = (k) => {
    const nums = xs.map((s) => k.serie[String(s)]).filter((v) => v != null); if (k.alvo != null) nums.push(k.alvo);
    let lo = Math.min(0, ...nums); let hi = Math.max(...nums, 1); if (hi === lo) hi = lo + 1;
    const pad = (hi - lo) * 0.18; lo -= pad * 0.4; hi += pad;
    return (v) => base - ((v - lo) / (hi - lo)) * (base - pt);
  };
  let s = `<svg class="kchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Série de ${ks.length} KPI(s) por sprint, cada um na sua escala">`;
  s += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${base}" y2="${base}"/><line class="grid soft" x1="${pl}" x2="${W - pr}" y1="${(base + pt) / 2}" y2="${(base + pt) / 2}"/>`;
  const ys = ks.map(scale);
  ks.forEach((k, j) => { // alvos por baixo das linhas
    if (k.alvo == null) return;
    const ty = ys[j](k.alvo);
    s += `<line class="tgt" stroke="${serieCor(j)}" x1="${pl}" x2="${W - pr}" y1="${ty}" y2="${ty}"><title>${esc(k.titulo)} — alvo ${esc(k.dir || '')} ${comUnidade(k, k.alvo)}</title></line>`;
  });
  ks.forEach((k, j) => {
    const col = serieCor(j); const last = kpiLast(k);
    const pts = xs.map((sp, i) => (k.serie[String(sp)] != null ? { sp, i, v: k.serie[String(sp)], y: ys[j](k.serie[String(sp)]) } : null)).filter(Boolean);
    if (pts.length > 1) s += `<polyline class="ln" stroke="${col}" points="${pts.map((p) => `${x(p.i)},${p.y}`).join(' ')}"/>`;
    pts.forEach((p) => {
      const cur = last && p.sp === last.s;
      s += `<g class="pt"><title>${esc(k.titulo)} · #${p.sp}: ${comUnidade(k, p.v)}</title><circle class="hit" cx="${x(p.i)}" cy="${p.y}" r="9"/><circle cx="${x(p.i)}" cy="${p.y}" r="${cur ? 5.5 : 4}" fill="${col}"/></g>`;
    });
  });
  xs.forEach((sp, i) => { s += `<text class="sp ${sp === S.D.sprint ? 'cur' : ''}" x="${x(i)}" y="${H - 6}" text-anchor="middle">#${sp}</text>`; });
  return `${s}</svg><div class="kchart-note">cada KPI na sua própria escala · tracejado = alvo</div>`;
}

export function scoreHTML(k) {
  const st = kpiStatus(k); const l = kpiLast(k); const col = stColor(st.cls);
  const cur = l ? `${fmt(l.v)}<small>${esc(k.unidade || '')}</small>` : '—<small>sem medição</small>';
  const alvo = k.alvo == null ? '<b style="color:var(--warn);font-size:13px">⚠ definir alvo</b>' : `<b>${esc(k.dir)} ${fmt(k.alvo)}</b> ${esc(k.unidade || '')}<small>alvo${k.limite ? ` até ${dm(k.limite)}` : ''}</small>`;
  return `<div class="score" style="--stc:${col}"><div><div class="cur">${cur}</div>${l ? `<small style="font-family:var(--mono);font-size:10.5px;color:var(--muted)">medido na #${l.s}</small>` : ''}</div><span class="vs">vs</span><div class="alvo">${alvo}</div><span class="pill ${st.cls}">${st.txt}</span></div>`;
}

function renderOKR() {
  const { D, I } = S;
  const el = $('#okr');
  if (state.obj === 'all' || !I.objById[state.obj]) {
    el.innerHTML = `<div class="okr-h"><span class="eyebrow">OKRs táticos · ${esc(D.trimestre.id)} · Área ∋ P&amp;D</span><h2>${D.objetivos.length} objetivos · ${D.krs.length} resultados-chave · ${D.kpis.length} KPIs</h2><div class="meta">Clique num objetivo para ver KRs e a série de cada KPI.</div></div><div class="overview" id="ov"></div>`;
    const ov = el.querySelector('#ov');
    if (!D.objetivos.length) ov.innerHTML = `<div class="empty">Nenhum objetivo de P&amp;D com Trimestre = ${esc(D.trimestre.id)} no Notion.</div>`;
    D.objetivos.forEach((o) => {
      const s = objStatus(I, o); const c = coverage(I, o);
      const d = document.createElement('button');
      d.className = 'ov';
      d.innerHTML = `<span class="ico">${esc(o.icone)}</span><span><div class="t">${o.label} · ${esc(o.titulo)}</div><div class="cov">${I.krsOf(o.id).length} KRs · ${c.n} KPIs · ${c.med} com medição · projetos: ${o.projetos.map((p) => esc(I.byId[p]?.nome || '?')).join(', ') || '—'}</div><div class="bar"><i style="width:${c.n ? Math.round((100 * c.med) / c.n) : 0}%"></i></div></span><span class="pill ${s.cls}">${s.txt}</span>`;
      d.onclick = () => { state.obj = o.id; persist(); hooks.render(); };
      ov.appendChild(d);
    });
    return;
  }
  const o = I.objById[state.obj]; const s = objStatus(I, o);
  el.innerHTML = `<div class="okr-h"><span class="eyebrow">${o.label} · Objetivo · ${esc(D.trimestre.id)}</span><h2>${esc(o.icone)} ${esc(o.titulo)}</h2><div class="meta"><span class="pill ${s.cls}">${s.txt}</span>${o.limite ? `<span class="pill">limite ${dm(o.limite)}</span>` : ''}${o.projetos.map((p) => `<span class="pill">${esc(I.byId[p]?.nome || '?')}</span>`).join('')}${o.alerta ? `<span class="pill st-warn" title="${esc(o.alerta)}">⚠ reapontar</span>` : ''}<a href="${esc(o.url)}" target="_blank" rel="noopener" style="font-size:11px">abrir no Notion ↗</a></div></div>`;
  I.krsOf(o.id).forEach((kr) => {
    const st = krStatus(I, kr); const ks = I.kpisOf(kr.id);
    const det = document.createElement('details');
    det.className = 'kr'; det.open = true;
    const kpiRow = (k, j) => `<div class="kpi" style="--sc:${serieCor(j)}"><div class="n"><i class="swk"></i>${esc(k.titulo)}<small>${k.limite ? `até ${dm(k.limite)} · ` : ''}<a href="${esc(k.url)}" target="_blank" rel="noopener">Notion ↗</a>${canWrite() ? ` · <button type="button" class="linkbtn" data-kpi="${k.id}">＋ registrar medição</button>` : ''}</small></div><div class="body">${scoreHTML(k)}</div></div>`;
    det.innerHTML = `<summary><div><span class="eyebrow">${kr.label}</span><div class="t">${esc(kr.titulo)}</div></div><div class="s"><span class="pill ${st.cls}">${st.txt}</span><span class="pill">${kr.limite ? dm(kr.limite) : 'sem data'}</span></div></summary><div class="body">${krChart(ks)}${ks.map(kpiRow).join('') || '<div class="empty">Sem KPIs cadastrados.</div>'}</div>`;
    el.appendChild(det);
  });
  if (!I.krsOf(o.id).length) el.insertAdjacentHTML('beforeend', '<div class="empty">Objetivo sem resultados-chave cadastrados.</div>');
  $$('[data-kpi]', el).forEach((b) => { b.onclick = () => openKpiForm(D.kpis.find((k) => k.id === b.dataset.kpi)); });
}

// ---------- lanes ----------
function metasIn(sub) {
  const ms = S.D.metas.filter((m) => m.sprints.includes(S.D.sprint) && m.subs.includes(sub) && !m.fora);
  const ord = order.get(sub);
  return ms.slice().sort((a, b) => { const ia = ord.indexOf(a.id); const ib = ord.indexOf(b.id); return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib); });
}

function lanesFor(pid) {
  const { D, I } = S;
  const out = [];
  D.tree.filter((n) => I.rootOf(n.id) === pid).forEach((n) => {
    if (n.id !== pid && I.isLane(n)) out.push(n);
    else if (metasIn(n.id).length) out.push({ ...n, synthetic: true });
  });
  return out;
}

function cardHTML(m, sub) {
  const { D, I } = S;
  const a = D.areas[m.area] || { nome: m.area };
  const linked = state.obj !== 'all' && (m.okrs || []).includes(state.obj);
  const dim = state.obj !== 'all' && !linked && state.modo === 'destacar';
  const shared = m.subs && m.subs.length > 1;
  const ec = m.via_ec?.[sub];
  const t = m.tarefas;
  const tk = t ? `<div class="tk" title="Tarefas: A Fazer · Em Andamento · Em Revisão · Concluídas${t.Bloqueada ? ' · Bloqueadas' : ''}"><span>a fazer <b>${t['A Fazer']}</b></span><span>andam. <b>${t['Em Andamento']}</b></span><span>rev. <b>${t['Em Revisão']}</b></span><span>concl. <b>${t['Concluída']}</b></span>${t.Bloqueada ? `<span style="color:var(--crit)">bloq. <b>${t.Bloqueada}</b></span>` : ''}</div>` : '';
  const stcls = m.status === 'Concluído' ? 'st-good' : m.status === 'Em andamento' ? 'st-run' : m.status === 'Abortado' ? 'st-crit' : 'st-neutral';
  const w = canWrite();
  return `<div class="card ${dim ? 'dim' : ''} ${state.linking === m.id ? 'linking' : ''}" role="button" tabindex="0" ${w ? 'draggable="true"' : ''} data-meta="${m.id}" data-sub="${sub}" style="--team:var(--${m.area})" title="${esc(m.titulo)}${w ? ' — arraste para reordenar ou mudar de subsistema; arraste de uma bolinha até outra meta para ligar dependência' : ''}">${w ? ['n', 'e', 's', 'w'].map((sd) => `<span class="hd ${sd}" data-hd="${sd}" draggable="false" title="Arraste até a meta que esta bloqueia"></span>`).join('') : ''}
    <div class="row"><span class="team">${esc(a.nome)}${(m.areas || []).length > 1 ? ` <span class="tag ex" title="${(m.areas || []).map(I.AREA_NAME).join(' + ')} — regra: 1 equipe por meta">+${m.areas.length - 1} área</span>` : ''}</span>${shared ? `<span class="tag" title="Meta ligada a ${m.subs.length} subsistemas — aparece em cada lane">×${m.subs.length} subs</span>` : ''}${ec ? `<span class="tag" style="background:var(--warn-bg);color:var(--warn)" title="No Notion a meta está ligada ao Entregável-Chave ${esc(ec.map((e) => `"${e.nome}"`).join(', '))}, tipo que saiu do modelo — reapontar para este item">via entregável-chave</span>` : ''}${linked ? '<span class="star" title="Ligada ao objetivo ativo">★</span>' : ''}</div>
    <div class="tt">${esc(m.titulo)}</div>
    <div class="row"><span class="pill ${stcls}">${esc(m.status)}</span>${(m.okrs || []).map((o) => `<span class="pill" title="${esc(I.objById[o]?.titulo || '')}">${I.objLabel(o)}</span>`).join('')}${(m.okrs_extra || []).map((o) => `<span class="pill st-warn" title="${esc(o)}">OKR fora de P&amp;D/${esc(D.trimestre.id)}</span>`).join('')}${m.n_sprints > 1 ? `<span class="pill" title="Aparece em ${m.n_sprints} sprints: ${m.sprints.map((x) => `#${x}`).join(' → ')}">↻ ${m.n_sprints}</span>` : ''}${(m.bloq || []).length ? `<span class="pill" title="Bloqueada por ${m.bloq.length} meta(s)">⛓ ${m.bloq.length}</span>` : ''}</div>${tk}</div>`;
}

function wishHTML(d) {
  return `<div class="wish"><div>${esc(d.titulo)} <a href="${esc(d.url)}" target="_blank" rel="noopener" style="font-size:10px">↗</a></div><div class="w-meta"><span class="tag">${esc(d.stakeholder)}</span><span class="tag">${esc(d.evidencia)}</span><span class="tag" style="${d.sprints_em_analise > 2 ? 'background:var(--warn-bg);color:var(--warn)' : ''}" title="aproximado: sprints desde a criação do desejo">~${d.sprints_em_analise} sprint(s) em análise</span></div>${canWrite() ? `<button type="button" class="mk" data-wish="${d.id}">+ meta de elaboração do requisito</button>` : ''}</div>`;
}

function laneHTML(n) {
  const { D, I } = S;
  const ms = metasIn(n.id);
  const ds = D.desejos.filter((d) => d.subs.includes(n.id) && d.status === 'Em análise');
  const a = (n.areas || []).filter((x) => x !== 'pd');
  const stcls = n.status === 'Concluído' ? 'var(--good)' : n.status === 'Em andamento' ? 'var(--accent)' : n.status === 'Abortado' ? 'var(--crit)' : 'var(--neutral)';
  const path = I.pathOf(n.id).slice(1, -1).join(' › ');
  const tagTipo = n.synthetic
    ? `<span class="tag" style="font-family:var(--mono);font-size:9.5px;background:var(--warn-bg);color:var(--warn)">metas ligadas ao ${esc(String(n.tipo).toLowerCase())}, não a um subsistema</span>`
    : (n.tipo !== 'Subsistema' ? `<span class="tag" style="font-family:var(--mono);font-size:9.5px;color:var(--muted)">${esc(n.tipo)}${n.tipo === 'Sistema' ? ' sem subsistemas' : ''}</span>` : '');
  const resp = n.resp
    ? `<span class="resp" title="Responsável no Notion">👤 ${esc(n.resp)}</span>`
    : '<span class="resp none" title="Sem responsável — sem quem revise tarefas nem sugira requisitos">⚠ sem responsável</span>';
  const cards = ms.filter(showMeta);
  return `<div class="lane ${n.resp ? '' : 'warnlane'}" data-lane="${n.id}"><div class="lane-h"><div class="nm">${esc(n.nome)} ${tagTipo}${n.url ? ` <a href="${esc(n.url)}" target="_blank" rel="noopener" style="font-size:10px">↗</a>` : ''}</div>${path ? `<div class="eyebrow" style="margin-top:2px;letter-spacing:0;text-transform:none">${esc(path)}</div>` : ''}<div class="info"><span class="dot" style="background:${stcls}" title="${esc(n.status)}"></span><span style="font-size:11px;color:var(--ink-2)">${esc(n.status)}</span>${resp}${a.map((x) => `<span class="pill" style="border-color:var(--${x});color:var(--${x})">${esc(I.AREA_NAME(x))}</span>`).join('')}</div></div>
  <div class="cards">${ds.map(wishHTML).join('') || '<span class="empty">—</span>'}</div>
  <div class="cards drop">${cards.map((m) => cardHTML(m, n.id)).join('')}${canWrite() && !n.sem_acesso ? `<button type="button" class="add" data-add="${n.id}" title="Nova meta neste subsistema">+</button>` : ''}</div></div>`;
}

function renderLanes() {
  const { D, I } = S;
  const el = $('#lanes'); el.innerHTML = '';
  const vis = visibleProjects(D, I, { sprint: D.sprint, obj: state.obj });
  if (!vis.length) el.innerHTML = '<div class="empty">Nenhum projeto ligado aos objetivos de P&amp;D deste trimestre.</div>';
  vis.forEach((pid) => {
    const p = I.byId[pid]; if (!p) return;
    const closed = state.closed.has(pid);
    const lanes = lanesFor(pid);
    const nMetas = lanes.reduce((s, n) => s + metasIn(n.id).filter(showMeta).length, 0);
    const wrap = document.createElement('div');
    wrap.className = `proj${closed ? ' closed' : ''}`;
    wrap.innerHTML = `<div class="proj-h" data-toggle="${pid}"><h2>${esc(p.nome)}</h2><span class="cnt">${lanes.length} lanes · ${nMetas} metas na #${D.sprint}${pid === OUTROS ? '' : (p.resp ? ` · 👤 ${esc(p.resp)}` : ' · <span style="color:var(--warn)">⚠ projeto sem responsável</span>')}</span>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" style="font-size:11px" onclick="event.stopPropagation()">Notion ↗</a>` : ''}<span class="car">▾</span></div><div class="proj-b"><div class="cols-h"><div>Projeto › Sistema › Subsistema</div><div>Desejos em análise (sem requisito)</div><div>Metas da sprint #${D.sprint}</div></div><div class="groups"></div></div>`;
    const groups = wrap.querySelector('.groups');
    const bySys = {};
    lanes.forEach((n) => { const k = n.pai || n.id; (bySys[k] = bySys[k] || []).push(n); });
    Object.keys(bySys).forEach((sid) => {
      const sys = I.byId[sid]; const sclosed = state.closed.has(sid);
      const g = document.createElement('div');
      g.className = `sys${sclosed ? ' closed' : ''}`;
      const label = sys.tipo === 'Projeto' && !sys.pai ? (sid === OUTROS ? 'Itens fora dos projetos dos objetivos — metas a reapontar' : 'Direto no projeto') : I.pathOf(sid).slice(1).join(' › ');
      g.innerHTML = `<div class="sys-h" data-toggle="${sid}"><span class="car">▾</span><span>${esc(label)}</span><span class="depth">· ${bySys[sid].length} lane(s)</span></div>${bySys[sid].map(laneHTML).join('')}`;
      groups.appendChild(g);
    });
    el.appendChild(wrap);
  });
  // metas sem subsistema → bloco recolhível no fim
  const orphan = D.metas.filter((m) => m.sprints.includes(D.sprint) && !m.fora && m.subs.length === 0 && showMeta(m));
  if (orphan.length) {
    el.insertAdjacentHTML('beforeend', `<div class="proj ${state.closed.has('orphan') ? 'closed' : ''}"><div class="proj-h" data-toggle="orphan"><h2>⚠ Metas sem subsistema</h2><span class="cnt">${orphan.length} na sprint #${D.sprint} · regra do modelo: toda meta liga a ≥ 1 subsistema e a ≥ 1 objetivo · várias são de outras diretorias (use o filtro Equipe)</span><span class="car">▾</span></div><div class="proj-b"><div class="lane" data-lane=""><div class="lane-h"><div class="nm">Sem subsistema</div><div class="info"><span class="resp none">precisa de reapontamento</span></div></div><div class="cards"><span class="empty">—</span></div><div class="cards drop">${orphan.map((m) => cardHTML(m, '')).join('')}${canWrite() ? '<button type="button" class="add" data-add="" title="Nova meta sem subsistema">+</button>' : ''}</div></div></div></div>`);
  }
  bindLanes(el);
  requestAnimationFrame(drawArrows);
}

function bindLanes(el) {
  $$('[data-toggle]', el).forEach((h) => {
    h.onclick = () => { const id = h.dataset.toggle; if (state.closed.has(id)) state.closed.delete(id); else state.closed.add(id); persist(); renderLanes(); };
  });
  $$('.card', el).forEach((c) => {
    c.onclick = (e) => { if (e.target.classList.contains('hd')) return; if (c._justDragged) { c._justDragged = false; return; } onCard(c.dataset.meta); };
    c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCard(c.dataset.meta); } };
    if (!canWrite()) return;
    c.addEventListener('dragstart', (e) => {
      if (state.connect) { e.preventDefault(); return; }
      state.drag = { id: c.dataset.meta, sub: c.dataset.sub };
      c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', c.dataset.meta); } catch { /* ignora */ }
    });
    c.addEventListener('dragend', () => {
      c.classList.remove('dragging'); state.drag = null;
      $$('.drop-before,.drop-after', el).forEach((x) => x.classList.remove('drop-before', 'drop-after'));
      $$('.cards.drop-target', el).forEach((x) => x.classList.remove('drop-target'));
    });
    $$('.hd', c).forEach((h) => { h.addEventListener('pointerdown', (e) => startConnect(e, c, h.dataset.hd)); h.addEventListener('mousedown', (e) => e.preventDefault()); });
  });
  if (canWrite()) {
    $$('.lane .cards.drop', el).forEach((zone) => {
      zone.addEventListener('dragover', (e) => {
        if (!state.drag) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'move'; zone.classList.add('drop-target');
        $$('.drop-before,.drop-after', el).forEach((x) => x.classList.remove('drop-before', 'drop-after'));
        const over = e.target.closest('.card');
        if (over && over.dataset.meta !== state.drag.id) { const r = over.getBoundingClientRect(); over.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after'); }
      });
      zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drop-target'); });
      zone.addEventListener('drop', (e) => {
        if (!state.drag) return;
        e.preventDefault();
        const lane = zone.closest('.lane').dataset.lane;
        const over = e.target.closest('.card');
        let before = null;
        if (over && over.dataset.meta !== state.drag.id) { const r = over.getBoundingClientRect(); before = e.clientX < r.left + r.width / 2 ? over.dataset.meta : nextCardId(over); }
        dropMeta(state.drag, lane, before);
      });
    });
    $$('[data-add]', el).forEach((b) => { b.onclick = () => openMetaForm({ sub: b.dataset.add }); });
    $$('[data-wish]', el).forEach((b) => { b.onclick = () => { const d = S.D.desejos.find((x) => x.id === b.dataset.wish); openMetaForm({ sub: d.subs[0], wish: d }); }; });
  }
}

function nextCardId(card) { let n = card.nextElementSibling; while (n && !n.classList.contains('card')) n = n.nextElementSibling; return n ? n.dataset.meta : null; }

function dropMeta(drag, lane, beforeId) {
  const card = document.querySelector(`.card[data-meta="${drag.id}"]`); if (card) card._justDragged = true;
  if (lane !== drag.sub) {
    if (!lane) { toast('Para tirar a meta de um subsistema, edite a meta (a remoção precisa aparecer no plano).'); return; }
    // ordem local já no destino; a relação vai para o plano de escrita
    const ids = metasIn(lane).map((x) => x.id).filter((x) => x !== drag.id);
    const idx = beforeId ? ids.indexOf(beforeId) : ids.length;
    ids.splice(idx < 0 ? ids.length : idx, 0, drag.id); order.set(lane, ids);
    requestWrite('meta.mover', { meta: drag.id, de: drag.sub || null, para: lane });
    return;
  }
  const ids = metasIn(lane).map((x) => x.id).filter((x) => x !== drag.id);
  const idx = beforeId ? ids.indexOf(beforeId) : ids.length;
  ids.splice(idx < 0 ? ids.length : idx, 0, drag.id);
  order.set(lane, ids);
  renderLanes();
  toast('Ordem salva neste navegador (a ordem não vai para o Notion)');
}

function onCard(id) {
  if (state.linking && state.linking !== id) {
    const from = state.linking; state.linking = null; renderLanes();
    requestWrite('dependencia.criar', { bloqueada: id, bloqueadora: from });
    return;
  }
  openDrawer(id);
}

// ---------- legenda ----------
function renderLegend() {
  const { D } = S;
  const pd = Object.entries(D.areas).filter(([, a]) => !a.ext);
  const ext = Object.entries(D.areas).find(([, a]) => a.ext);
  $('#legend').innerHTML = pd.map(([k, a]) => `<span class="sw"><i style="background:var(--${k})"></i>${esc(a.nome)}</span>`).join('')
    + (ext ? `<span class="sw"><i style="background:var(--${ext[0]})"></i>outras diretorias</span>` : '')
    + '<span class="sw">★ ligada ao objetivo ativo</span>'
    + (canWrite() ? '<span class="sw">⠿ arraste o card para reordenar ou mudar de subsistema · arraste da bolinha até outra meta para ligar dependência (bloqueadora → bloqueada)</span>' : '')
    + '<span class="sw"><i style="background:var(--crit);height:2px"></i>bloqueio fora da sprint / não iniciado</span><span class="k">cor do card = equipe (Área da meta)</span>';
}

// ---------- alertas ----------
function renderAlerts() {
  const A = computeAlerts(S.D, S.I, { sprint: S.D.sprint, obj: state.obj });
  $('#al-n').textContent = `${A.length} itens`;
  $('#alerts').innerHTML = A.map((a) => `<div class="al ${a.sev}"><span class="sev">${a.sev === 'crit' ? 'crítico' : a.sev === 'warn' ? 'atenção' : 'info'}</span><div>${esc(a.t)}<span class="rule">regra: ${esc(a.r)}</span></div></div>`).join('') || '<div class="empty">Nenhum alerta.</div>';
}

// ---------- gravações da sessão ----------
export function renderLog() {
  $('#log-n').textContent = writeLog.length ? `${writeLog.length} nesta sessão` : '';
  $('#log').innerHTML = writeLog.slice().reverse().map((l) => `<div class="fi"><span class="k" style="${l.ok ? '' : 'background:var(--crit-bg);color:var(--crit)'}">${l.ok ? 'gravado' : 'falhou'}</span><div>${esc(l.titulo)}<span class="rule" style="display:block;font-family:var(--mono);font-size:10px;color:var(--muted)">${esc(l.quando)}${l.links.length ? ' · ' : ''}${l.links.slice(0, 3).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">página ${i + 1} ↗</a>`).join(' ')}${l.erro ? ` · ${esc(l.erro)}` : ''}</span></div><span></span></div>`).join('')
    || `<div class="empty">${canWrite() ? 'Nenhuma gravação ainda nesta sessão.' : 'Somente leitura: você pode navegar, mas não gravar no Notion.'}</div>`;
}

export function renderBoard() {
  renderObjbar(); renderOKR(); renderLanes(); renderLegend(); renderAlerts(); renderLog();
}

// divisor redimensionável (preferência local)
export function initDivider() {
  const d = $('#divider'); let drag = false;
  if (state.left) document.documentElement.style.setProperty('--left', `${state.left}px`);
  d.onpointerdown = (e) => { drag = true; d.setPointerCapture(e.pointerId); };
  d.onpointerup = () => { drag = false; persist(); };
  d.onpointermove = (e) => {
    if (!drag) return;
    const R = $('#split').getBoundingClientRect();
    const w = Math.min(Math.max(320, e.clientX - R.left), Math.max(360, R.width - 420));
    document.documentElement.style.setProperty('--left', `${w}px`);
    requestAnimationFrame(drawArrows);
  };
}
