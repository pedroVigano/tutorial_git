// Aba Operacional (reunião operacional de cada equipe — Lucid págs. 4–5 e 11): por equipe, as metas da sprint
// com o objetivo e os KRs ligados, e o quadro de tarefas de cada meta. Ao lado: revisões esperando o
// responsável do subsistema, tarefas bloqueadas e tarefas por pessoa. Tudo o que se mexe vai para o rascunho.
import { S, canWrite } from './store.js';
import { state, persist } from './state.js';
import { esc, $, $$ } from './util.js';
import { hooks } from './hooks.js';
import { krStatus } from './rules.js';
import { krCor, krChartHTML, bindKrChart } from './kchart.js';
import { openDrawer } from './drawer.js';
import { quadroHTML, ligarQuadros, tarefasDaSprint, cardTarefa, pessoa, COLUNAS, openRegistroForm } from './tarefas.js';

const stcls = (s) => (s === 'Concluído' ? 'st-good' : s === 'Em andamento' ? 'st-run' : s === 'Abortado' ? 'st-crit' : 'st-neutral');

function equipeChips(D) {
  const pd = Object.entries(D.areas).filter(([k, a]) => !a.ext && k !== 'pd');
  const eq = state.equipeOp || 'todas';
  return `<div class="op-eq" role="group" aria-label="Equipe">${[['todas', 'Todas de P&D'], ...pd.map(([k, a]) => [k, a.nome])].map(([k, nome]) => `<button type="button" class="chip" data-eq="${esc(k)}" aria-pressed="${eq === k}" style="${k === 'todas' ? '' : `--team:var(--${k})`}">${k === 'todas' ? '' : '<i class="tdot"></i>'}${esc(nome)}</button>`).join('')}</div>`;
}

function krsDaMeta(m) {
  const { I, D } = S;
  const objs = (m.okrs || []).map((o) => I.objById[o]).filter(Boolean);
  if (!objs.length) return '<span class="hint">sem objetivo</span>';
  return objs.map((o) => {
    const krs = I.krsOf(o.id);
    return `<details class="op-okr"><summary><span class="pill">${esc(o.label)}</span> ${esc(o.curto)} · ${krs.length} KRs</summary>${krs.map((kr, i) => {
      const st = krStatus(I, kr);
      return `<div class="op-kr" style="--kr:${krCor(i)}"><div class="op-kr-h"><span class="krb"><i></i>${esc(kr.label)}</span><span class="t">${esc(kr.titulo)}</span><span class="pill ${st.cls}">${esc(st.txt)}</span></div>${krChartHTML(`op:${m.id}:${kr.id}`, I.kpisOf(kr.id), { xs: I.sprintNums, cur: D.sprint, kr: krCor(i), width: 420, edit: canWrite() })}</div>`;
    }).join('')}</details>`;
  }).join('');
}

export function renderOperacional() {
  const { D, I } = S;
  const el = $('#page-operacional');
  const eq = state.equipeOp || 'todas';
  const daEquipe = (area) => (eq === 'todas' ? !D.areas[area]?.ext : area === eq);
  const ts = tarefasDaSprint();
  const metas = D.metas.filter((m) => m.sprints.includes(D.sprint) && !m.fora && daEquipe(m.area));
  const idsMetas = new Set(metas.map((m) => m.id));
  const tsEq = ts.filter((t) => t.metas.some((id) => idsMetas.has(id)) || (t.area ? daEquipe(t.area) : false));
  const semMeta = tsEq.filter((t) => !t.metas.length || !t.metas.some((id) => I.metaById[id]));
  // painéis: revisão (aguarda o responsável do subsistema), bloqueadas, por pessoa
  const emRev = tsEq.filter((t) => t.status === 'Em Revisão');
  const bloq = tsEq.filter((t) => t.status === 'Bloqueada');
  const porPessoa = new Map();
  tsEq.forEach((t) => (t.resp_ids?.length ? t.resp_ids : ['—']).forEach((id) => {
    const l = porPessoa.get(id) || Object.fromEntries(COLUNAS.map((c) => [c, 0])); l[t.status] = (l[t.status] || 0) + 1; porPessoa.set(id, l);
  }));
  const revisor = (t) => [...new Set((t.subs || []).map((s) => I.byId[s]?.resp).filter(Boolean))].join(', ') || '⚠ subsistema sem responsável';
  const ordem = { 'Em andamento': 0, 'Não iniciada': 1, Concluído: 2, Abortado: 3 };

  el.innerHTML = `<div class="page-h"><h2>Operacional · sprint #${esc(D.sprint)}</h2><p>Reunião operacional da equipe: metas da sprint com o objetivo e os KRs, e as tarefas de cada meta por status. Arraste a tarefa entre colunas para mudar o status; tudo vai para o 📝 Rascunho e só grava depois da revisão.</p></div>
  ${equipeChips(D)}
  <div class="op-resumo">${COLUNAS.map((c) => `<span class="pill">${esc(c)}: <b>${tsEq.filter((t) => t.status === c).length}</b></span>`).join('')}<span class="pill">${metas.length} metas</span></div>
  <div class="op-grid"><div class="op-metas">
    ${metas.sort((a, b) => (ordem[a.status] ?? 9) - (ordem[b.status] ?? 9)).map((m) => {
      const tsm = tsEq.filter((t) => t.metas.includes(m.id));
      const caminho = (m.subs || []).map((s) => I.pathOf(s).slice(1).join(' › ')).join(' · ');
      return `<section class="op-meta${m.pend ? ' pend' : ''}" style="--team:var(--${m.area})" data-op-meta="${esc(m.id)}">
        <header><span class="team">${esc(I.AREA_NAME(m.area))}</span><button type="button" class="op-mt" data-abrir="${esc(m.id)}">${esc(m.titulo)}</button><span class="pill ${stcls(m.status)}">${esc(m.status)}</span>${m.pend ? '<span class="tag pe">rascunho</span>' : ''}<span class="op-acoes">${canWrite() ? `<button type="button" class="linkbtn" data-reg-meta="${esc(m.id)}" title="Registrar discussão na página da meta">🗣 registrar</button>` : ''}${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">↗</a>` : ''}</span></header>
        ${caminho ? `<div class="op-path">${esc(caminho)}</div>` : ''}
        <div class="op-okrs">${krsDaMeta(m)}</div>
        ${quadroHTML(tsm, { chave: m.id, meta: m.id, mostrarMeta: false })}
      </section>`;
    }).join('') || '<p class="empty">Nenhuma meta desta equipe na sprint.</p>'}
    ${semMeta.length ? `<section class="op-meta sem"><header><span class="team">⚠</span><span class="op-mt">Tarefas sem meta da sprint</span><span class="hint">regra do modelo: a tarefa liga a uma meta</span></header>${quadroHTML(semMeta, { chave: 'sem', add: false })}</section>` : ''}
  </div>
  <aside class="op-lado">
    <section class="panel"><h3>🔎 Em revisão <span class="n">${emRev.length}</span></h3><p class="hint">Esperando o responsável do subsistema (gate: resultados verificados + documentação + requisito).</p>${emRev.map((t) => `<div class="op-item">${cardTarefa(t)}<div class="hint">revisa: ${esc(revisor(t))}</div></div>`).join('') || '<p class="empty">Nada em revisão.</p>'}</section>
    <section class="panel"><h3>⛔ Bloqueadas <span class="n">${bloq.length}</span></h3>${bloq.map((t) => cardTarefa(t)).join('') || '<p class="empty">Nada bloqueado.</p>'}</section>
    <section class="panel"><h3>👥 Por pessoa</h3><div class="twrap"><table class="t op-pp"><tr><th>Pessoa</th>${COLUNAS.map((c) => `<th title="${esc(c)}">${esc(c.split(' ').map((x) => x[0]).join(''))}</th>`).join('')}</tr>${[...porPessoa.entries()].map(([id, l]) => `<tr><td>${esc(id === '—' ? 'sem responsável' : pessoa(id)?.nome || id.slice(0, 6))}</td>${COLUNAS.map((c) => `<td class="mono">${l[c] || ''}</td>`).join('')}</tr>`).join('')}</table></div></section>
  </aside></div>`;

  $$('[data-eq]', el).forEach((b) => { b.onclick = () => { state.equipeOp = b.dataset.eq; persist(); hooks.render(); }; });
  $$('[data-abrir]', el).forEach((b) => { b.onclick = () => openDrawer(b.dataset.abrir); });
  $$('[data-reg-meta]', el).forEach((b) => { b.onclick = () => { const m = I.metaById[b.dataset.regMeta]; openRegistroForm({ base: 'metas', id: m.id, titulo: m.titulo }); }; });
  $$('[data-kpi]', el).forEach((b) => { b.onclick = async () => { const { openKpiForm } = await import('./kpi-form.js'); openKpiForm(D.kpis.find((k) => k.id === b.dataset.kpi)); }; });
  bindKrChart(el, { onToggle: renderOperacional });
  ligarQuadros(el);
}
