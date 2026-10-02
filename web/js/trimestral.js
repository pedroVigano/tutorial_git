// Página Trimestral (só leitura): revisão dos OKRs de P&D de um trimestre e rascunho do seguinte.
// Nada é gravado no Notion: as decisões viram um pedido para o Claude executar após conferência humana.
import * as api from './api.js';
import { S, buildIndex } from './store.js';
import { state } from './state.js';
import { esc, fmt, dm, copy, download, store, quarterShift, $, $$ } from './util.js';
import { kpiLast, kpiStatus, krStatus, objStatus, coverage } from './rules.js';
import { spark, scoreHTML } from './board.js';

export const STATUS_FINAL = ['Atingido', 'Atingido Parcialmente', 'Não atingido', 'Abortado'];

// Status pela regra → status final do Notion (só quando não há ambiguidade).
export function finalPelaRegra(st) {
  if (st.txt === 'Atingido') return 'Atingido';
  if (st.txt === 'Parcial') return 'Atingido Parcialmente';
  if (st.txt === 'Não atingido') return 'Não atingido';
  return null;
}

const pg = { rev: null, plan: null, data: {}, loading: null, err: null, pending: false, closed: new Set(), pedidoAberto: false, sideTop: 0 };
const triLabel = (t) => (t || '').replace(' - ', '-');

// ---------- seleção (fica neste navegador) ----------
const selKey = () => `gt-trimestral:${pg.rev}>${pg.plan}`;
const emptySel = () => ({ dup: {}, dest: {}, fim: {}, nota: {}, novos: '' });
let sel = emptySel();
const loadSel = () => { sel = { ...emptySel(), ...store.get(selKey(), {}) }; };
const saveSel = () => store.set(selKey(), sel);

// ---------- dados ----------
async function fetchTri(tri, force) {
  if (!force && S.D && S.D.trimestre.id === tri) return { D: S.D, I: S.I };
  const r = await api.getSnapshot({ sprint: state.sprint, tri, force });
  return { D: r.D, I: buildIndex(r.D) };
}

function ensure(force = false) {
  const stamp = S.D?.lido_em_iso;
  const ok = (t) => pg.data[t] && pg.data[t].stamp === stamp;
  if (pg.loading || (!force && ok(pg.rev) && ok(pg.plan))) return;
  const want = [pg.rev, pg.plan];
  pg.loading = (async () => {
    try {
      const [rev, plan] = await Promise.all(want.map((t) => fetchTri(t, force)));
      pg.data[want[0]] = { ...rev, stamp }; pg.data[want[1]] = { ...plan, stamp };
      pg.err = null;
    } catch (e) { pg.err = e.message; }
    finally {
      pg.loading = null;
      if (pg.rev !== want[0] || pg.plan !== want[1]) ensure(); // a seleção mudou durante a carga
      paint();
    }
  })();
}

export function renderTrimestral() {
  if (!S.D) return;
  if (!pg.rev) { pg.rev = S.D.trimestre.id; pg.plan = quarterShift(pg.rev, 1); loadSel(); }
  ensure();
  paint();
}

// ---------- modelo da revisão ----------
// Itens do trimestre revisado já presentes no planejado (OKR legado com os dois trimestres no multi-select).
function model() {
  const R = pg.data[pg.rev]; const P = pg.data[pg.plan];
  if (!R || !P) return null;
  const planIds = new Set([...P.D.objetivos, ...P.D.krs, ...P.D.kpis].map((x) => x.id));
  const noPlan = (x) => planIds.has(x.id);
  // Marcado com o trimestre planejado no Notion, mas sem objetivo pai nele (não aparece na árvore planejada).
  const orfao = (x) => !planIds.has(x.id) && (x.trimestres || []).includes(pg.plan);
  const norm = (t) => String(t || '').replace(/\s*\(\d+\)\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const revIds = new Set([...R.D.objetivos, ...R.D.krs, ...R.D.kpis].map((x) => x.id));
  const porTitulo = new Map([...P.D.objetivos, ...P.D.krs, ...P.D.kpis].filter((x) => !revIds.has(x.id)).map((x) => [norm(x.titulo), x]));
  const medPlan = new Map(P.D.kpis.flatMap((k) => Object.values(k.medicoes || {}).map((m) => [m, k])));
  const copiaDe = (x) => {
    if (planIds.has(x.id)) return null;
    const viaMed = Object.values(x.medicoes || {}).map((m) => medPlan.get(m)).find((k) => k && k.id !== x.id);
    return viaMed || porTitulo.get(norm(x.titulo)) || null;
  };
  const regra = {};
  R.D.objetivos.forEach((o) => { regra[o.id] = objStatus(R.I, o); });
  R.D.krs.forEach((k) => { regra[k.id] = krStatus(R.I, k); });
  R.D.kpis.forEach((k) => { regra[k.id] = kpiStatus(k); });
  return { R, P, noPlan, orfao, copiaDe, regra };
}

const finalOf = (id) => sel.fim[id] || null;

// Destino de um objetivo marcado "dentro de…" (perdido = escolhido mas não está mais no trimestre planejado).
function destOf(M, o) {
  const d = sel.dup[o.id] || '';
  if (!d.startsWith('dest:')) return { dest: null, perdido: null };
  const dest = M.P.I.objById[d.slice(5)];
  return dest ? { dest, perdido: null } : { dest: null, perdido: d.slice(5) };
}
// Páginas novas: objetivos copiados + KRs + KPIs marcados.
const nCopias = (M) => M.R.D.objetivos.filter((o) => sel.dup[o.id] && !destOf(M, o).dest).length
  + M.R.D.krs.filter((k) => sel.dup[k.id]).length + M.R.D.kpis.filter((k) => sel.dup[k.id]).length;
const triFim = (t) => { const m = /^(\d{4}) - (\d)$/.exec(t || ''); return m ? new Date(Date.UTC(+m[1], +m[2] * 3, 0)).toISOString().slice(0, 10).split('-').reverse().join('/') : '—'; };

// ---------- interação: duplicar marca os ancestrais; desmarcar leva os descendentes ----------
function setDupObj(M, o, v) {
  if (v) sel.dup[o.id] = v; else delete sel.dup[o.id];
  if (!v) M.R.I.krsOf(o.id).forEach((kr) => setDupKr(M, kr, false));
}
function setDupKr(M, kr, v) {
  if (v) { sel.dup[kr.id] = true; if (!sel.dup[kr.obj]) sel.dup[kr.obj] = 'novo'; } else delete sel.dup[kr.id];
  if (!v) M.R.I.kpisOf(kr.id).forEach((k) => { delete sel.dup[k.id]; });
}
function setDupKpi(M, k, v) {
  if (v) { sel.dup[k.id] = true; setDupKr(M, M.R.I.krById[k.kr], true); } else delete sel.dup[k.id];
}

// ---------- desenho ----------
function pills(M, x) {
  const st = M.regra[x.id];
  return `<span class="pill ${st.cls}" title="Status pela regra">${esc(st.txt)}</span><span class="pill" title="Status no Notion">Notion: ${esc(x.status || '—')}</span>${M.noPlan(x) ? `<span class="pill st-run" title="O mesmo item já está marcado com ${esc(pg.plan)} no Notion">já em ${esc(triLabel(pg.plan))}</span>` : ''}${M.copiaDe(x) ? `<span class="pill st-warn" title="Parece já ter cópia em ${esc(pg.plan)}: ${esc(M.copiaDe(x).titulo)}">cópia já em ${esc(triLabel(pg.plan))}? (${esc(M.copiaDe(x).label)})</span>` : ''}${M.orfao(x) ? `<span class="pill st-warn" title="Marcado com ${esc(pg.plan)} no Notion, mas o objetivo pai não está em ${esc(pg.plan)}: não aparece na árvore planejada">marcado ${esc(triLabel(pg.plan))}, sem pai lá</span>` : ''}`;
}

function controls(M, x, nivel) {
  if (state.tv) return '';
  const travado = M.noPlan(x);
  let dup;
  if (nivel === 'obj') {
    const v = sel.dup[x.id] || '';
    const dests = M.P.D.objetivos.filter((o) => o.id !== x.id);
    dup = `<label class="tq-c">Duplicar <select data-dupobj="${x.id}" ${travado ? 'disabled' : ''}><option value="">não</option><option value="novo" ${v === 'novo' ? 'selected' : ''}>como objetivo novo</option>${dests.map((o) => `<option value="dest:${o.id}" ${v === `dest:${o.id}` ? 'selected' : ''}>dentro de ${esc(o.label)} · ${esc(o.curto)}</option>`).join('')}</select></label>`;
  } else {
    dup = `<label class="tq-c"><input type="checkbox" data-dup="${x.id}" data-nivel="${nivel}" ${sel.dup[x.id] ? 'checked' : ''} ${travado ? 'disabled' : ''}> duplicar</label>`;
  }
  const regra = finalPelaRegra(M.regra[x.id]);
  const fim = `<label class="tq-c">Status final <select data-fim="${x.id}"><option value="">${regra ? `não mudar (regra: ${esc(regra)})` : 'não mudar'}</option>${STATUS_FINAL.map((s) => `<option ${sel.fim[x.id] === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>`;
  const nota = `<input class="tq-nota" data-nota="${x.id}" placeholder="ajustes (nova descrição, alvo…)" value="${esc(sel.nota[x.id] || '')}">`;
  return `<div class="tq-ctl">${dup}${fim}${nota}</div>`;
}

function kpiRow(M, k) {
  return `<div class="tq-kpi"><div class="tq-kn"><span class="eyebrow">${esc(k.label)} · KPI</span><div class="t">${esc(k.titulo)} <a href="${esc(k.url)}" target="_blank" rel="noopener">↗</a></div><div class="tq-pills">${pills(M, k)}</div>${controls(M, k, 'kpi')}</div><div>${scoreHTML(k)}</div><div>${spark(k, M.R.I.sprintNums)}</div></div>`;
}

function revisao(M) {
  const { D, I } = M.R;
  if (!D.objetivos.length) return `<div class="empty">Nenhum objetivo de P&amp;D com Trimestre = ${esc(pg.rev)} no Notion.</div>`;
  return D.objetivos.map((o) => {
    const c = coverage(I, o);
    const krs = I.krsOf(o.id).map((kr) => `<details class="kr tq-kr" data-id="${kr.id}" ${pg.closed.has(kr.id) ? '' : 'open'}><summary><div><span class="eyebrow">${esc(kr.label)} · Resultado-Chave${kr.limite ? ` · até ${dm(kr.limite)}` : ''}</span><div class="t">${esc(kr.titulo)} <a href="${esc(kr.url)}" target="_blank" rel="noopener">↗</a></div><div class="tq-pills">${pills(M, kr)}</div></div></summary><div class="body">${controls(M, kr, 'kr')}${I.kpisOf(kr.id).map((k) => kpiRow(M, k)).join('') || '<div class="empty">Sem KPIs cadastrados.</div>'}</div></details>`).join('');
    return `<details class="panel tq-obj" data-id="${o.id}" ${pg.closed.has(o.id) ? '' : 'open'}><summary><span class="ico">${esc(o.icone)}</span><div><span class="eyebrow">${esc(o.label)} · Objetivo · ${I.krsOf(o.id).length} KRs · ${c.n} KPIs · ${c.med} com medição${o.limite ? ` · até ${dm(o.limite)}` : ''}</span><h3>${esc(o.titulo)} <a href="${esc(o.url)}" target="_blank" rel="noopener">↗</a></h3><div class="tq-pills">${pills(M, o)}${o.projetos.map((p) => `<span class="pill">${esc(I.byId[p]?.nome || '?')}</span>`).join('')}</div></div></summary>${controls(M, o, 'obj')}${krs || '<div class="empty">Objetivo sem resultados-chave cadastrados.</div>'}</details>`;
  }).join('');
}

function planejado(M) {
  const { D, I } = M.P;
  if (!D.objetivos.length) return `<div class="empty">Nenhum objetivo de P&amp;D com Trimestre = ${esc(pg.plan)} no Notion.</div>`;
  const revIds = new Set([...M.R.D.objetivos, ...M.R.D.krs, ...M.R.D.kpis].map((x) => x.id));
  const tag = (x) => (revIds.has(x.id) ? ` <span class="pill" title="Mesmo item do trimestre revisado">também ${esc(triLabel(pg.rev))}</span>` : '');
  const alvo = (k) => (k.alvo == null ? '<span class="pill st-warn">⚠ definir alvo</span>' : `<span class="mono">${esc(k.dir || '')} ${fmt(k.alvo)} ${esc(k.unidade || '')}</span>`);
  return `<ul class="tq-tree">${D.objetivos.map((o) => `<li><b>${esc(o.label)}</b> ${esc(o.icone)} <a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.titulo)}</a>${tag(o)}<ul>${I.krsOf(o.id).map((kr) => `<li><span class="mono">${esc(kr.label)}</span> ${esc(kr.titulo)}${tag(kr)}<ul>${I.kpisOf(kr.id).map((k) => `<li><span class="mono">${esc(k.label)}</span> ${esc(k.titulo)} · ${alvo(k)}${tag(k)}</li>`).join('')}</ul></li>`).join('')}</ul></li>`).join('')}</ul>`;
}

function rascunho(M) {
  const { D, I } = M.R;
  const objs = D.objetivos.filter((o) => sel.dup[o.id]);
  if (!objs.length) return '<div class="empty">Nada marcado para duplicar.</div>';
  const nota = (id) => (sel.nota[id] ? ` <i class="tq-n">— ${esc(sel.nota[id])}</i>` : '');
  return `<ul class="tq-tree">${objs.map((o) => {
    const { dest, perdido } = destOf(M, o);
    const head = dest ? `→ dentro de <b>${esc(dest.label)}</b> de ${esc(triLabel(pg.plan))} ${esc(dest.titulo)} <span class="hint">(de ${esc(o.label)})</span>${nota(o.id)}` : `<b>＋ ${esc(o.label)}</b> ${esc(o.titulo)}${perdido ? ' <span class="pill st-warn">destino não está mais no trimestre</span>' : ''}${nota(o.id)}`;
    const krs = I.krsOf(o.id).filter((kr) => sel.dup[kr.id]);
    return `<li>${head}<ul>${krs.map((kr) => `<li>＋ <span class="mono">${esc(kr.label)}</span> ${esc(kr.titulo)}${nota(kr.id)}<ul>${I.kpisOf(kr.id).filter((k) => sel.dup[k.id]).map((k) => `<li>＋ <span class="mono">${esc(k.label)}</span> ${esc(k.titulo)} · ${Object.keys(k.medicoes).length} medições religadas${nota(k.id)}</li>`).join('')}</ul></li>`).join('')}</ul></li>`;
  }).join('')}</ul>`;
}

function resumo(M) {
  const cont = {}; M.R.D.kpis.forEach((k) => { const t = M.regra[k.id].txt; cont[t] = (cont[t] || 0) + 1; });
  const nd = nCopias(M);
  return `<div class="tq-sum"><span><b>${esc(triLabel(pg.rev))}</b>: ${M.R.D.objetivos.length} objetivos · ${M.R.D.krs.length} KRs · ${M.R.D.kpis.length} KPIs</span>${Object.entries(cont).map(([t, n]) => `<span class="pill ${kpiStatus(M.R.D.kpis.find((k) => M.regra[k.id].txt === t)).cls}">${n} ${esc(t)}</span>`).join('')}<span><b>${esc(triLabel(pg.plan))}</b>: ${M.P.D.objetivos.length} objetivos · ${M.P.D.krs.length} KRs · ${M.P.D.kpis.length} KPIs</span><span class="pill st-run">${nd} páginas novas a criar</span></div>`;
}

function seletores() {
  const base = S.D.trimestre.id;
  const revs = [...new Set([-3, -2, -1, 0, 1].map((d) => quarterShift(base, d)).concat(pg.rev))].sort();
  const plans = [1, 2].map((d) => quarterShift(pg.rev, d));
  const opt = (list, v) => list.map((t) => `<option value="${esc(t)}" ${t === v ? 'selected' : ''}>${esc(triLabel(t))}</option>`).join('');
  return `<label class="ctl">Revisar <select id="tq-rev">${opt(revs, pg.rev)}</select></label><label class="ctl">Planejar <select id="tq-plan">${opt(plans, pg.plan)}</select></label>`;
}

function paint() {
  const el = $('#page-trimestral');
  if (!el || el.hidden) return;
  // Não redesenha enquanto alguém digita: espera sair do campo.
  if (el.contains(document.activeElement) && document.activeElement.matches('input:not([type=checkbox]),textarea')) { pg.pending = true; return; }
  pg.pending = false;
  const M = model();
  const head = `<div class="page-h"><h2>Trimestral · OKRs de P&amp;D</h2>${seletores()}<p>Revisão de ${esc(triLabel(pg.rev))} (status pela regra × status no Notion, série dos KPIs por sprint) e rascunho de ${esc(triLabel(pg.plan))}. <b>Só leitura:</b> nada é gravado no Notion por aqui — as decisões viram um pedido para o Claude, que mostra o plano de escrita antes de gravar.</p></div>`;
  if (!M) {
    el.innerHTML = `${head}<div class="panel">${pg.err ? `<div class="banner crit">Não foi possível ler o Notion: ${esc(pg.err)} <button class="btn small" id="tq-retry">Tentar de novo</button></div>` : '<div class="empty">Lendo os OKRs dos dois trimestres no Notion…</div>'}</div>`;
    bindHead(el);
    const r = el.querySelector('#tq-retry'); if (r) r.onclick = () => ensure(true);
    return;
  }
  const scrollY = window.scrollY;
  pg.sideTop = el.querySelector('.tq-side')?.scrollTop ?? pg.sideTop;
  el.innerHTML = `${head}${resumo(M)}<div class="tq-grid"><section class="tq-rev" aria-label="Revisão">${revisao(M)}</section>
  <aside class="tq-side"><div class="panel"><h3>Já em ${esc(triLabel(pg.plan))} <span class="n">no Notion</span></h3>${planejado(M)}</div>
  <div class="panel"><h3>Rascunho: a duplicar para ${esc(triLabel(pg.plan))}</h3><div id="tq-rasc">${rascunho(M)}</div></div>
  ${state.tv ? '' : `<div class="panel"><h3>OKRs novos discutidos</h3><textarea class="big tq-novos" id="tq-novos" placeholder="Um por linha: objetivo, KRs e KPIs (com alvo, unidade e direção), área e projeto…">${esc(sel.novos)}</textarea>
  <div class="btnrow" style="margin-top:8px"><button class="btn primary" id="tq-copy">Copiar pedido</button><button class="btn" id="tq-dl">Baixar .md</button><button class="btn small" id="tq-clear">Limpar seleção</button></div>
  <p class="hint">Depois da reunião: cole o pedido e a transcrição do Granola numa conversa com o Claude. Ele propõe o plano de escrita (base → página → campo → atual → novo) e só grava após "pode gravar".</p>
  <details class="tq-prev" ${pg.pedidoAberto ? 'open' : ''}><summary class="hint">ver o pedido</summary><pre class="prompt" id="tq-pedido"></pre></details></div>`}</aside></div>`;
  window.scrollTo(0, scrollY);
  const side = el.querySelector('.tq-side'); if (side) side.scrollTop = pg.sideTop;
  bindHead(el); bind(el, M); updatePedido(M);
}

function bindHead(el) {
  const rev = el.querySelector('#tq-rev'); const plan = el.querySelector('#tq-plan');
  rev.onchange = () => { pg.rev = rev.value; pg.plan = quarterShift(pg.rev, 1); loadSel(); paint(); ensure(); };
  plan.onchange = () => { pg.plan = plan.value; loadSel(); paint(); ensure(); };
}

function bind(el, M) {
  const refresh = () => { saveSel(); syncChecks(el, M); el.querySelector('#tq-rasc').innerHTML = rascunho(M); updatePedido(M); };
  $$('[data-dupobj]', el).forEach((s) => { s.onchange = () => { setDupObj(M, M.R.I.objById[s.dataset.dupobj], s.value); refresh(); }; });
  $$('[data-dup]', el).forEach((c) => {
    c.onchange = () => {
      const id = c.dataset.dup;
      if (c.dataset.nivel === 'kr') setDupKr(M, M.R.I.krById[id], c.checked);
      else setDupKpi(M, M.R.D.kpis.find((k) => k.id === id), c.checked);
      refresh();
    };
  });
  $$('[data-fim]', el).forEach((s) => { s.onchange = () => { if (s.value) sel.fim[s.dataset.fim] = s.value; else delete sel.fim[s.dataset.fim]; saveSel(); updatePedido(M); }; });
  $$('[data-nota]', el).forEach((i) => { i.oninput = () => { const v = i.value.trim(); if (v) sel.nota[i.dataset.nota] = i.value; else delete sel.nota[i.dataset.nota]; saveSel(); updatePedido(M); }; i.onchange = () => { el.querySelector('#tq-rasc').innerHTML = rascunho(M); }; });
  const nov = el.querySelector('#tq-novos');
  if (nov) nov.oninput = () => { sel.novos = nov.value; saveSel(); updatePedido(M); };
  const cp = el.querySelector('#tq-copy'); if (cp) cp.onclick = () => copy(pedido(M), 'Pedido copiado — cole numa conversa com o Claude junto com a transcrição');
  const dl = el.querySelector('#tq-dl'); if (dl) dl.onclick = () => download(`pedido-trimestral-${triLabel(pg.rev)}-para-${triLabel(pg.plan)}-${new Date().toISOString().slice(0, 10)}.md`, pedido(M), 'text/markdown');
  const cl = el.querySelector('#tq-clear');
  if (cl) cl.onclick = () => { if (confirm('Limpar todas as marcações, status finais, ajustes e OKRs novos desta revisão?')) { sel = emptySel(); saveSel(); paint(); } };
  $$('details[data-id]', el).forEach((d) => { d.ontoggle = () => { if (d.open) pg.closed.delete(d.dataset.id); else pg.closed.add(d.dataset.id); }; });
  const prev = el.querySelector('.tq-prev'); if (prev) prev.ontoggle = () => { pg.pedidoAberto = prev.open; };
  el.onfocusout = () => { if (pg.pending) setTimeout(() => { if (!el.contains(document.activeElement)) paint(); }, 0); };
}

function syncChecks(el, M) {
  $$('[data-dup]', el).forEach((c) => { c.checked = !!sel.dup[c.dataset.dup]; });
  $$('[data-dupobj]', el).forEach((s) => { s.value = sel.dup[s.dataset.dupobj] || ''; });
  const sum = el.querySelector('.tq-sum'); if (sum) sum.outerHTML = resumo(M);
}

function updatePedido(M) {
  const pre = $('#tq-pedido'); if (pre) pre.textContent = pedido(M);
}

// ---------- pedido para o Claude ----------
export function pedido(M) {
  const { D, I } = M.R;
  const hoje = new Date().toLocaleDateString('pt-BR');
  const fimPlan = triFim(pg.plan);
  const area = (keys) => (keys || []).map((k) => D.areas[k]?.nome || k).join(', ') || '—';
  const proj = (ids) => (ids || []).map((p) => I.byId[p]?.nome || p).join(', ') || '—';
  const nota = (id, ind) => (sel.nota[id] ? `\n${ind}Ajustes: ${sel.nota[id].trim()}` : '');
  const ultima = (k) => { const l = kpiLast(k); return l ? `${fmt(l.v)} (#${l.s})` : 'sem medição'; };
  const alvo = (k) => (k.alvo == null ? 'sem alvo' : `alvo ${k.dir || ''} ${fmt(k.alvo)} ${k.unidade || ''}`.trim());
  const avisos = (x, ind) => [
    M.orfao(x) ? `ATENÇÃO: a original já tem Trimestre ${pg.plan} no Notion, mas o pai não está lá` : null,
    M.copiaDe(x) ? `ATENÇÃO: parece já existir cópia em ${pg.plan}: [${M.copiaDe(x).label} de ${pg.plan}] "${M.copiaDe(x).titulo}" (id ${M.copiaDe(x).id}) — confirmar antes de duplicar` : null,
  ].filter(Boolean).map((a) => `\n${ind}${a}`).join('');
  const meds = (k) => Object.entries(k.medicoes).map(([n, id]) => `${id} (#${n})`).join(', ') || 'nenhuma';
  const R = (x) => `${x.label} de ${pg.rev}`;

  const dups = D.objetivos.filter((o) => sel.dup[o.id]).map((o) => {
    const { dest, perdido } = destOf(M, o);
    const krs = I.krsOf(o.id).filter((kr) => sel.dup[kr.id]);
    if (dest && !krs.length) return null;
    const linhaO = dest
      ? `- [${R(o)}] Objetivo · "${o.titulo}" → NÃO duplicar o objetivo; os KRs abaixo vão para dentro de [${dest.label} de ${pg.plan}] "${dest.titulo}" (${dest.url} · id ${dest.id})\n  Original: ${o.url} · id ${o.id}${nota(o.id, '  ')}`
      : `- [${R(o)}] Objetivo · "${o.titulo}" → objetivo NOVO (cópia)${perdido ? `\n  ATENÇÃO: o destino escolhido (id ${perdido}) não está mais em ${pg.plan} — confirmar` : ''}\n  Original: ${o.url} · id ${o.id}\n  Área: ${area(o.areas)} · Projetos: ${proj(o.projetos)} · Data limite da original: ${o.limite || '—'}${avisos(o, '  ')}${nota(o.id, '  ')}`;
    const pai = dest ? `[${dest.label} de ${pg.plan}] (id ${dest.id})` : `a cópia de [${R(o)}]`;
    const linhas = krs.map((kr) => {
      const kpis = I.kpisOf(kr.id).filter((k) => sel.dup[k.id]).map((k) => `    - [${R(k)}] KPI · "${k.titulo}" → cópia sob a cópia de [${R(kr)}]\n      Original: ${k.url} · id ${k.id}\n      ${alvo(k)} · última medição ${ultima(k)} · Data limite da original: ${k.limite || '—'}\n      Medições a religar (acrescentar o KPI novo na relação KPI): ${meds(k)}${avisos(k, '      ')}${nota(k.id, '      ')}`);
      return [`  - [${R(kr)}] Resultado-Chave · "${kr.titulo}" → cópia sob ${pai}\n    Original: ${kr.url} · id ${kr.id} · Data limite da original: ${kr.limite || '—'}${avisos(kr, '    ')}${nota(kr.id, '    ')}`, ...kpis].join('\n');
    });
    return [linhaO, ...linhas].join('\n');
  }).filter(Boolean);

  const itens = D.objetivos.flatMap((o) => [o, ...I.krsOf(o.id).flatMap((kr) => [kr, ...I.kpisOf(kr.id)])]);
  const grau = (x) => (D.objetivos.includes(x) ? 'Objetivo' : D.krs.includes(x) ? 'Resultado-Chave' : 'KPI');
  const comFim = itens.filter((x) => finalOf(x.id));
  const fimLinhas = comFim.map((x) => `| ${x.label} | ${grau(x)} | ${x.titulo.replace(/\|/g, '/')} | ${x.status || '—'} | ${M.regra[x.id].txt} | **${finalOf(x.id)}** | ${x.id} |`);
  const sugestoes = itens.filter((x) => !finalOf(x.id) && finalPelaRegra(M.regra[x.id])).map((x) => `${x.label}: ${finalPelaRegra(M.regra[x.id])}`);
  const notasSoltas = itens.filter((x) => sel.nota[x.id] && !sel.dup[x.id]).map((x) => `- [${R(x)}] ${grau(x)} · "${x.titulo}" (${x.url}): ${sel.nota[x.id].trim()}`);

  return `# Pedido ao Claude — reunião trimestral de P&D
Revisão: ${pg.rev} → Planejamento: ${pg.plan} · reunião em ${hoje}
Gerado pelo dashboard em ${new Date().toLocaleString('pt-BR')} · Notion lido em ${D.lido_em}

## Regras de execução
1. Nada é gravado antes do plano de escrita (base → página → campo → atual → novo) e de um "pode gravar" explícito.
2. Duplicar = páginas NOVAS em 🎯 OKRs Táticos com o mesmo Grau, Trimestre = [${pg.plan}], copiando da original Área, Projetos, Alvo, Unidade e Direção (com os ajustes pedidos) e "item principal" = a cópia do pai (ou o destino indicado). A original não muda, exceto o Status final listado na seção 2.
3. Data Limite das cópias: fim de ${pg.plan} (${fimPlan}), salvo ajuste — confirmar no plano de escrita.
4. KPI duplicado: acrescentar o KPI novo na relação "KPI" de cada medição listada em 📈 Evolução de KPIs (acumulativo — nada é removido). Se a Unidade mudar, avisar antes de religar.
5. Status final: campo Status das páginas de ${pg.rev}, SOMENTE os itens da tabela da seção 2 (decididos na reunião). A sugestão pela regra é só informativa.
6. Itens com "ATENÇÃO": confirmar comigo antes de gravar.
7. Sugestões da transcrição que não estão neste pedido: listar à parte, sem gravar.
8. Registrar a discussão de cada item citado na seção "## 🗣️ Registro de reuniões" da página (### ${hoje} · Trimestral · ⬜ Conferido por —), sem apagar nada.

## 1. Duplicar para ${pg.plan} (${nCopias(M)} páginas novas)
${dups.join('\n') || '(nenhum item marcado)'}

## 2. Status final de ${pg.rev} decidido na reunião (${comFim.length} itens)
| Item | Grau | Título | Status no Notion | Pela regra | Final | id |
|---|---|---|---|---|---|---|
${fimLinhas.join('\n') || '| — | | | | | | |'}

Sugestão pela regra para os demais (informativa, NÃO gravar sem confirmação): ${sugestoes.join('; ') || '—'}

## 3. Ajustes e observações em itens não duplicados
${notasSoltas.join('\n') || '—'}

## 4. OKRs novos discutidos
${sel.novos.trim() || '—'}

## 5. Transcrição (Granola)
(cole aqui)
`;
}
