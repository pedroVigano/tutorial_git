// Detalhe da meta (gaveta lateral) — portado do mock; as ações agora geram plano de escrita.
import { S, canWrite } from './store.js';
import { state } from './state.js';
import { esc, toast, $ } from './util.js';
import { hooks } from './hooks.js';
import { requestWrite } from './plan-modal.js';
import { openMetaForm } from './meta-form.js';
import { openModal, closeModal } from './modal.js';

export const closeDrawer = () => $('#drawer').classList.remove('open');

export function openDrawer(id) {
  const { D, I } = S;
  const m = I.metaById[id]; if (!m) return;
  const a = D.areas[m.area] || { nome: m.area };
  const w = canWrite();
  const bloqueando = D.metas.filter((x) => (x.bloq || []).includes(m.id));
  const body = $('#drawer-body');
  body.innerHTML = `<span class="eyebrow">Meta da sprint</span><h3>${esc(m.titulo)}</h3>
  <dl class="kv"><dt>Equipe</dt><dd><span style="color:var(--${m.area});font-weight:700">${esc(a.nome)}</span>${(m.areas || []).length > 1 ? ` <span class="pill st-warn">+${m.areas.length - 1} área</span>` : ''}</dd>
  <dt>Status</dt><dd>${esc(m.status)}</dd>
  <dt>Sprints</dt><dd class="mono">${(m.sprints || []).map((s) => `#${s}`).join(' → ') || '—'}</dd>
  <dt>Objetivos</dt><dd>${(m.okrs || []).map((o) => `${esc(I.objById[o]?.icone || '')} ${I.objLabel(o)} · ${esc(I.objById[o]?.curto || '')}`).join('<br>') || '<span style="color:var(--crit)">nenhum</span>'}${(m.okrs_extra || []).map((t) => `<br><span style="color:var(--warn)">${esc(t)}</span>`).join('')}</dd>
  <dt>Subsistemas</dt><dd>${(m.subs || []).map((s) => esc(I.pathOf(s).join(' › '))).join('<br>') || '<span style="color:var(--crit)">nenhum</span>'}</dd>
  <dt>Bloqueada por</dt><dd>${(m.bloq || []).map((b) => esc(I.metaById[b]?.titulo || b)).join('<br>') || '—'}</dd>
  <dt>Bloqueando</dt><dd>${bloqueando.map((x) => esc(x.titulo)).join('<br>') || '—'}</dd>
  ${m.tarefas ? `<dt>Tarefas</dt><dd class="mono">${Object.entries(m.tarefas).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}</dd>` : ''}</dl>
  <div class="btnrow">${w ? '<button class="btn primary" id="d-edit">✎ Editar</button>' : ''}${m.url ? `<a class="btn" href="${esc(m.url)}" target="_blank" rel="noopener">Notion ↗</a>` : ''}</div>
  ${w ? `<div class="btnrow" style="margin-top:8px"><button class="btn small" id="d-link">⛓ Ligar dependência por clique</button><button class="btn small" id="d-roll">→ Próxima sprint</button>${m.status !== 'Abortado' ? '<button class="btn small" id="d-abort" style="color:var(--crit)">Abortar</button>' : ''}</div>
  <p class="hint" style="margin-top:12px">Cada ação mostra o plano de escrita antes de gravar no Notion. Nada é apagado: "apagar" uma meta é marcá-la como Abortado.</p>` : '<p class="hint" style="margin-top:12px">Somente leitura.</p>'}`;
  $('#drawer').classList.add('open');
  if (!w) return;
  body.querySelector('#d-edit').onclick = () => { closeDrawer(); openMetaForm({ edit: m }); };
  body.querySelector('#d-link').onclick = () => {
    state.linking = m.id; closeDrawer(); hooks.render();
    toast(`Agora clique na meta que fica bloqueada por "${m.titulo.slice(0, 40)}…" (Esc cancela)`, 4000);
  };
  body.querySelector('#d-roll').onclick = () => { closeDrawer(); askNextSprint(m); };
  const ab = body.querySelector('#d-abort');
  if (ab) ab.onclick = () => { closeDrawer(); requestWrite('meta.status', { meta: m.id, status: 'Abortado' }); };
}

function askNextSprint(m) {
  const n = S.D.sprint;
  const b = openModal(`<h3>Levar para a sprint #${n + 1}</h3><p class="hint" style="margin:0">"${esc(m.titulo)}" — a meta continua ligada às sprints anteriores; o motivo vai para o Histórico de sprints da página.</p>
    <label>Motivo<textarea id="f-motivo" rows="2" required placeholder="ex.: aguardando peça do fornecedor"></textarea></label>
    <div class="btnrow"><button class="btn primary" type="submit">Montar plano</button><button class="btn" type="button" id="f-cancel">Cancelar</button></div>`, {
    onSubmit: () => {
      const motivo = b.querySelector('#f-motivo').value.trim(); if (!motivo) return;
      requestWrite('meta.proximaSprint', { meta: m.id, sprint: n, motivo });
    },
  });
  b.querySelector('#f-cancel').onclick = closeModal;
  setTimeout(() => b.querySelector('#f-motivo')?.focus(), 50);
}
