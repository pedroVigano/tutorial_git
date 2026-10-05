// Revisão do rascunho, como um pull request: à esquerda as alterações ("commits") — incluir/excluir,
// autor, comentários, descartar; à direita o diff por página do Notion ("arquivos"), com o valor atual lido
// do Notion agora (− atual / + novo). "Gravar no Notion" grava só os itens incluídos, num plano único.
import * as api from './api.js';
import { S, canWrite } from './store.js';
import { state } from './state.js';
import { esc, toast, $ } from './util.js';
import { hooks, writeLog } from './hooks.js';
import { paraLote } from './changeset.js';
import { itensDeFontes, mudarRascunho, fonte, atualizarBotao, stageChange } from './rascunho.js';
import { reuniao as reuniaoAtual } from './gravacao.js';

const excluidosFonte = new Set(); // itens de outras abas desmarcados nesta revisão
let plano = null; let pedido = 0;
const el = () => $('#review');
const cell = (v) => esc(v == null || v === '' ? '—' : v);

export const revisaoAberta = () => !el().hidden;

function itensAtuais() {
  return [
    ...(S.rascunho || []),
    ...itensDeFontes().map((x) => ({ ...x, incluir: !excluidosFonte.has(x.id), deFonte: true })),
  ];
}

export async function abrirRevisao() {
  if (!canWrite()) { toast('Somente leitura: você não está na lista de quem grava no Notion.'); return; }
  state.busy = true;
  el().hidden = false;
  document.body.classList.add('revisando');
  await planejar();
}

export function fecharRevisao() {
  el().hidden = true;
  document.body.classList.remove('revisando');
  state.busy = false;
  hooks.render();
}

async function planejar() {
  const meu = ++pedido;
  const itens = itensAtuais();
  const lote = paraLote(itens);
  render(itens, null, lote.length ? 'Lendo os valores atuais no Notion…' : null);
  if (!lote.length) { plano = null; return; }
  try {
    const p = await api.plan('lote', { itens: lote }, { sprint: state.sprint, tri: state.tri });
    if (meu !== pedido) return; // a seleção mudou durante a leitura
    plano = p;
    render(itens, p);
  } catch (e) {
    if (meu !== pedido) return;
    plano = null;
    render(itens, null, null, `Não foi possível montar o plano: ${e.message}`);
  }
}

// ---------- desenho ----------
function itemHTML(x, info, idx) {
  const autor = x.origem === 'ia' ? '<span class="rv-autor ia">IA</span>' : `<span class="rv-autor" title="${esc(x.autor || '')}">${esc((x.autor || 'você').split('@')[0])}</span>`;
  const st = info?.bloqueios?.length ? `<span class="rv-st bloq" title="${esc(info.bloqueios.join(' · '))}">✗ bloqueado</span>`
    : info?.avisos?.length ? `<span class="rv-st aviso" title="${esc(info.avisos.join(' · '))}">⚠ ${info.avisos.length}</span>` : '';
  const coments = (x.comentarios || []).map((c) => `<li><b>${esc((c.autor || '').split('@')[0])}</b> <small>${esc(c.quando || '')}</small><div>${esc(c.texto)}</div></li>`).join('');
  return `<li class="rv-item${x.incluir === false ? ' fora' : ''}" data-item="${esc(x.id)}">
    <label class="rv-inc"><input type="checkbox" data-inc="${esc(x.id)}" ${x.incluir === false ? '' : 'checked'}><span class="rv-n">#${idx + 1}</span></label>
    <div class="rv-it"><div class="rv-tt">${esc(info?.titulo || x.titulo)}</div><div class="rv-meta">${autor}${x.deFonte ? `<span class="rv-fonte">${esc(x.fonte)}</span>` : ''}${st}${info ? `<span class="rv-ops">${info.n_ops} op.</span>` : ''}</div>
      ${x.sugestao?.justificativa ? `<div class="rv-sug">💡 ${esc(x.sugestao.justificativa)}${x.sugestao.trecho ? `<blockquote>${esc(x.sugestao.trecho)}</blockquote>` : ''}</div>` : ''}
      ${x.sugestaoEdit ? `<div class="rv-sug edit">✨ <b>Sugestão da IA:</b> ${esc(x.sugestaoEdit.justificativa)}<div class="rv-sug-d">${Object.entries(x.sugestaoEdit.dados).map(([k, v]) => `<code>${esc(k)}</code> → ${esc(Array.isArray(v) ? v.join(', ') : v)}`).join('<br>')}</div>${x.sugestaoEdit.trecho ? `<blockquote>${esc(x.sugestaoEdit.trecho)}</blockquote>` : ''}<div class="btnrow"><button type="button" class="btn small primary" data-aplicar="${esc(x.id)}">Aplicar</button><button type="button" class="btn small" data-dispensar="${esc(x.id)}">Dispensar</button></div></div>` : ''}
      <details class="rv-com"${(x.comentarios || []).length ? ' open' : ''}><summary>💬 ${(x.comentarios || []).length || ''} comentário${(x.comentarios || []).length === 1 ? '' : 's'}</summary><ul>${coments}</ul>${x.deFonte ? '' : `<div class="rv-com-novo"><textarea rows="2" data-com="${esc(x.id)}" placeholder="Comentar (fica no rascunho)…"></textarea><button type="button" class="btn small" data-com-add="${esc(x.id)}">Comentar</button></div>`}</details>
    </div>
    ${x.deFonte ? '' : `<button type="button" class="rv-desc" data-desc="${esc(x.id)}" title="Descartar do rascunho">✕</button>`}</li>`;
}

function arquivosHTML(p, ordem) {
  const grupos = new Map();
  p.linhas.forEach((l) => {
    const k = `${l.base}|${l.pagina?.id || l.pagina?.titulo || '?'}`;
    if (!grupos.has(k)) grupos.set(k, { base: l.base, pagina: l.pagina, linhas: [] });
    grupos.get(k).linhas.push(l);
  });
  return [...grupos.values()].map((g) => {
    const comPasso = g.linhas.some((l) => l.passo);
    const nova = !g.pagina?.url;
    return `<section class="rv-arq"><header><span class="rv-base">${esc(g.base)}</span>${g.pagina?.url ? `<a href="${esc(g.pagina.url)}" target="_blank" rel="noopener">${esc(g.pagina.titulo)} ↗</a>` : `<i>${esc(g.pagina?.titulo || '(nova)')}</i>`}${nova ? '<span class="rv-novo">página nova</span>' : ''}<span class="rv-cnt">${g.linhas.length} campo(s)</span></header>
    <div class="twrap plan-t"><table class="t"><tr>${comPasso ? '<th>Passo</th>' : ''}<th>Campo</th><th>Atual</th><th>Novo</th><th></th></tr>${g.linhas.map((l) => `<tr class="${l.remocao ? 'rem' : ''}" data-de="${esc(l.item || '')}">${comPasso ? `<td class="mono">${esc(l.passo || '')}</td>` : ''}<td class="mono">${esc(l.campo)}</td><td class="del${/^\(/.test(String(l.atual ?? '')) ? ' neutro' : ''}">${l.atual === '' ? '' : cell(l.atual)}</td><td class="ins"><b>${cell(l.novo)}</b></td><td class="rv-ref">${l.item && ordem.has(l.item) ? `#${ordem.get(l.item) + 1}` : ''}</td></tr>`).join('')}</table></div></section>`;
  }).join('');
}

function render(itens, p, carregando = null, erro = null) {
  const info = new Map((p?.itens || []).map((i) => [i.id, i]));
  const ordem = new Map(itens.map((x, i) => [x.id, i]));
  const inc = itens.filter((x) => x.incluir !== false);
  const paginas = p ? new Set(p.linhas.map((l) => `${l.base}|${l.pagina?.id || l.pagina?.titulo}`)).size : 0;
  const pode = p && p.planId && !p.bloqueios.length;
  el().innerHTML = `<div class="rv-top"><div><span class="eyebrow">Rascunho · sprint #${esc(S.base?.sprint ?? '')}</span><h2>Revisão antes de gravar no Notion</h2><p class="hint">Como um pull request: confira cada alteração (valor atual lido do Notion agora → valor novo), comente, desmarque o que não vai e grave. Nada é apagado: "apagar" meta é status Abortado; remoção de ligação aparece em vermelho.</p></div>
    <div class="btnrow"><button type="button" class="btn" id="rv-ia" ${itens.length ? '' : 'disabled'} title="O Gemini revisa o rascunho como um revisor de PR: títulos, critérios, regras do modelo, o que a transcrição pede e ainda não está aqui">✨ Aprimorar com IA</button><button type="button" class="btn" id="rv-descartar" ${(S.rascunho || []).length ? '' : 'disabled'}>Descartar rascunho</button><button type="button" class="btn" id="rv-fechar">Fechar</button><button type="button" class="btn primary" id="rv-gravar" ${pode ? '' : 'disabled'}>Gravar no Notion${p ? ` (${inc.length} alteraç${inc.length === 1 ? 'ão' : 'ões'} · ${paginas} página${paginas === 1 ? '' : 's'} · ${p.n_operacoes} op.)` : ''}</button></div></div>
  ${p?.avisos?.length ? `<ul class="plan-avisos">${p.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
  ${p?.bloqueios?.length ? `<ul class="plan-bloq">${p.bloqueios.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
  ${erro ? `<p class="plan-bloq">${esc(erro)}</p>` : ''}
  <div class="plan-prog" id="rv-prog" hidden><div class="bar"><i id="rv-bar" style="width:0"></i></div><ol class="plan-log" id="rv-log"></ol><div class="btnrow" id="rv-end"></div></div>
  <div class="rv-grid"><aside class="rv-lista"><h3>Alterações <span class="n">${inc.length}/${itens.length}</span></h3>${itens.length ? `<ol>${itens.map((x, i) => itemHTML(x, info.get(x.id), i)).join('')}</ol>` : '<p class="empty">Rascunho vazio. As ações do dashboard (meta nova, editar, mover, dependência, medição, rollover, Trimestral) entram aqui.</p>'}</aside>
  <div class="rv-arqs rv-plan">${carregando ? `<p class="hint">${esc(carregando)}</p>` : p ? (p.linhas.length ? arquivosHTML(p, ordem) : '<p class="empty">Nenhuma mudança no Notion com os itens marcados.</p>') : ''}</div></div>`;
  ligar(itens);
}

function ligar(itens) {
  const root = el();
  root.querySelector('#rv-fechar').onclick = fecharRevisao;
  root.querySelector('#rv-descartar').onclick = () => {
    if (!window.confirm('Descartar todas as alterações do rascunho desta sprint? (o rascunho da Trimestral fica na aba dela)')) return;
    mudarRascunho(() => []); planejar();
  };
  root.querySelectorAll('[data-inc]').forEach((cb) => {
    cb.onchange = () => {
      const id = cb.dataset.inc; const x = itens.find((y) => y.id === id);
      if (x?.deFonte) { if (cb.checked) excluidosFonte.delete(id); else excluidosFonte.add(id); } else mudarRascunho((l) => l.map((y) => (y.id === id ? { ...y, incluir: cb.checked } : y)));
      planejar();
    };
  });
  root.querySelector('#rv-ia').onclick = () => aprimorar(itens);
  root.querySelectorAll('[data-aplicar]').forEach((b) => {
    b.onclick = () => {
      mudarRascunho((l) => l.map((y) => (y.id === b.dataset.aplicar ? { ...y, dados: { ...y.dados, ...y.sugestaoEdit.dados }, sugestaoEdit: null, comentarios: [...(y.comentarios || []), { autor: 'IA (Gemini)', texto: `Sugestão aplicada: ${y.sugestaoEdit.justificativa}`, quando: agora() }] } : y)));
      planejar();
    };
  });
  root.querySelectorAll('[data-dispensar]').forEach((b) => { b.onclick = () => { mudarRascunho((l) => l.map((y) => (y.id === b.dataset.dispensar ? { ...y, sugestaoEdit: null } : y))); render(itensAtuais(), plano); }; });
  root.querySelectorAll('[data-desc]').forEach((b) => { b.onclick = () => { mudarRascunho((l) => l.filter((y) => y.id !== b.dataset.desc)); planejar(); }; });
  root.querySelectorAll('[data-com-add]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.comAdd; const ta = root.querySelector(`textarea[data-com="${CSS.escape(id)}"]`);
      const texto = ta.value.trim(); if (!texto) return;
      const c = { autor: S.meta?.email || '', texto, quando: agora() };
      mudarRascunho((l) => l.map((y) => (y.id === id ? { ...y, comentarios: [...(y.comentarios || []), c] } : y)));
      render(itensAtuais(), plano);
    };
  });
  // destacar as linhas de um item ao passar o mouse na lista
  root.querySelectorAll('.rv-item').forEach((li) => {
    li.onmouseenter = () => root.querySelectorAll(`tr[data-de="${CSS.escape(li.dataset.item)}"]`).forEach((tr) => tr.classList.add('hl'));
    li.onmouseleave = () => root.querySelectorAll('tr.hl').forEach((tr) => tr.classList.remove('hl'));
  });
  const g = root.querySelector('#rv-gravar');
  if (g && !g.disabled) g.onclick = () => gravar(itens);
}

const agora = () => new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// "Aprimorar com IA": sugestões de edição por item, ações que faltam (entram desmarcadas) e comentários.
async function aprimorar(itens) {
  const b = el().querySelector('#rv-ia'); b.disabled = true; b.textContent = '✨ Revisando…';
  try {
    const r = await api.ia('aprimorar', { itens: itens.map(({ id, acao, dados, titulo }) => ({ id, acao, dados, titulo })), transcricao: reuniaoAtual.texto || '', sprint: state.sprint, tri: state.tri });
    let n = 0;
    for (const s of r.sugestoes) {
      if (s.tipo === 'editar') { mudarRascunho((l) => l.map((y) => (y.id === s.item ? { ...y, sugestaoEdit: { dados: s.dados, justificativa: s.justificativa, trecho: s.trecho } } : y))); n += 1; }
      else if (s.tipo === 'comentario' && s.item) { mudarRascunho((l) => l.map((y) => (y.id === s.item ? { ...y, comentarios: [...(y.comentarios || []), { autor: 'IA (Gemini)', texto: s.justificativa, quando: agora() }] } : y))); n += 1; }
      else if (s.tipo === 'nova') { if (stageChange(s.acao, s.dados, { silencioso: true, origem: 'ia', incluir: false, titulo: s.titulo, sugestao: { justificativa: s.justificativa, trecho: s.trecho } })) n += 1; }
    }
    toast(n ? `IA: ${n} sugestão(ões) — confira nos itens (as ações novas entram desmarcadas).` : 'IA: nada a sugerir.', 4000);
  } catch (e) {
    toast(`IA: ${e.message}`, 6000);
  }
  planejar();
}

async function gravar(itens) {
  const p = plano; if (!p?.planId) return;
  const root = el();
  root.querySelector('#rv-gravar').disabled = true;
  root.querySelector('#rv-descartar').disabled = true;
  const prog = root.querySelector('#rv-prog'); prog.hidden = false;
  const bar = root.querySelector('#rv-bar'); const log = root.querySelector('#rv-log');
  let fim;
  try {
    fim = await api.exec(p.planId, (ev) => {
      if (ev.tipo !== 'passo') return;
      bar.style.width = `${Math.round(((ev.i + 1) / ev.n) * 100)}%`;
      log.insertAdjacentHTML('beforeend', `<li class="${ev.ok ? '' : 'err'}">${ev.ok ? (ev.skip ? '•' : '✓') : '✗'} ${esc(ev.ok ? ev.texto : ev.erro)}${ev.url ? ` · <a href="${esc(ev.url)}" target="_blank" rel="noopener">abrir ↗</a>` : ''}</li>`);
      log.scrollTop = log.scrollHeight;
    });
  } catch (err) {
    fim = { ok: false, erro: { mensagem: err.message }, links: [], feitos: 0 };
  }
  // itens gravados por inteiro saem do rascunho; o que falhou (ou não chegou a rodar) fica
  const opItens = p.opItens || [];
  const parou = fim.ok ? Infinity : (fim.erro?.i ?? 0);
  const incluidos = paraLote(itens).map((x) => x.id);
  const feitos = new Set(incluidos.filter((id) => opItens.every((it, i) => it !== id || i < parou)));
  mudarRascunho((l) => l.filter((x) => !feitos.has(x.id)));
  itens.filter((x) => x.deFonte && feitos.has(x.id)).forEach((x) => fonte(x.fonte)?.aoGravar?.(true));
  excluidosFonte.clear();
  writeLog.push({
    quando: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    titulo: p.titulo, ok: fim.ok, links: fim.links || [], erro: fim.erro?.mensagem || null,
  });
  atualizarBotao();
  const end = root.querySelector('#rv-end');
  end.innerHTML = fim.ok
    ? `<span class="plan-ok">✓ Gravado no Notion (${fim.feitos}/${fim.total}). O rascunho ficou ${(S.rascunho || []).length ? `com ${(S.rascunho || []).length} item(ns) não incluído(s)` : 'vazio'}.</span><button type="button" class="btn primary" id="rv-fim">Fechar e atualizar</button>`
    : `<span class="plan-err">✗ Parou: ${esc(fim.erro?.mensagem || 'erro')} ${fim.erro?.conflito ? '— alguém mudou este item no Notion; atualize e revise de novo.' : ''} ${fim.feitos ? `(${fim.feitos} passo(s) gravado(s) — refazer não duplica; ${feitos.size} item(ns) completos saíram do rascunho)` : ''}</span><button type="button" class="btn" id="rv-fim">Fechar e atualizar</button>`;
  root.querySelector('#rv-fim').onclick = async () => { fecharRevisao(); await hooks.reload(true); };
  root.querySelector('#rv-fim').focus();
}
