// Formulário de meta (nova, de elaboração a partir de um desejo, ou edição) — campos do mock v2.2.
import { S } from './store.js';
import { state } from './state.js';
import { esc } from './util.js';
import { openModal, closeModal } from './modal.js';
import { requestWrite } from './plan-modal.js';
import { OUTROS } from './rules.js';

function subOptions(sel) {
  const { D, I } = S;
  const roots = [...Object.keys(D.projetos), ...(I.byId[OUTROS] ? [OUTROS] : [])];
  let h = '';
  roots.forEach((pid) => {
    const p = I.byId[pid]; if (!p) return;
    const items = D.tree.filter((n) => I.rootOf(n.id) === pid && n.id !== pid && !n.sem_acesso);
    h += `<optgroup label="${esc(p.nome)}">${items.map((n) => `<option value="${n.id}" ${sel.includes(n.id) ? 'selected' : ''}>${esc(I.pathOf(n.id).slice(1).join(' › '))}${n.tipo === 'Subsistema' ? '' : ` (${esc(n.tipo)})`}</option>`).join('')}</optgroup>`;
  });
  return h;
}

export function openMetaForm({ sub = '', wish = null, edit = null } = {}) {
  const { D, I } = S;
  const m = edit;
  const subs0 = m ? (m.subs || []) : (sub ? [sub] : []);
  const objAtual = m ? (m.okrs || [])[0] || '' : '';
  const objDefault = m ? objAtual : (state.obj !== 'all' ? state.obj : ((D.objetivos.find((o) => sub && o.projetos.includes(I.rootOf(sub))) || {}).id || ''));
  const areaDefault = m ? m.area : (((I.byId[sub] || { areas: [] }).areas || []).find((x) => x !== 'pd' && !D.areas[x]?.ext) || 'sw');
  const tituloDesejo = wish ? `Elaborar requisito para: ${(wish.titulo.replace(/^\(exemplo\)\s*/, '').split(/, gostaria que |, gostaria de /)[1] || wish.titulo).split(', porque')[0]}` : '';
  const pd = Object.entries(D.areas).filter(([k, a]) => !a.ext && k !== 'pd');
  const ext = Object.entries(D.areas).filter(([, a]) => a.ext);
  const opt = ([k, a]) => `<option value="${k}" ${k === areaDefault ? 'selected' : ''}>${esc(a.nome)}</option>`;
  const b = openModal(`<h3>${m ? 'Editar meta' : wish ? 'Meta de elaboração do requisito' : `Nova meta da sprint #${D.sprint}`}</h3>${wish ? `<p class="hint" style="margin:0">Desejo: “${esc(wish.titulo)}”</p>` : ''}${m && m.url ? `<p class="hint" style="margin:0"><a href="${esc(m.url)}" target="_blank" rel="noopener">página no Notion ↗</a> · você confere o plano antes de gravar</p>` : ''}
  <label>Meta (comece com verbo)<input id="f-t" required value="${esc(m ? m.titulo : tituloDesejo)}"></label>
  <div class="two"><label>Equipe (exatamente 1 — meta de 2 equipes vira 2 metas)<select id="f-a"><optgroup label="P&amp;D">${pd.map(opt).join('')}</optgroup><optgroup label="Outras diretorias">${ext.map(opt).join('')}</optgroup></select></label>
  <label>Objetivo<select id="f-o"><option value="">— nenhum —</option>${D.objetivos.map((o) => `<option value="${o.id}" ${o.id === objDefault ? 'selected' : ''}>${esc(o.icone)} ${o.label} · ${esc(o.curto)}</option>`).join('')}</select>${m && (m.okrs || []).length > 1 ? `<span class="hint">A meta tem ${m.okrs.length} objetivos; aqui você troca o primeiro.</span>` : ''}</label></div>
  <div class="two"><label>Subsistema(s) <span class="hint">(Ctrl/Cmd para vários)</span><select id="f-s" multiple size="7">${subOptions(subs0)}</select></label>
  <label>Status<select id="f-st">${['Não iniciada', 'Em andamento', 'Concluído', 'Abortado'].map((s) => `<option ${((m && m.status) || 'Não iniciada') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>${m ? '' : '<span class="hint">Novas metas nascem "Não iniciada".</span>'}</label></div>
  <label>Critério de conclusão (o que existe, funciona ou está medido quando acabar)${m ? ' <span class="hint">— numa meta existente, o texto é acrescentado na seção, sem apagar o anterior</span>' : ''}<textarea id="f-c" rows="2"></textarea></label>
  <div class="btnrow"><button class="btn primary" type="submit">Montar plano de escrita</button><button class="btn" type="button" id="f-cancel">Cancelar</button></div>`, {
    onSubmit: () => {
      const titulo = b.querySelector('#f-t').value.trim(); if (!titulo) return;
      const area = b.querySelector('#f-a').value; const objetivo = b.querySelector('#f-o').value;
      const criterio = b.querySelector('#f-c').value.trim(); const status = b.querySelector('#f-st').value;
      const subs = [...b.querySelector('#f-s').selectedOptions].map((o) => o.value).filter(Boolean);
      if (!m) {
        requestWrite('meta.criar', { titulo, area, objetivo, subs, status, criterio, desejo: wish?.id || null, sprint: D.sprint });
        return;
      }
      const dados = { meta: m.id };
      if (titulo !== m.titulo) dados.titulo = titulo;
      if (area !== m.area || (m.areas || []).length > 1) dados.area = area;
      if (objetivo !== objAtual) dados.objetivo = objetivo;
      if (JSON.stringify([...subs].sort()) !== JSON.stringify([...(m.subs || [])].sort())) dados.subs = subs;
      if (status !== m.status) dados.status = status;
      if (criterio) dados.criterio = criterio;
      requestWrite('meta.editar', dados);
    },
  });
  b.querySelector('#f-cancel').onclick = closeModal;
  setTimeout(() => b.querySelector('#f-t')?.focus(), 50);
}
