// Quadro de tarefas (abas Operacional e Eu): colunas por status, cards arrastáveis entre colunas (vira
// "tarefa.status" no rascunho), formulário de tarefa nova/edição e "registrar discussão" na página de um item
// (seção "🗣️ Registro de reuniões", formato da skill gestao-sprint-notion). Nada é gravado na hora.
import { S, canWrite } from './store.js';
import { state } from './state.js';
import { esc, dm, $, $$ } from './util.js';
import { openModal, closeModal } from './modal.js';
import { stageChange } from './rascunho.js';

export const COLUNAS = ['A Fazer', 'Em Andamento', 'Em Revisão', 'Concluída', 'Bloqueada'];
const PRIOS = ['P0 - Finalizar', 'P1 - Avançar', 'P2 - Se Possível'];
const prioCls = (p) => (p ? `p${p[1]}` : '');
export const pessoa = (id) => S.D.pessoas?.find((p) => p.id === id);
const iniciais = (nome) => String(nome || '?').replace(/^Responsável\s+/, '').split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();

// Tarefas da sprint mostrada (ligadas à sprint ou a uma meta dela), sem as abortadas.
export function tarefasDaSprint() {
  const { D } = S;
  const metasS = new Set(D.metas.filter((m) => m.sprints.includes(D.sprint) && !m.fora).map((m) => m.id));
  return (D.tarefas || []).filter((t) => t.status !== 'Abortada' && (t.sprints.includes(D.sprint) || t.metas.some((id) => metasS.has(id))));
}

export function cardTarefa(t, { meta = true } = {}) {
  const { I } = S;
  const resp = (t.resp_ids || []).map((id) => pessoa(id)).filter(Boolean);
  const m = meta && t.metas[0] ? I.metaById[t.metas[0]] : null;
  const atrasada = t.prazo && t.prazo < new Date().toISOString().slice(0, 10) && t.status !== 'Concluída';
  const w = canWrite();
  return `<div class="tcard${t.pend ? ' pend' : ''}" data-tarefa="${esc(t.id)}" ${w ? 'draggable="true"' : ''} title="${esc(t.titulo)}">
    <div class="tt">${esc(t.titulo)}</div>
    ${m ? `<div class="tm" title="${esc(m.titulo)}">🏁 ${esc(m.titulo)}</div>` : ''}
    <div class="tr">${resp.map((p) => `<span class="av" title="${esc(p.nome || '')}">${esc(iniciais(p.nome))}</span>`).join('') || (t.resp ? `<span class="tresp">${esc(t.resp)}</span>` : '<span class="tresp none">sem responsável</span>')}
      ${t.prioridade ? `<span class="tprio ${prioCls(t.prioridade)}" title="${esc(t.prioridade)}">${esc(t.prioridade.slice(0, 2))}</span>` : ''}
      ${t.prazo ? `<span class="tprazo${atrasada ? ' atrasada' : ''}" title="Prazo">⏱ ${dm(t.prazo)}</span>` : ''}
      ${t.pend ? '<span class="tag pe">rascunho</span>' : ''}
      <span class="ta">${w ? `<button type="button" data-t-edit="${esc(t.id)}" title="Editar">✎</button><button type="button" data-t-reg="${esc(t.id)}" title="Registrar discussão na página da tarefa">🗣</button>` : ''}${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener" title="Abrir no Notion">↗</a>` : ''}</span></div></div>`;
}

// Quadro por status. `chave` identifica o quadro (para o "+ tarefa" saber a meta).
export function quadroHTML(ts, { chave = '', meta = null, mostrarMeta = true, add = true } = {}) {
  return `<div class="kanban" data-quadro="${esc(chave)}">${COLUNAS.map((c) => {
    const col = ts.filter((t) => t.status === c);
    return `<div class="kcol" data-status="${esc(c)}"><div class="kcol-h"><span>${esc(c)}</span><span class="n">${col.length}</span></div><div class="kcol-b">${col.map((t) => cardTarefa(t, { meta: mostrarMeta })).join('')}${c === 'A Fazer' && add && canWrite() ? `<button type="button" class="add" data-t-novo="${esc(meta || '')}" title="Nova tarefa">+</button>` : ''}</div></div>`;
  }).join('')}</div>`;
}

let arrastando = null;
export function ligarQuadros(root) {
  $$('[data-t-edit]', root).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); openTarefaForm({ tarefa: S.D.tarefas.find((t) => t.id === b.dataset.tEdit) }); }; });
  $$('[data-t-reg]', root).forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); const t = S.D.tarefas.find((x) => x.id === b.dataset.tReg); openRegistroForm({ base: 'tarefas', id: t.id, titulo: t.titulo }); };
  });
  $$('[data-t-novo]', root).forEach((b) => { b.onclick = () => openTarefaForm({ meta: b.dataset.tNovo || null }); });
  if (!canWrite()) return;
  $$('.tcard', root).forEach((c) => {
    c.addEventListener('dragstart', (e) => { arrastando = c.dataset.tarefa; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', arrastando); } catch { /* ignora */ } });
    c.addEventListener('dragend', () => { arrastando = null; c.classList.remove('dragging'); $$('.kcol.drop-target', root).forEach((x) => x.classList.remove('drop-target')); });
  });
  $$('.kcol', root).forEach((col) => {
    col.addEventListener('dragover', (e) => { if (!arrastando) return; e.preventDefault(); col.classList.add('drop-target'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop-target'); });
    col.addEventListener('drop', (e) => {
      if (!arrastando) return;
      e.preventDefault();
      const t = S.D.tarefas.find((x) => x.id === arrastando); const novo = col.dataset.status;
      if (!t || t.status === novo) return;
      const de = S.base.tarefas.find((x) => x.id === t.id)?.status || t.status;
      stageChange('tarefa.status', { tarefa: t.id, status: novo, de }, { titulo: `Tarefa "${t.titulo.slice(0, 50)}" → ${novo}` });
    });
  });
}

// ---------- formulários ----------
const pessoasOpts = (sel) => (S.D.pessoas || []).map((p) => `<option value="${esc(p.id)}" ${sel.includes(p.id) ? 'selected' : ''}>${esc(p.nome || p.email || p.id.slice(0, 6))}</option>`).join('');
function subsOpts(sel) {
  const { D, I } = S;
  return D.tree.filter((n) => n.pai && !n.sem_acesso).map((n) => `<option value="${esc(n.id)}" ${sel.includes(n.id) ? 'selected' : ''}>${esc(I.pathOf(n.id).join(' › '))}</option>`).join('');
}

export function openTarefaForm({ tarefa = null, meta = null } = {}) {
  const { D, I } = S;
  const t = tarefa;
  const m = I.metaById[meta || t?.metas?.[0]] || null;
  const metas = D.metas.filter((x) => x.sprints.includes(D.sprint) && !x.fora && x.status !== 'Abortado');
  const subs0 = t ? (t.subs || []) : (m?.subs || []);
  const resp0 = t ? (t.resp_ids || []) : (S.meta?.eu ? [S.meta.eu.id] : []);
  const b = openModal(`<h3>${t ? 'Editar tarefa' : `Nova tarefa da sprint #${D.sprint}`}</h3>
    <label>Tarefa<input id="tf-t" required value="${esc(t?.titulo || '')}"></label>
    ${t ? '' : `<label>Meta da sprint<select id="tf-m"><option value="">— sem meta —</option>${metas.map((x) => `<option value="${esc(x.id)}" ${x.id === m?.id ? 'selected' : ''}>${esc(x.titulo)}</option>`).join('')}</select></label>`}
    <div class="two"><label>Responsável(is) <span class="hint">(Ctrl/Cmd para vários)</span><select id="tf-r" multiple size="5">${pessoasOpts(resp0)}</select></label>
    <label>Subsistema(s)<select id="tf-s" multiple size="5">${subsOpts(subs0)}</select></label></div>
    <div class="two"><label>Prazo<input id="tf-p" type="date" value="${esc(t?.prazo || D.sprints.find((s) => s.n === D.sprint)?.fim || '')}"></label>
    <label>Prioridade<select id="tf-pr"><option value="">—</option>${PRIOS.map((p) => `<option ${t?.prioridade === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label></div>
    <div class="btnrow"><button class="btn primary" type="submit">Pôr no rascunho</button><button class="btn" type="button" id="tf-cancel">Cancelar</button></div>`, {
    onSubmit: () => {
      const titulo = b.querySelector('#tf-t').value.trim(); if (!titulo) return;
      const resp = [...b.querySelector('#tf-r').selectedOptions].map((o) => o.value);
      const subs = [...b.querySelector('#tf-s').selectedOptions].map((o) => o.value);
      const prazo = b.querySelector('#tf-p').value || null; const prioridade = b.querySelector('#tf-pr').value || null;
      const respNomes = resp.map((id) => pessoa(id)?.nome).filter(Boolean).join(', ') || null;
      if (!t) {
        const metaId = b.querySelector('#tf-m').value || null;
        const area = (metaId && I.metaById[metaId]?.area) || (state.equipeOp && state.equipeOp !== 'todas' ? state.equipeOp : null);
        if (stageChange('tarefa.criar', { titulo, meta: metaId, subs, resp, respNomes, prazo, prioridade, area, sprint: D.sprint, status: 'A Fazer' }, { titulo: `Criar tarefa "${titulo.slice(0, 60)}"` })) closeModal();
        return;
      }
      const dados = { tarefa: t.id };
      if (titulo !== t.titulo) dados.titulo = titulo;
      if (JSON.stringify([...resp].sort()) !== JSON.stringify([...(t.resp_ids || [])].sort())) { dados.resp = resp; dados.respNomes = respNomes; }
      if (prazo !== (t.prazo || null)) dados.prazo = prazo;
      if (prioridade !== (t.prioridade || null)) dados.prioridade = prioridade;
      if (JSON.stringify([...subs].sort()) !== JSON.stringify([...(t.subs || [])].sort())) dados.subs = subs;
      if (Object.keys(dados).length === 1) { closeModal(); return; }
      if (stageChange('tarefa.editar', dados, { titulo: `Editar tarefa "${t.titulo.slice(0, 60)}"` })) closeModal();
    },
  });
  b.querySelector('#tf-cancel').onclick = closeModal;
  setTimeout(() => b.querySelector('#tf-t')?.focus(), 50);
}

const TIPO_DA_ABA = { trimestral: 'Trimestral', board: 'Tática', operacional: 'Operacional', eu: 'Operacional', rollover: 'Tática' };
// Registrar discussão na página de um item (meta, tarefa, OKR, sprint, projeto/subsistema).
export function openRegistroForm({ base, id, titulo }) {
  const tipo = TIPO_DA_ABA[state.page] || 'Tática';
  const b = openModal(`<h3>Registrar discussão</h3><p class="hint" style="margin:0">Em "${esc(titulo)}" — entra na seção "🗣️ Registro de reuniões" da página, como uma entrada nova (nada é apagado). Vai para o rascunho.</p>
    <div class="two"><label>Reunião<select id="rg-tipo">${['Trimestral', 'Tática', 'Operacional', 'Acompanhamento', 'Retrospectiva (por projeto)'].map((t) => `<option ${t === tipo ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label>Data<input id="rg-data" type="date" value="${new Date().toISOString().slice(0, 10)}"></label></div>
    <label>Participantes <span class="hint">(Ctrl/Cmd para vários)</span><select id="rg-p" multiple size="4">${pessoasOpts(S.meta?.eu ? [S.meta.eu.id] : [])}</select></label>
    <label>Discussão<textarea id="rg-d" rows="3" required placeholder="2–5 linhas"></textarea></label>
    <label>Decisões<textarea id="rg-dec" rows="2" placeholder="ou deixe em branco: “nenhuma”"></textarea></label>
    <div class="btnrow"><button class="btn primary" type="submit">Pôr no rascunho</button><button class="btn" type="button" id="rg-cancel">Cancelar</button></div>`, {
    onSubmit: () => {
      const discussao = b.querySelector('#rg-d').value.trim(); if (!discussao) return;
      const participantes = [...b.querySelector('#rg-p').selectedOptions].map((o) => o.textContent);
      const dados = { base, pagina: id, titulo, tipo: b.querySelector('#rg-tipo').value, data: b.querySelector('#rg-data').value, participantes, discussao, decisoes: b.querySelector('#rg-dec').value.trim() };
      if (stageChange('pagina.registro', dados, { titulo: `Registrar discussão em "${titulo.slice(0, 50)}"` })) closeModal();
    },
  });
  b.querySelector('#rg-cancel').onclick = closeModal;
  setTimeout(() => b.querySelector('#rg-d')?.focus(), 50);
}
