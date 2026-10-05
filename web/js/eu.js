// Aba Eu (uso individual — Lucid pág. 11): minhas tarefas da sprint por status, revisões pendentes nos
// subsistemas de que sou responsável, projetos/sistemas/subsistemas de que sou responsável, metas de que
// participo e objetivos de que sou responsável (este último depende do campo "Responsável pelo OKR").
// "Eu" = a pessoa do Notion com o e-mail do login; sem e-mail na integração, escolhe-se em "Ver como".
import { S, canWrite } from './store.js';
import { state, persist } from './state.js';
import { esc, $, $$ } from './util.js';
import { hooks } from './hooks.js';
import { krStatus, objStatus } from './rules.js';
import { krCor, krChartHTML, bindKrChart } from './kchart.js';
import { openDrawer } from './drawer.js';
import { openMetaForm } from './meta-form.js';
import { quadroHTML, ligarQuadros, tarefasDaSprint, cardTarefa, openRegistroForm } from './tarefas.js';
import { documentarComIA } from './ia-doc.js';

const stcls = (s) => (s === 'Concluído' ? 'st-good' : s === 'Em andamento' ? 'st-run' : s === 'Abortado' ? 'st-crit' : 'st-neutral');

export function quemSouEu() {
  const { D } = S;
  if (state.verComo && D.pessoas?.some((p) => p.id === state.verComo)) return D.pessoas.find((p) => p.id === state.verComo);
  return S.meta?.eu || null;
}

export function renderEu() {
  const { D, I } = S;
  const el = $('#page-eu');
  const eu = quemSouEu();
  const opts = (D.pessoas || []).map((p) => `<option value="${esc(p.id)}" ${eu?.id === p.id ? 'selected' : ''}>${esc(p.nome || p.email || p.id.slice(0, 6))}${p.id === S.meta?.eu?.id ? ' (você)' : ''}</option>`).join('');
  const aviso = !S.meta?.eu
    ? `<p class="banner">${S.meta?.emails_pessoas ? `Seu e-mail (${esc(S.meta?.email || '')}) não está entre as pessoas do Notion.` : 'A integração do Notion não lê e-mails de usuários (capacidade "Read user information including email addresses"), então o dashboard não sabe quem você é no Notion.'} Escolha em "Ver como".</p>`
    : '';
  const head = `<div class="page-h"><h2>Eu${eu ? ` · ${esc(eu.nome || '')}` : ''}</h2><label class="ctl">Ver como <select id="eu-ver"><option value="">${S.meta?.eu ? 'eu (login)' : '— escolha —'}</option>${opts}</select></label><p>Uso individual, fora das reuniões: suas tarefas da sprint #${esc(D.sprint)}, as revisões que esperam por você e o que você responde no projeto. Mudanças vão para o 📝 Rascunho.</p></div>${aviso}`;
  if (!eu) { el.innerHTML = head; ligarVer(el); return; }

  const ts = tarefasDaSprint();
  const minhas = ts.filter((t) => (t.resp_ids || []).includes(eu.id));
  const meusNos = D.tree.filter((n) => n.resp_id === eu.id);
  const meusSubs = new Set(meusNos.map((n) => n.id));
  const revisoes = ts.filter((t) => t.status === 'Em Revisão' && (t.subs || []).some((s) => meusSubs.has(s)));
  const metasPart = D.metas.filter((m) => m.sprints.includes(D.sprint) && !m.fora && minhas.some((t) => t.metas.includes(m.id)));
  const metasS = (id) => D.metas.filter((m) => m.sprints.includes(D.sprint) && !m.fora && m.subs.includes(id));
  const desejos = (id) => D.desejos.filter((d) => d.subs.includes(id) && d.status === 'Em análise');

  const okrs = D.campos?.okrResponsavel
    ? (() => {
      const objs = D.objetivos.filter((o) => (o.resp_ids || []).includes(eu.id));
      const krs = D.krs.filter((k) => (k.resp_ids || []).includes(eu.id) || objs.some((o) => o.id === k.obj));
      if (!krs.length) return '<p class="empty">Nenhum OKR com você em "Responsável pelo OKR" neste trimestre.</p>';
      return krs.map((kr) => {
        const o = I.objById[kr.obj]; const i = I.krsOf(kr.obj).findIndex((k) => k.id === kr.id);
        const st = krStatus(I, kr);
        return `<div class="op-kr" style="--kr:${krCor(i)}"><div class="op-kr-h"><span class="krb"><i></i>${esc(kr.label)}</span><span class="t">${esc(kr.titulo)}</span><span class="pill ${st.cls}">${esc(st.txt)}</span><span class="hint">${esc(o?.label || '')} · ${esc(o?.curto || '')} · ${esc(objStatus(I, o).txt)}</span></div>${krChartHTML(`eu:${kr.id}`, I.kpisOf(kr.id), { xs: I.sprintNums, cur: D.sprint, kr: krCor(i), width: 520, edit: canWrite() })}</div>`;
      }).join('');
    })()
    : '<p class="banner">A DEFINIR — o campo <b>Responsável pelo OKR</b> (pessoa) ainda não existe na base 🎯 OKRs Táticos (Fase 4, item 8). Quando for criado, seus objetivos, KRs e KPIs aparecem aqui, com "registrar medição".</p>';

  el.innerHTML = `${head}
  <section class="eu-sec"><h3>✅ Minhas tarefas · sprint #${esc(D.sprint)} <span class="n">${minhas.length}</span></h3>${quadroHTML(minhas, { chave: 'eu' })}</section>
  <div class="eu-grid">
    <section class="panel"><h3>🔎 Revisões esperando você <span class="n">${revisoes.length}</span></h3><p class="hint">Tarefas Em Revisão nos subsistemas de que você é responsável. Gate para Concluída: resultados verificados + documentação do subsistema + requisito atualizado.</p>${revisoes.map((t) => cardTarefa(t)).join('') || '<p class="empty">Nenhuma revisão pendente.</p>'}</section>
    <section class="panel"><h3>🏁 Metas de que participo <span class="n">${metasPart.length}</span></h3>${metasPart.map((m) => `<button type="button" class="eu-meta" data-abrir="${esc(m.id)}" style="--team:var(--${m.area})"><span class="team">${esc(I.AREA_NAME(m.area))}</span><span>${esc(m.titulo)}</span><span class="pill ${stcls(m.status)}">${esc(m.status)}</span></button>`).join('') || '<p class="empty">Nenhuma meta com tarefa sua nesta sprint.</p>'}</section>
  </div>
  <section class="eu-sec"><h3>🤖 Projetos, sistemas e subsistemas de que sou responsável <span class="n">${meusNos.length}</span></h3>
    <div class="eu-nos">${meusNos.map((n) => `<div class="eu-no"><div class="eu-no-h"><span class="tcod">${esc(n.codigo || '')}</span><b>${esc(n.nome)}</b><span class="ttipo">${esc(n.tipo)}</span><span class="pill">${esc(n.status)}</span>${n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener">↗</a>` : ''}</div><div class="hint">${esc(I.pathOf(n.id).slice(0, -1).join(' › '))}</div>
      <div class="eu-no-b"><span>${metasS(n.id).length} meta(s) na #${esc(D.sprint)}</span><span>${desejos(n.id).length} desejo(s) em análise</span>${canWrite() ? `<button type="button" class="linkbtn" data-nova-meta="${esc(n.id)}">+ meta</button><button type="button" class="linkbtn" data-reg-no="${esc(n.id)}">🗣 registrar</button>${n.url ? `<button type="button" class="linkbtn" data-doc="${esc(n.id)}" title="O Gemini redige a atualização de 6. Desenvolvimento a partir das tarefas">📝 documentar com IA</button>` : ''}` : ''}</div></div>`).join('') || '<p class="empty">Você não é responsável por nenhum item da árvore.</p>'}</div></section>
  <section class="eu-sec"><h3>🎯 Objetivos de que sou responsável</h3>${okrs}</section>`;
  ligarVer(el);
  $$('[data-abrir]', el).forEach((b) => { b.onclick = () => openDrawer(b.dataset.abrir); });
  $$('[data-nova-meta]', el).forEach((b) => { b.onclick = () => openMetaForm({ sub: b.dataset.novaMeta }); });
  $$('[data-reg-no]', el).forEach((b) => { b.onclick = () => { const n = I.byId[b.dataset.regNo]; openRegistroForm({ base: 'projetos', id: n.id, titulo: n.nome }); }; });
  $$('[data-doc]', el).forEach((b) => { b.onclick = () => documentarComIA(b.dataset.doc, b); });
  $$('[data-kpi]', el).forEach((b) => { b.onclick = async () => { const { openKpiForm } = await import('./kpi-form.js'); openKpiForm(D.kpis.find((k) => k.id === b.dataset.kpi)); }; });
  bindKrChart(el, { onToggle: renderEu });
  ligarQuadros(el);
}

function ligarVer(el) {
  const s = el.querySelector('#eu-ver');
  if (s) s.onchange = () => { state.verComo = s.value || null; persist(); hooks.render(); };
}
