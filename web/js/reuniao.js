// Painel Reunião (botão "🎙 Reunião" do cabeçalho, em qualquer aba).
// 1. Gravar: o áudio vira transcrição pelo Gemini, trecho a trecho (gravacao.js); ou cole uma transcrição.
// 2. "Gerar ata e sugestões": a IA escreve a ata (linha nova em 👨‍👩‍👦‍👦 Reuniões, com a transcrição), a entrada do
//    "🗣️ Registro de reuniões" em cada página citada e sugestões de mudança — tudo no 📝 Rascunho, para a revisão.
// 3. Sem IA: o prompt para a skill gestao-sprint-notion do Claude continua disponível.
import * as api from './api.js';
import { S, canWrite } from './store.js';
import { state } from './state.js';
import { copy, esc, toast, $ } from './util.js';
import { computeAlerts } from './rules.js';
import { stageChange } from './rascunho.js';
import { abrirRevisao } from './review.js';
import * as gv from './gravacao.js';

const TIPO_DA_ABA = { trimestral: 'Trimestral', board: 'Tática', operacional: 'Operacional', eu: 'Operacional', rollover: 'Tática' };
const NIVEL = { Trimestral: 'Tático', Tática: 'Tático', Operacional: 'Operacional' };

export const reuniaoAberta = () => $('#reuniao-panel').classList.contains('open');
export function openReuniao() {
  renderReuniao();
  $('#reuniao-panel').classList.add('open');
  $('#reuniao-btn').setAttribute('aria-expanded', 'true');
}
export function closeReuniao() {
  $('#reuniao-panel').classList.remove('open');
  $('#reuniao-btn').setAttribute('aria-expanded', 'false');
}

// botão do cabeçalho mostra o tempo enquanto grava (mesmo com o painel fechado)
gv.aoMudar(() => {
  const b = $('#reuniao-btn'); if (!b) return;
  const s = gv.situacao();
  b.classList.toggle('gravando', s.gravando && !s.pausado);
  b.innerHTML = s.gravando ? `${s.pausado ? '⏸' : '<i class="rec"></i>'} ${gv.relogio(s.ms)}` : '🎙 Reunião';
  atualizarGravacao();
});

function atualizarGravacao() {
  const el = $('#reuniao-body'); if (!el?.dataset.ready) return;
  const s = gv.situacao();
  const g = el.querySelector('#gv-ctl');
  // os botões só são refeitos quando o estado muda (o relógio atualiza a cada segundo)
  const chave = `${s.gravando}|${s.pausado}|${canWrite()}`;
  if (g.dataset.chave !== chave) {
    g.dataset.chave = chave;
    g.innerHTML = !s.gravando
      ? `<button type="button" class="btn primary" id="gv-rec" ${canWrite() ? '' : 'disabled title="Só quem grava no Notion usa a IA"'}><i class="rec"></i> Gravar</button>`
      : `${s.pausado ? '<button type="button" class="btn" id="gv-ret">▶ Retomar</button>' : '<button type="button" class="btn" id="gv-pau">⏸ Pausar</button>'}<button type="button" class="btn" id="gv-stop">■ Parar</button>`;
  }
  el.querySelector('#gv-st').textContent = `${gv.relogio(s.ms)} gravado${s.enviados ? ` · ${s.enviados} trecho(s) transcrito(s)` : ''}${s.fila ? ` · ${s.fila} na fila` : ''}${s.falhas ? ` · tentando de novo (${s.falhas})` : ''}`;
  const ta = el.querySelector('#mt-txt');
  if (ta && document.activeElement !== ta && ta.value !== gv.reuniao.texto) { ta.value = gv.reuniao.texto; updatePrompt(); }
  const rec = el.querySelector('#gv-rec'); if (rec) rec.onclick = async () => { try { await gv.iniciar(); } catch (e) { toast(`Não deu para gravar: ${e.message}`, 5000); } };
  const pau = el.querySelector('#gv-pau'); if (pau) pau.onclick = gv.pausar;
  const ret = el.querySelector('#gv-ret'); if (ret) ret.onclick = gv.retomar;
  const stop = el.querySelector('#gv-stop'); if (stop) stop.onclick = gv.parar;
}

export function renderReuniao() {
  const el = $('#reuniao-body');
  if (el.dataset.ready) { updatePrompt(); atualizarGravacao(); return; }
  el.dataset.ready = '1';
  const tipo = TIPO_DA_ABA[state.page] || 'Tática';
  const { D } = S;
  const equipes = D ? Object.entries(D.areas).filter(([k, a]) => !a.ext && k !== 'pd') : [];
  const eqAtual = state.page === 'operacional' && state.equipeOp !== 'todas' ? state.equipeOp : '';
  el.innerHTML = `<div class="page-h"><h2>🎙 Reunião</h2><p>Grave a reunião (o Gemini transcreve trecho a trecho; o áudio não é guardado) ou cole a transcrição. <b>Gerar ata e sugestões</b> põe no 📝 Rascunho a ata (👨‍👩‍👦‍👦 Reuniões), a discussão na página de cada item citado e as mudanças sugeridas — nada é gravado sem a revisão.</p></div>
  <div class="rp-grid"><div class="panel">
    <div class="gv"><span id="gv-ctl"></span><span class="hint" id="gv-st"></span></div>
    <div class="rp-campos"><label class="ctl" style="display:grid">Tipo<select id="mt-tipo">${['Trimestral', 'Tática', 'Operacional'].map((t) => `<option ${t === tipo ? 'selected' : ''}>${t}</option>`).join('')}<option>Acompanhamento</option><option>Retrospectiva (por projeto)</option></select></label>
      <label class="ctl" style="display:grid">Data<input id="mt-data" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label class="ctl" style="display:grid">Equipe<select id="mt-eq"><option value="">P&amp;D (todas)</option>${equipes.map(([k, a]) => `<option value="${esc(k)}" ${k === eqAtual ? 'selected' : ''}>${esc(a.nome)}</option>`).join('')}</select></label>
      <label class="ctl" style="display:grid">Projeto/assunto<input id="mt-quem" placeholder="ex.: Bicudobot Scout"></label></div>
    <label class="ctl" style="display:grid;margin-bottom:6px">Participantes <span class="hint">(Ctrl/Cmd para vários)</span><select id="mt-part" multiple size="4">${(D?.pessoas || []).map((p) => `<option value="${esc(p.id)}" ${p.id === S.meta?.eu?.id ? 'selected' : ''}>${esc(p.nome || p.email || p.id.slice(0, 6))}</option>`).join('')}</select></label>
    <textarea class="big" id="mt-txt" placeholder="Transcrição (preenchida pela gravação) ou notas/transcrição coladas…"></textarea>
    <div class="btnrow" style="margin-top:8px"><button class="btn primary" id="mt-ata" ${canWrite() ? '' : 'disabled'}>✨ Gerar ata e sugestões</button><button class="btn" id="mt-limpar">Limpar transcrição</button><span class="hint" id="mt-ia"></span></div>
  </div>
  <details class="panel rp-claude"><summary><b>Sem IA no servidor:</b> prompt para a skill gestao-sprint-notion do Claude</summary><div class="btnrow" style="margin:8px 0"><button class="btn" id="mt-copy">Copiar prompt</button><span class="hint">O contexto do board vai junto. Cole numa conversa com o Claude que tenha a skill.</span></div><pre class="prompt" id="mt-prev"></pre></details></div>`;
  el.querySelector('#mt-txt').value = gv.reuniao.texto;
  ['mt-tipo', 'mt-data', 'mt-quem', 'mt-eq'].forEach((id) => { el.querySelector(`#${id}`).oninput = updatePrompt; });
  el.querySelector('#mt-txt').oninput = (e) => { gv.reuniao.texto = e.target.value; gv.salvarReuniao(); updatePrompt(); };
  el.querySelector('#mt-copy').onclick = () => copy(el.querySelector('#mt-prev').textContent);
  el.querySelector('#mt-limpar').onclick = () => {
    if (gv.reuniao.texto && !window.confirm('Apagar a transcrição deste navegador? (o que já foi para o rascunho continua lá)')) return;
    gv.limparReuniao(); el.querySelector('#mt-txt').value = ''; updatePrompt();
  };
  el.querySelector('#mt-ata').onclick = gerarAta;
  api.iaInfo().then((i) => { const h = el.querySelector('#mt-ia'); if (h) h.textContent = i.modo === 'off' ? 'IA desligada no servidor' : i.modo === 'fake' ? 'IA em modo demonstração (respostas fixas)' : `Gemini · ${i.modelos.revisao}`; }).catch(() => {});
  atualizarGravacao();
  updatePrompt();
}

async function gerarAta() {
  const el = $('#reuniao-body');
  const transcricao = el.querySelector('#mt-txt').value.trim();
  if (transcricao.length < 20) { toast('Grave ou cole a transcrição primeiro.'); return; }
  if (gv.gravando()) gv.parar();
  const tipo = el.querySelector('#mt-tipo').value; const data = el.querySelector('#mt-data').value;
  const equipe = el.querySelector('#mt-eq').value || null;
  const parts = [...el.querySelector('#mt-part').selectedOptions];
  const b = el.querySelector('#mt-ata'); b.disabled = true; b.textContent = '✨ Gerando…';
  try {
    const r = await api.ia('ata', { transcricao, tipo, equipe, sprint: state.sprint, tri: state.tri });
    const { D } = S;
    const nomeEq = equipe ? D.areas[equipe]?.nome : null;
    const horas = gv.reuniao.ms ? Math.round((gv.reuniao.ms / 3_600_000) * 100) / 100 : null;
    const antes = (S.rascunho || []).length;
    stageChange('reuniao.criar', {
      titulo: r.titulo || `Reunião ${tipo.toLowerCase()} #${D.sprint} — ${data.split('-').reverse().slice(0, 2).join('/')}`,
      data, duracao: horas, nivel: NIVEL[tipo] || 'Tático', areas: [equipe || 'pd'], equipes: nomeEq ? [nomeEq] : [],
      participantes: parts.map((o) => o.value), objetivo: el.querySelector('#mt-quem').value.trim(),
      resumo: r.resumo, decisoes: r.decisoes, proximos: r.proximos, transcricao,
    }, { silencioso: true, titulo: `Ata: ${r.titulo || tipo}` });
    const tmp = S.rascunho[S.rascunho.length - 1]?.dados?.tmp;
    for (const g of r.registros) {
      stageChange('pagina.registro', { ...g, tipo, data, participantes: parts.map((o) => o.textContent), reuniao: tmp }, { silencioso: true, origem: 'ia', titulo: `Registrar discussão em "${g.titulo.slice(0, 50)}"` });
    }
    for (const s of r.sugestoes) {
      stageChange(s.acao, s.dados, { silencioso: true, origem: 'ia', incluir: false, titulo: s.titulo, sugestao: { justificativa: s.justificativa, trecho: s.trecho } });
    }
    toast(`Ata, ${r.registros.length} registro(s) e ${r.sugestoes.length} sugestão(ões) da IA no rascunho (${(S.rascunho || []).length - antes} itens). Sugestões entram desmarcadas — confira na revisão.`, 5000);
    closeReuniao();
    abrirRevisao();
  } catch (e) {
    toast(`IA: ${e.message}`, 6000);
  } finally {
    b.disabled = false; b.textContent = '✨ Gerar ata e sugestões';
  }
}

export function updatePrompt() {
  const { D, I } = S;
  const el = $('#reuniao-body'); if (!el.dataset.ready || !D) return;
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
3. Depois, listar: metas novas sugeridas (título com verbo, equipe única, objetivo, subsistema), dependências sugeridas, medições de KPI mencionadas (valor, unidade, sprint) e requisitos a partir de desejos. Metas, dependências e medições aprovadas podem ser gravadas pelo próprio dashboard.
4. Antes de escrever qualquer coisa, mostrar o plano de escrita (página → texto) e esperar minha confirmação.

${ctx}

## Transcrição
${txt || '(cole aqui)'}`;
}
