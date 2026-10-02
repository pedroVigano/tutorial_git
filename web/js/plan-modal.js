// Plano de escrita: toda gravação passa por aqui.
// 1) pede o plano ao servidor (lê os valores atuais no Notion); 2) mostra base → página → campo → atual → novo,
// avisos e bloqueios; 3) só grava depois de "Gravar no Notion"; 4) mostra o progresso e os links do resultado.
import * as api from './api.js';
import { S } from './store.js';
import { state } from './state.js';
import { esc, toast } from './util.js';
import { openModal, closeModal } from './modal.js';
import { hooks, writeLog } from './hooks.js';

const cell = (v) => esc(v == null || v === '' ? '—' : v);

function planTable(p) {
  const comPasso = p.linhas.some((l) => l.passo);
  const head = `<tr>${comPasso ? '<th>Passo</th>' : ''}<th>Base</th><th>Página</th><th>Campo</th><th>Atual</th><th>Novo</th></tr>`;
  const rows = p.linhas.map((l) => `<tr class="${l.remocao ? 'rem' : ''}">${comPasso ? `<td class="mono">${esc(l.passo || '')}</td>` : ''}<td>${esc(l.base)}</td><td>${l.pagina?.url ? `<a href="${esc(l.pagina.url)}" target="_blank" rel="noopener">${esc(l.pagina.titulo)}</a>` : `<i>${esc(l.pagina?.titulo || '(nova)')}</i>`}</td><td class="mono">${esc(l.campo)}</td><td>${cell(l.atual)}</td><td><b>${cell(l.novo)}</b></td></tr>`).join('');
  return `<div class="twrap plan-t"><table class="t">${head}${rows}</table></div>`;
}

// tri: trimestre do snapshot que o plano usa (padrão: o da tela)
export async function requestWrite(acao, dados, { onDone, tri } = {}) {
  if (!S.meta?.pode_gravar) { toast('Somente leitura: você não está na lista de quem grava no Notion.'); return; }
  const body = openModal('<h3>Plano de escrita</h3><p class="hint">Montando o plano com os valores atuais do Notion…</p>', { wide: true });
  let p;
  try {
    p = await api.plan(acao, dados, { sprint: state.sprint, tri: tri ?? state.tri });
  } catch (e) {
    body.innerHTML = `<h3>Plano de escrita</h3><p class="plan-bloq">Não foi possível montar o plano: ${esc(e.message)}</p><div class="btnrow"><button type="button" class="btn" id="p-close">Fechar</button></div>`;
    body.querySelector('#p-close').onclick = closeModal;
    return;
  }
  const podeGravar = p.planId && !p.bloqueios.length;
  body.innerHTML = `<h3>Plano de escrita — ${esc(p.titulo)}</h3>
    <p class="hint" style="margin:0">Confira o que vai ser gravado no Notion. Nada é gravado antes de <b>Gravar no Notion</b>. Linhas em vermelho removem uma ligação.</p>
    ${p.linhas.length ? planTable(p) : ''}
    ${p.avisos.length ? `<ul class="plan-avisos">${p.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    ${p.bloqueios.length ? `<ul class="plan-bloq">${p.bloqueios.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    <div class="btnrow" id="p-btns">${podeGravar ? `<button type="submit" class="btn primary">Gravar no Notion (${p.n_operacoes} operaç${p.n_operacoes === 1 ? 'ão' : 'ões'})</button>` : ''}<button type="button" class="btn" id="p-cancel">${podeGravar ? 'Cancelar' : 'Fechar'}</button></div>
    <div class="plan-prog" id="p-prog" hidden><div class="bar"><i id="p-bar" style="width:0"></i></div><ol class="plan-log" id="p-log"></ol><div class="btnrow" id="p-end"></div></div>`;
  body.querySelector('#p-cancel').onclick = closeModal;
  if (!podeGravar) return;

  document.getElementById('modal-form').onsubmit = async (e) => {
    e.preventDefault();
    body.querySelector('#p-btns').hidden = true;
    const prog = body.querySelector('#p-prog'); prog.hidden = false;
    const bar = body.querySelector('#p-bar'); const log = body.querySelector('#p-log');
    let fim;
    try {
      fim = await api.exec(p.planId, (ev) => {
        if (ev.tipo !== 'passo') return;
        bar.style.width = `${Math.round(((ev.i + 1) / ev.n) * 100)}%`;
        log.insertAdjacentHTML('beforeend', `<li class="${ev.ok ? '' : 'err'}">${ev.ok ? (ev.skip ? '•' : '✓') : '✗'} ${esc(ev.ok ? ev.texto : ev.erro)}${ev.url ? ` · <a href="${esc(ev.url)}" target="_blank" rel="noopener">abrir ↗</a>` : ''}</li>`);
        log.scrollTop = log.scrollHeight;
      });
    } catch (err) {
      fim = { ok: false, erro: { mensagem: err.message }, links: [] };
    }
    writeLog.push({
      quando: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      titulo: p.titulo, ok: fim.ok, links: fim.links || [], erro: fim.erro?.mensagem || null,
    });
    const end = body.querySelector('#p-end');
    end.innerHTML = fim.ok
      ? `<span class="plan-ok">✓ Gravado no Notion (${fim.feitos}/${fim.total}).</span><button type="button" class="btn primary" id="p-done">Fechar e atualizar</button>`
      : `<span class="plan-err">✗ Parou: ${esc(fim.erro?.mensagem || 'erro')} ${fim.erro?.conflito ? '— alguém mudou este item no Notion; atualize e refaça.' : ''} ${fim.feitos ? `(${fim.feitos} passo(s) já gravado(s) — refazer não duplica)` : ''}</span><button type="button" class="btn" id="p-done">Fechar e atualizar</button>`;
    body.querySelector('#p-done').onclick = async () => { closeModal(); await hooks.reload(true); if (onDone) onDone(fim); };
    body.querySelector('#p-done').focus();
  };
}
