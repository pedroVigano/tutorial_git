// Página Reunião & IA: monta o pedido para a skill gestao-sprint-notion registrar a discussão na página
// de cada item citado e sugerir metas, tarefas, medições e requisitos — sempre como sugestão para o líder
// conferir. O contexto vem do snapshot ao vivo do Notion.
import { S } from './store.js';
import { state } from './state.js';
import { copy, $ } from './util.js';
import { computeAlerts } from './rules.js';

export function renderReuniao() {
  const el = $('#page-reuniao');
  if (el.dataset.ready) { updatePrompt(); return; }
  el.dataset.ready = '1';
  el.innerHTML = `<div class="page-h"><h2>Reunião &amp; IA</h2><p>Cole a transcrição (ou o resumo do chat). O dashboard monta o pedido para a skill do Claude <b>gestao-sprint-notion</b>: registrar a discussão na página de cada item citado (formato padrão "Registro de reuniões") e sugerir metas, tarefas, medições e requisitos — sempre como sugestão, para o líder conferir.</p></div>
  <div class="grid2"><div class="panel"><div class="two" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:8px"><label class="ctl" style="display:grid">Tipo<select id="mt-tipo"><option>Tática</option><option>Operacional</option><option>Acompanhamento</option><option>Chat</option><option>Retrospectiva (por projeto)</option></select></label><label class="ctl" style="display:grid">Data<input id="mt-data" type="date" value="${new Date().toISOString().slice(0, 10)}"></label><label class="ctl" style="display:grid">Projeto/equipe<input id="mt-quem" placeholder="ex.: Bicudobot Scout"></label></div>
    <textarea class="big" id="mt-txt" placeholder="Transcrição ou notas da reunião…"></textarea>
    <div class="btnrow" style="margin-top:8px"><button class="btn primary" id="mt-copy">Copiar prompt</button><span class="hint">O contexto do board (metas da sprint, objetivos, desejos, alertas) vai junto. Cole numa conversa com o Claude que tenha a skill gestao-sprint-notion.</span></div></div>
  <div class="panel"><h3>Prompt gerado</h3><pre class="prompt" id="mt-prev"></pre></div></div>`;
  ['mt-tipo', 'mt-data', 'mt-quem', 'mt-txt'].forEach((id) => { el.querySelector(`#${id}`).oninput = updatePrompt; });
  el.querySelector('#mt-copy').onclick = () => copy(el.querySelector('#mt-prev').textContent);
  updatePrompt();
}

export function updatePrompt() {
  const { D, I } = S;
  const el = $('#page-reuniao'); if (!el.dataset.ready || !D) return;
  const tipo = el.querySelector('#mt-tipo').value; const data = el.querySelector('#mt-data').value;
  const quem = el.querySelector('#mt-quem').value; const txt = el.querySelector('#mt-txt').value;
  const inS = D.metas.filter((m) => m.sprints.includes(D.sprint) && !m.fora);
  const ctx = `## Contexto (do dashboard, sprint #${D.sprint}, ${D.trimestre.id}, Notion lido em ${D.lido_em})
Objetivos: ${D.objetivos.map((o) => `${o.label} ${o.titulo}`).join(' | ')}
Metas da sprint: ${inS.map((m) => `[${m.url || m.id}] ${m.titulo} (${I.AREA_NAME(m.area)}, ${m.status}${m.okrs.length ? `, ${m.okrs.map(I.objLabel).join('/')}` : ''})`).join(' | ')}
Desejos em análise sem requisito: ${D.desejos.filter((d) => d.status === 'Em análise').map((d) => d.titulo).join(' | ') || '—'}
Alertas por regra: ${computeAlerts(D, I, { sprint: D.sprint, obj: state.obj }).slice(0, 12).map((a) => a.t).join(' | ')}`;
  el.querySelector('#mt-prev').textContent = `# Pedido ao Claude — skill gestao-sprint-notion · registrar reunião
Reunião: ${tipo} · ${data}${quem ? ` · ${quem}` : ''}

## O que fazer
1. Para cada meta, tarefa, objetivo/KR/KPI ou desejo citado na transcrição, escrever UMA entrada na seção "🗣️ Registro de reuniões" da página correspondente no Notion, no formato:
   ### ${data.split('-').reverse().join('/')} · ${tipo} · ⬜ Conferido por —
   - **Discussão:** (2–5 linhas)
   - **Decisões:** (ou "nenhuma")
   - **Sugestões da IA:** \`Status → …\` · \`Bloqueado por → …\` · nova tarefa: "…" (aguardam conferência)
2. Não apagar entradas anteriores. Não mudar nenhum campo — mudanças ficam listadas como sugestão até o líder marcar "Conferido".
3. Depois, listar: metas novas sugeridas (título com verbo, equipe única, objetivo, subsistema), dependências sugeridas, medições de KPI mencionadas (valor, unidade, sprint) e requisitos a partir de desejos. Metas, dependências e medições aprovadas podem ser gravadas pelo próprio dashboard tático.
4. Antes de escrever qualquer coisa, mostrar o plano de escrita (página → texto) e esperar minha confirmação.

${ctx}

## Transcrição
${txt || '(cole aqui)'}`;
}
