// Página Rollover (página 9 do Lucid): fechamento mecânico da sprint. Nenhuma decisão é tomada aqui —
// o que rola, rola por regra de status. A máquina calcula, o líder confere o plano de escrita e só então grava.
import { S, canWrite } from './store.js';
import { esc, fmt, $, $$ } from './util.js';
import { hooks } from './hooks.js';
import { stageChange } from './rascunho.js';
import { abrirRevisao } from './review.js';

const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const ABERTAS_T = ['A Fazer', 'Em Andamento', 'Em Revisão', 'Bloqueada'];

export function renderRollover() {
  const { D, I } = S;
  const el = $('#page-rollover');
  const w = canWrite();
  const cur = D.sprint; const nxt = cur + 1;
  const spc = D.sprints.find((s) => s.n === cur); const spn = D.sprints.find((s) => s.n === nxt);
  const metasSprint = D.metas.filter((m) => m.sprints.includes(cur) && !m.fora);
  const metasR = metasSprint.filter((m) => !['Concluído', 'Abortado'].includes(m.status));
  const idsSprint = new Set(metasSprint.map((m) => m.id));
  const tarR = D.tarefas.filter((t) => ABERTAS_T.includes(t.status) && (t.sprints.includes(cur) || t.metas.some((id) => idsSprint.has(id))));
  const kpisPend = D.kpis.filter((k) => k.alvo != null && k.serie[String(cur)] == null);
  const chk = (cls, id, on, dis) => (w ? `<td><input type="checkbox" class="${cls}" data-id="${id}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}></td>` : '<td></td>');

  el.innerHTML = `<div class="page-h"><h2>Rollover da sprint <select id="roll-sel" class="mono roll-sel">${D.sprints.map((s) => `<option value="${s.n}" ${s.n === cur ? 'selected' : ''}>#${s.n}</option>`).join('')}</select> → #${nxt}</h2><p>Fechamento mecânico (página 9 do Lucid): nenhuma decisão é tomada aqui — o que rola, rola por regra de status. A máquina calcula, o líder confere o plano de escrita, e só então grava no Notion.</p></div>
  <div class="role-legend"><span><i style="background:var(--cyan-role)"></i>IA / automação</span><span><i style="background:var(--blue-role)"></i>líder da equipe confere</span><span><i style="background:var(--pink-role)"></i>responsável pelo OKR</span></div>
  <div class="steps">
    <div class="step"><div class="no ciano">R1</div><div><h3>Garantir que a próxima sprint existe</h3><div class="who">🏃 Sprints · cria a próxima e, no fim, conclui a atual</div>
      <div class="twrap"><table class="t"><tr><th>Sprint</th><th>Datas</th><th>Status</th><th>Ação</th></tr><tr><td class="mono">#${cur}</td><td class="mono">${spc.ini || '?'} → ${spc.fim || '?'}</td><td>${esc(spc.status)}</td><td>${spc.status === 'Concluído' ? 'já concluída ✓' : '→ marcar Concluído (R6)'}</td></tr><tr><td class="mono">#${nxt}</td><td class="mono">${spn ? `${spn.ini} → ${spn.fim}` : spc.fim ? `${addDays(spc.fim, 3)} → ${addDays(spc.fim, 14)} (calculado, +14 dias)` : '?'}</td><td>${spn ? esc(spn.status) : '<span style="color:var(--warn)">não existe</span>'}</td><td>${spn ? (spn.status === 'Em andamento' ? 'já em andamento ✓' : '→ marcar Em andamento (R6)') : `→ criar página "Sprint P&amp;D #${nxt}"`}</td></tr></table></div></div></div>
    <div class="step"><div class="no ciano">R2</div><div><h3>Metas não concluídas → vincular à sprint #${nxt}</h3><div class="who">🏁 Metas da Sprint · Status ≠ Concluído/Abortado · relação Sprint acumulativa · Sprint_de_origem quando o campo existir (Fase 4, item 7); senão, linha no "Histórico de sprints"</div>
      <div class="twrap"><table class="t"><tr><th></th><th>Meta</th><th>Status</th><th>Equipe</th><th>Sprints</th><th>Subsistema</th></tr>${metasR.map((m) => { const ja = m.sprints.includes(nxt); return `<tr>${chk('r-m', m.id, !ja, ja)}<td>${esc(m.titulo)} ${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener" style="font-size:10px">↗</a>` : ''}${ja ? ` <span class="tag" style="font-family:var(--mono);font-size:9.5px;color:var(--good)">já na #${nxt}</span>` : ''}</td><td>${esc(m.status)}</td><td style="color:var(--${m.area});font-weight:600">${esc(I.AREA_NAME(m.area))}</td><td class="mono">${m.sprints.map((s) => `#${s}`).join(' → ')}${m.sprints.length > 1 ? ' <span style="color:var(--warn)">(arrasta)</span>' : ''}</td><td>${m.subs.map((s) => esc(I.byId[s]?.nome || '?')).join(', ') || '<span style="color:var(--crit)">—</span>'}</td></tr>`; }).join('') || `<tr><td colspan="6" class="empty">Nenhuma meta pendente na #${cur}.</td></tr>`}</table></div></div></div>
    <div class="step"><div class="no ciano">R3</div><div><h3>Tarefas não concluídas → vincular à sprint #${nxt}</h3><div class="who">✅ Lista de Tarefas · A Fazer, Em Andamento, Em Revisão, Bloqueada · relação Sprint acumulativa</div>
      <div class="twrap"><table class="t"><tr><th></th><th>Tarefa</th><th>Status</th><th>Meta</th><th>Resp.</th></tr>${tarR.map((t) => { const ja = t.sprints.includes(nxt); return `<tr>${chk('r-t', t.id, !ja, ja)}<td>${esc(t.titulo)} ${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener" style="font-size:10px">↗</a>` : ''}</td><td>${esc(t.status)}</td><td>${t.metas.map((id) => esc(I.metaById[id]?.titulo || '')).filter(Boolean).join(', ')}</td><td class="mono">${t.resp ? `👤 ${esc(t.resp)}` : '—'}</td></tr>`; }).join('') || `<tr><td colspan="5" class="empty">Nenhuma tarefa aberta ligada à #${cur}.</td></tr>`}</table></div></div></div>
    <div class="step"><div class="no rosa">R4</div><div><h3>Medições pendentes da sprint #${cur}</h3><div class="who">📈 Evolução de KPIs · uma linha por KPI × sprint · único passo humano do fechamento de OKRs (página 7)</div>
      <p class="hint" style="margin:0 0 6px">${kpisPend.length} de ${D.kpis.filter((k) => k.alvo != null).length} KPIs com alvo não têm linha para a #${cur}. O responsável pelo OKR informa o valor aqui${w ? '' : ' (somente leitura)'}; em branco = não medido nesta sprint.</p>
      <div class="twrap" style="max-height:320px;overflow:auto"><table class="t">${kpisPend.map((k) => `<tr><td>${esc(k.titulo)}</td><td class="mono" style="white-space:nowrap">alvo ${esc(k.dir || '')} ${fmt(k.alvo)} ${esc(k.unidade || '')}</td>${w ? `<td><input class="r-k" data-id="${k.id}" inputmode="decimal" placeholder="valor" style="width:90px"></td>` : ''}</tr>`).join('') || '<tr><td class="empty">Todas as medições registradas ✓</td></tr>'}</table></div></div></div>
    <div class="step"><div class="no ciano">R5</div><div><h3>Apontar as páginas de visualização para a #${nxt}</h3><div class="who">Este dashboard segue sozinho a sprint com Status = Em andamento. Páginas do Notion com filtro fixo precisam de ajuste manual:</div>
      <ul style="margin:0;padding-left:18px;font-size:12px"><li>Template "Sprint P&amp;D #N": view de OKRs com Trimestre fixo → trocar para o trimestre atual</li><li>Base Tarefas: view "Sprint Atual" → #${nxt}</li><li>Páginas operacionais das equipes e página "Eu" (quando existirem)</li></ul></div></div>
    <div class="step"><div class="no azul">R6</div><div><h3>Líder da equipe confere e confirma</h3><div class="who">Só depois disto algo é gravado — o plano de escrita mostra cada página e campo antes de gravar</div>
      ${w ? `<label class="ctl" style="margin-bottom:8px"><input type="checkbox" id="r-fechar" checked> No fim, marcar #${cur} como Concluído e #${nxt} como Em andamento</label>
      <div class="btnrow"><button class="btn primary" id="r-go">Revisar e gravar o rollover</button><span class="hint">Entra no rascunho como um item só (R1–R4 e o fechamento) e abre a revisão; é gravado sozinho, passo a passo, e pode ser refeito sem duplicar.</span></div>` : '<p class="hint">Somente leitura.</p>'}</div></div>
  </div>`;
  $('#roll-sel', el).onchange = (e) => hooks.setSprint(Number(e.target.value));
  if (!w) return;
  $('#r-go', el).onclick = () => {
    const ok = stageChange('rollover', {
      sprint: cur,
      metas: $$('.r-m:checked', el).map((c) => c.dataset.id),
      tarefas: $$('.r-t:checked', el).map((c) => c.dataset.id),
      medicoes: $$('.r-k', el).filter((i) => i.value.trim()).map((i) => ({ kpi: i.dataset.id, valor: i.value.trim() })),
      fechar: $('#r-fechar', el).checked,
    }, { silencioso: true });
    if (ok) abrirRevisao();
  };
}
