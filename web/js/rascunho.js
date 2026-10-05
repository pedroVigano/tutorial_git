// Rascunho de alterações (no navegador de quem edita, por sprint). Toda ação do dashboard entra aqui —
// nada é gravado na hora. O botão "Rascunho · N" do cabeçalho abre a Revisão (review.js), que grava tudo
// num plano único depois da conferência.
import { S, recalc, canWrite } from './store.js';
import { stage, StageError } from './changeset.js';
import { store, toast, $ } from './util.js';
import { hooks } from './hooks.js';

const KEY = 'gt-rascunho';
let sprintN = null;

// Outras abas com rascunho próprio (ex.: Trimestral) entram na mesma revisão como itens "de fonte".
// fonte: { itens: () => [item], aoGravar: (ok) => void }
const fontes = new Map();
export function registrarFonte(nome, fonte) { fontes.set(nome, fonte); atualizarBotao(); }
export const itensDeFontes = () => [...fontes.entries()].flatMap(([nome, f]) => (f.itens() || []).map((x) => ({ ...x, fonte: nome })));
export const fonte = (nome) => fontes.get(nome);

export function carregar(n) {
  if (n === sprintN && S.rascunho) return;
  sprintN = n;
  S.rascunho = store.get(KEY, {})[n] || [];
}
function salvar() {
  const o = store.get(KEY, {});
  if (S.rascunho.length) o[sprintN] = S.rascunho; else delete o[sprintN];
  store.set(KEY, o);
}

export const total = () => (S.rascunho || []).length + itensDeFontes().length;

export function atualizarBotao() {
  const b = $('#rascunho-btn'); if (!b) return;
  const n = total();
  b.hidden = !canWrite() && !n;
  b.innerHTML = `📝 Rascunho${n ? ` <b>${n}</b>` : ''}`;
  b.classList.toggle('tem', n > 0);
  b.title = n ? `${n} alteração(ões) esperando revisão — nada foi gravado no Notion ainda` : 'Rascunho vazio: as ações do dashboard entram aqui antes de gravar no Notion';
}

// Títulos legíveis dos itens (o servidor devolve o título definitivo na revisão).
function tituloDe(acao, d) {
  const meta = (id) => S.I?.metaById[id]?.titulo || 'meta';
  const curto = (t) => (t.length > 60 ? `${t.slice(0, 58)}…` : t);
  switch (acao) {
    case 'meta.criar': return `Criar meta "${curto(d.titulo || '')}"`;
    case 'meta.editar': return `Editar "${curto(meta(d.meta))}"`;
    case 'meta.mover': return `Mover "${curto(meta(d.meta))}" para ${S.I?.byId[d.para]?.nome || 'outra lane'}`;
    case 'meta.status': return `Status de "${curto(meta(d.meta))}" → ${d.status}`;
    case 'meta.proximaSprint': return `"${curto(meta(d.meta))}" → sprint #${Number(d.sprint) + 1}`;
    case 'dependencia.criar': return `"${curto(meta(d.bloqueada))}" bloqueada por "${curto(meta(d.bloqueadora))}"`;
    case 'dependencia.remover': return `Remover dependência de "${curto(meta(d.bloqueada))}"`;
    case 'kpi.medir': return `Medição: ${curto(S.D?.kpis.find((k) => k.id === d.kpi)?.titulo || 'KPI')} — #${d.sprint}`;
    case 'rollover': return `Rollover #${d.sprint} → #${Number(d.sprint) + 1}`;
    case 'reuniao.criar': return `Ata: ${d.titulo || 'reunião'}`;
    case 'pagina.registro': return `Registrar discussão em "${curto(d.titulo || 'página')}"`;
    case 'pagina.documentar': return `Documentar "${curto(d.titulo || 'subsistema')}" (IA)`;
    default: return acao;
  }
}

// Põe uma ação no rascunho (consolidando com o que já está lá). Devolve true se entrou.
export function stageChange(acao, dados, { titulo, silencioso = false, origem = 'manual', incluir, sugestao } = {}) {
  if (!canWrite()) { toast('Somente leitura: você não está na lista de quem grava no Notion.'); return false; }
  try {
    S.rascunho = stage(S.rascunho || [], { acao, dados, titulo: titulo || tituloDe(acao, dados), autor: origem === 'ia' ? 'IA (Gemini)' : (S.meta?.email || null), origem, ...(incluir != null ? { incluir } : {}), ...(sugestao ? { sugestao } : {}) });
  } catch (e) {
    if (e instanceof StageError) { toast(e.message, 4000); return false; }
    throw e;
  }
  salvar(); recalc(); atualizarBotao(); hooks.render();
  if (!silencioso) toast(`No rascunho (${total()}) — nada gravado ainda. Revise e grave pelo botão "📝 Rascunho".`, 3200);
  return true;
}

// Edição direta da lista (revisão: incluir/excluir, comentar, descartar).
export function mudarRascunho(f) {
  S.rascunho = f(S.rascunho || []);
  salvar(); recalc(); atualizarBotao();
}
