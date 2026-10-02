// Entrada do front: carrega o snapshot do Notion (via servidor), monta header e páginas,
// atualiza sozinho (ETag) e liga os atalhos. Portado do mock v2.2.
import * as api from './api.js';
import { S, setData } from './store.js';
import { state, persist } from './state.js';
import { hooks } from './hooks.js';
import { esc, toast, download, dm, quarterShift, $, $$ } from './util.js';
import { renderBoard, applyAreaColors, initDivider } from './board.js';
import { drawArrows } from './arrows.js';
import { renderRollover } from './rollover.js';
import { renderReuniao } from './reuniao.js';
import { renderTrimestral } from './trimestral.js';
import { closeModal } from './modal.js';
import { closeDrawer } from './drawer.js';

const POLL_MS = state.tv ? 60_000 : 120_000;

// ---------- tema ----------
function applyTheme() {
  const r = document.documentElement;
  if (state.theme === 'auto') delete r.dataset.theme; else r.dataset.theme = state.theme;
  const b = $('#theme-btn'); b.title = `Tema: ${{ auto: 'automático', light: 'claro', dark: 'escuro' }[state.theme]} (clique para trocar)`;
}
$('#theme-btn').onclick = () => {
  state.theme = { auto: 'light', light: 'dark', dark: 'auto' }[state.theme];
  applyTheme(); persist(); requestAnimationFrame(drawArrows);
};

// ---------- URL ----------
function updateUrl() {
  const q = new URLSearchParams();
  if (state.tv) q.set('modo', 'tv');
  if (state.sprint != null) q.set('sprint', state.sprint);
  if (state.tri) q.set('tri', state.tri);
  if (state.page !== 'board') q.set('pagina', state.page);
  history.replaceState(null, '', `${location.pathname}${q.toString() ? `?${q}` : ''}`);
}

// ---------- header ----------
function renderHeader() {
  const { D, meta } = S;
  const selS = $('#sel-sprint');
  selS.innerHTML = D.sprints.slice().reverse().map((s) => `<option value="${s.n}">#${s.n} · ${dm(s.ini)}–${dm(s.fim)} · ${esc(s.status)}</option>`).join('');
  selS.value = D.sprint;
  selS.onchange = () => hooks.setSprint(Number(selS.value));
  const selT = $('#sel-tri'); const t = D.trimestre.id;
  selT.innerHTML = [quarterShift(t, 1), t, quarterShift(t, -1)].map((x) => `<option value="${esc(x)}">${esc(x.replace(' - ', '-'))}${x === t && !state.tri ? ' · da sprint' : ''}${x === t && D.trimestre.fim ? ` · até ${dm(D.trimestre.fim)}` : ''}</option>`).join('');
  selT.value = t;
  selT.onchange = () => { state.tri = selT.value; updateUrl(); load(); };
  const hora = new Date(D.lido_em_iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  $('#badge-data').textContent = `Notion lido às ${hora} · ↻`;
  $('#badge-data').title = `Dados do Notion de ${D.lido_em}. Clique para recarregar agora.`;
  $('#user-chip').innerHTML = `${esc(meta.email)} · <b>${meta.pode_gravar && !state.tv ? 'edição' : 'leitura'}</b>${meta.auth === 'dev' ? ' · <span title="AUTH_MODE=dev: usuário local, sem login Google">dev</span>' : ''}${meta.modo === 'fixture' ? ' · <span title="NOTION_MODE=fixture: dados de demonstração (foto do mock de 14/09), gravações em memória">demo</span>' : ''}`;
  const tv = $('#tv-btn');
  const pg = state.page !== 'board' ? `&pagina=${state.page}` : '';
  tv.href = state.tv ? `?${state.sprint != null ? `sprint=${state.sprint}` : ''}${pg}` : `?modo=tv${state.sprint != null ? `&sprint=${state.sprint}` : ''}${pg}`;
  tv.title = state.tv ? 'Sair do modo TV' : 'Modo TV: tela grande, só leitura, atualiza sozinho';
  const ban = $('#banner');
  const erros = (meta.avisos_schema || []).filter((a) => a.nivel === 'ERRO');
  if (meta.somente_leitura) {
    ban.hidden = false; ban.className = 'banner crit';
    ban.innerHTML = `<b>Somente leitura:</b> o schema do Notion não bate com o esperado — ${erros.slice(0, 3).map((e) => esc(e.msg)).join(' · ')}${erros.length > 3 ? ` (+${erros.length - 3})` : ''}. Veja <a href="/api/health" target="_blank">/api/health</a>.`;
  } else ban.hidden = true;
}

// ---------- páginas ----------
const PAGES = ['board', 'trimestral', 'rollover', 'reuniao'];
function showPage(p) {
  if (!PAGES.includes(p)) p = 'board';
  state.page = p;
  $$('.nav button').forEach((x) => { if (x.dataset.page === p) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current'); });
  PAGES.forEach((k) => { $(`#page-${k}`).hidden = k !== p; });
  document.body.dataset.page = p;
  updateUrl();
  render();
}
$$('.nav button').forEach((b) => { b.onclick = () => showPage(b.dataset.page); });
$('#go-reuniao').onclick = () => showPage('reuniao');

function render() {
  if (!S.D) return;
  renderHeader();
  if (state.page === 'board') renderBoard();
  if (state.page === 'rollover') renderRollover();
  if (state.page === 'reuniao') renderReuniao();
  if (state.page === 'trimestral') renderTrimestral();
}

// ---------- carga ----------
let loading = null;
async function load(force = false) {
  if (loading) return loading;
  const badge = $('#badge-data');
  if (force || !S.D) badge.textContent = 'lendo o Notion…';
  loading = (async () => {
    try {
      const r = await api.getSnapshot({ sprint: state.sprint, tri: state.tri, force });
      if (!r.changed && S.D) { renderHeader(); return; }
      setData(r);
      applyAreaColors(S.D.areas);
      render();
    } catch (e) {
      const ban = $('#banner'); ban.hidden = false; ban.className = 'banner crit';
      ban.innerHTML = `<b>Não foi possível ler o Notion:</b> ${esc(e.message)}. <button class="btn small" id="retry">Tentar de novo</button>`;
      $('#retry').onclick = () => load(true);
      if (!S.D) $('#lanes').innerHTML = '<div class="empty">Sem dados.</div>';
      else badge.textContent = 'erro ao atualizar · ↻';
    } finally { loading = null; }
  })();
  return loading;
}

hooks.render = render;
hooks.reload = load;
hooks.drawArrows = drawArrows;
hooks.setSprint = (n) => { state.sprint = n; updateUrl(); closeDrawer(); load(); };

$('#badge-data').onclick = async () => { await api.refresh().catch(() => {}); load(true); toast('Recarregando do Notion…'); };

// ---------- exportar ----------
$('#dl-json').onclick = () => {
  const { D, I } = S;
  const metas = D.metas.filter((m) => m.sprints.includes(D.sprint) && !m.fora).map((m) => ({
    notion_url: m.url, meta: m.titulo, status: m.status, area: I.AREA_NAME(m.area),
    objetivos: (m.okrs || []).map((o) => I.objById[o]?.titulo || o), okrs_fora: m.okrs_extra,
    subsistemas: (m.subs || []).map((s) => I.pathOf(s).join(' › ')), sprints: m.sprints,
    bloqueado_por: (m.bloq || []).map((b) => I.metaById[b]?.titulo || b), tarefas: m.tarefas,
  }));
  download(`metas-sprint-${D.sprint}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ gerado_em: new Date().toISOString(), sprint: D.sprint, fonte: `Notion lido em ${D.lido_em}`, metas }, null, 2));
};

// ---------- teclado, janela ----------
$('#drawer-close').onclick = closeDrawer;
$('#modal-close').onclick = closeModal;
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeDrawer();
  if ($('#modal-bg').classList.contains('open')) closeModal();
  if (state.linking) { state.linking = null; render(); }
});
window.addEventListener('resize', () => requestAnimationFrame(drawArrows));

// Atualização automática: só quando nada está aberto nem sendo arrastado.
setInterval(() => {
  if (document.hidden || state.busy || state.drag || state.connect || state.linking || $('#drawer').classList.contains('open')) return;
  load(false);
}, POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.D && Date.now() - Date.parse(S.D.lido_em_iso) > POLL_MS) load(false); });

// ---------- início ----------
if (state.tv) document.body.classList.add('tv');
applyTheme();
initDivider();
if (state.page !== 'board') showPage(state.page);
load();
