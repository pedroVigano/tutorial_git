// Registrar medição de KPI (linha em 📈 Evolução de KPIs: KPI × Sprint × Valor) — o único passo humano
// do fechamento de OKRs (página 7 do Lucid). Novo em relação ao mock: antes era só uma lista de pendências.
import { S } from './store.js';
import { esc, fmt } from './util.js';
import { openModal, closeModal } from './modal.js';
import { stageChange } from './rascunho.js';

export function openKpiForm(k, { sprint } = {}) {
  const { D } = S;
  const n0 = sprint ?? D.sprint;
  const opts = D.sprints.slice().reverse().map((s) => `<option value="${s.n}" ${s.n === n0 ? 'selected' : ''}>#${s.n} · ${esc(s.status)}${k.serie[String(s.n)] != null ? ` · já medido: ${fmt(k.serie[String(s.n)])}` : ''}</option>`).join('');
  const b = openModal(`<h3>Registrar medição do KPI</h3><p class="hint" style="margin:0">${esc(k.titulo)} · alvo ${esc(k.dir || '?')} ${fmt(k.alvo)} ${esc(k.unidade || '')}</p>
    <div class="two"><label>Sprint<select id="k-s">${opts}</select></label>
    <label>Valor${k.unidade ? ` (${esc(k.unidade)})` : ''}<input id="k-v" inputmode="decimal" required placeholder="ex.: 12,5"></label></div>
    <label>Data da medição<input id="k-d" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
    <p class="hint" style="margin:0">Uma linha por KPI × sprint. Se a sprint já tiver medição, a revisão mostra a troca do valor.</p>
    <div class="btnrow"><button class="btn primary" type="submit">Pôr no rascunho</button><button class="btn" type="button" id="k-cancel">Cancelar</button></div>`, {
    onSubmit: () => {
      const valor = b.querySelector('#k-v').value.trim(); if (!valor) return;
      if (stageChange('kpi.medir', { kpi: k.id, sprint: Number(b.querySelector('#k-s').value), valor, data: b.querySelector('#k-d').value })) closeModal();
    },
  });
  b.querySelector('#k-cancel').onclick = closeModal;
  setTimeout(() => b.querySelector('#k-v')?.focus(), 50);
}
