// "📝 Documentar com IA": o Gemini lê a página do subsistema e as tarefas recentes dele (com os registros de
// reunião) e redige o acréscimo para "6. Desenvolvimento". Entra no rascunho como item da IA, para a revisão.
import * as api from './api.js';
import { S } from './store.js';
import { state } from './state.js';
import { toast } from './util.js';
import { stageChange } from './rascunho.js';
import { abrirRevisao } from './review.js';

export async function documentarComIA(id, botao) {
  const n = S.I.byId[id]; if (!n) return;
  if (botao) { botao.disabled = true; botao.textContent = '…'; }
  try {
    const d = await api.ia('documentar', { subsistema: id, sprint: state.sprint, tri: state.tri });
    const ok = stageChange('pagina.documentar', { pagina: id, titulo: n.nome, situacao: d.situacao, decisoes: d.decisoes, desafios: d.desafios, falta: d.falta, verificacao: d.verificacao, fontes: d.fontes }, {
      silencioso: true, origem: 'ia', incluir: true, titulo: `Documentar "${n.nome}" (IA)`,
      sugestao: { justificativa: `Redigido pela IA a partir da página e de ${d.fontes.length} tarefa(s): ${d.fontes.slice(0, 4).join(' · ')}` },
    });
    if (ok) { toast(`Documentação de "${n.nome}" sugerida no rascunho — confira o texto na revisão.`, 4000); abrirRevisao(); }
  } catch (e) {
    toast(`IA: ${e.message}`, 6000);
  } finally {
    if (botao) { botao.disabled = false; botao.textContent = '📝'; }
  }
}
