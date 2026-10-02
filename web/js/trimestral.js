// Página Trimestral: trimestre revisado (esquerda) × planejado (direita), linha a linha.
// Duplicar copia o objetivo com KRs e KPIs para a direita; lá se edita o texto, arrasta-se o alvo no gráfico,
// aborta-se ou acrescentam-se itens. Tudo fica num rascunho neste navegador até "Gravar no Notion", que mostra
// um único plano de escrita (cópias com Origem, medições religadas, edições, abortos e status final).
import * as api from './api.js';
import { S, buildIndex } from './store.js';
import { state } from './state.js';
import { esc, fmt, store, quarterShift, toast, $, $$ } from './util.js';
import { kpiStatus, krStatus, objStatus, stColor } from './rules.js';
import { scoreHTML } from './board.js';
import { requestWrite } from './plan-modal.js';

export const STATUS_FINAL = ['Atingido', 'Atingido Parcialmente', 'Não atingido', 'Abortado'];
const UNIDADES = ['adimensional', '%', 'kg', 'm', 'cm', 'm²', 'm/s', 'ha', 'horas', 'min', 'ms', 'Hz', 'A', 'A (48 V)', 'A·h', 'kWh', 'rad/s', 'º', '± °', 'R$', '% (nominal 220 V)'];
const DIRS = ['≥', '≤', '='];

export function finalPelaRegra(st) {
  if (st.txt === 'Atingido') return 'Atingido';
  if (st.txt === 'Parcial') return 'Atingido Parcialmente';
  if (st.txt === 'Não atingido') return 'Não atingido';
  return null;
}

const pg = { rev: null, plan: null, data: {}, loading: null, err: null, pending: false, closed: new Set() };
const triLabel = (t) => (t || '').replace(' - ', '-');

// ---------- rascunho (fica neste navegador) ----------
// dup: itens do revisado marcados para copiar · abort/edit: por slot do lado planejado · novos: itens novos
// (key, grau, pai = slot) · fim: status final do revisado
const draftKey = () => `gt-tri2:${pg.rev}>${pg.plan}`;
const emptyDraft = () => ({ dup: {}, abort: {}, edit: {}, novos: [], fim: {} });
let draft = emptyDraft();
const loadDraft = () => { draft = { ...emptyDraft(), ...store.get(draftKey(), {}) }; };
const saveDraft = () => store.set(draftKey(), draft);
const novoKey = () => `n:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------- dados ----------
async function fetchTri(tri, force) {
  if (!force && S.D && S.D.trimestre.id === tri) return { D: S.D, I: S.I };
  const r = await api.getSnapshot({ sprint: state.sprint, tri, force });
  return { D: r.D, I: buildIndex(r.D) };
}

function ensure(force = false) {
  const stamp = S.D?.lido_em_iso;
  const ok = (t) => pg.data[t] && pg.data[t].stamp === stamp;
  if (pg.loading || (!force && ok(pg.rev) && ok(pg.plan))) return;
  const want = [pg.rev, pg.plan];
  pg.loading = (async () => {
    try {
      const [rev, plan] = await Promise.all(want.map((t) => fetchTri(t, force)));
      pg.data[want[0]] = { ...rev, stamp }; pg.data[want[1]] = { ...plan, stamp };
      pg.err = null;
    } catch (e) { pg.err = e.message; }
    finally {
      pg.loading = null;
      if (pg.rev !== want[0] || pg.plan !== want[1]) ensure(); // a seleção mudou durante a carga
      paint();
    }
  })();
}

export function renderTrimestral() {
  if (!S.D) return;
  if (!pg.rev) { pg.rev = S.D.trimestre.id; pg.plan = quarterShift(pg.rev, 1); loadDraft(); }
  ensure();
  paint();
}

// ---------- eixo: sprints que começam em cada trimestre (as futuras projetadas a cada 14 dias) ----------
function quarterBounds(t) {
  const m = /^(\d{4}) - (\d)$/.exec(t || ''); if (!m) return null;
  return { ini: new Date(Date.UTC(+m[1], (+m[2] - 1) * 3, 1)).toISOString().slice(0, 10), fim: new Date(Date.UTC(+m[1], +m[2] * 3, 0)).toISOString().slice(0, 10) };
}
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function eixo(D) {
  const qr = quarterBounds(pg.rev); const qp = quarterBounds(pg.plan);
  const real = D.sprints.filter((s) => s.ini);
  const rev = real.filter((s) => s.ini >= qr.ini && s.ini <= qr.fim).map((s) => ({ n: s.n }));
  const plan = real.filter((s) => s.ini >= qp.ini && s.ini <= qp.fim).map((s) => ({ n: s.n }));
  const last = real[real.length - 1];
  if (last) {
    let n = last.n; let ini = addDays(last.ini, 14);
    while (ini <= qp.fim && plan.length < 10) {
      n += 1;
      if (ini >= qp.ini) plan.push({ n, proj: true }); else if (ini >= qr.ini) rev.push({ n, proj: true });
      ini = addDays(ini, 14);
    }
  }
  return { rev, plan };
}

// ---------- modelo: grupos por objetivo com linhas pareadas revisado × planejado ----------
function model() {
  const R = pg.data[pg.rev]; const P = pg.data[pg.plan];
  if (!R || !P) return null;
  const revIds = new Set([...R.D.objetivos, ...R.D.krs, ...R.D.kpis].map((x) => x.id));
  const porOrigem = new Map();
  [...P.D.objetivos, ...P.D.krs, ...P.D.kpis].forEach((x) => (x.origem || []).forEach((o) => { if (revIds.has(o)) porOrigem.set(o, x); }));
  const regra = {};
  R.D.objetivos.forEach((o) => { regra[o.id] = objStatus(R.I, o); });
  R.D.krs.forEach((k) => { regra[k.id] = krStatus(R.I, k); });
  R.D.kpis.forEach((k) => { regra[k.id] = kpiStatus(k); });

  const fromExist = (x, grau, slot) => ({ kind: 'exist', slot, grau, id: x.id, url: x.url, label: x.label, ordem: x.ordem, base: { titulo: x.titulo, alvo: x.alvo ?? null, unidade: x.unidade ?? null, direcao: x.dir ?? null }, notionAbortado: x.status === 'Abortado', serie: x.serie || {} });
  const fromCopy = (src, grau, slot) => ({ kind: 'copy', slot, grau, src, ordem: src.ordem, base: { titulo: src.titulo, alvo: src.alvo ?? null, unidade: src.unidade ?? null, direcao: src.dir ?? null }, serie: {} });
  const fromNovo = (n) => ({ kind: 'novo', slot: n.key, grau: n.grau, ordem: n.ordem ?? null, base: { titulo: '', alvo: null, unidade: null, direcao: n.grau === 'KPI' ? '≥' : null }, serie: {} });
  const finish = (node) => {
    if (!node) return null;
    node.v = { ...node.base, ...(draft.edit[node.slot] || {}) };
    node.abortado = !!draft.abort[node.slot] || !!node.notionAbortado;
    return node;
  };
  const novosDe = (paiSlot, grau) => draft.novos.filter((n) => n.pai === paiSlot && n.grau === grau).map((n) => finish(fromNovo(n)));
  // pai abortado (no rascunho ou no Notion) leva os filhos junto
  const herda = (node, pai) => { if (node && pai?.abortado && !node.abortado) { node.abortado = true; node.porPai = true; } return node; };
  const vivo = (node) => node && !node.abortado;

  const kpiRows = (krQ3, krQ4) => {
    const rows = [];
    const proprios = new Set(krQ3 ? R.I.kpisOf(krQ3.id).map((k) => k.id) : []);
    for (const k of krQ3 ? R.I.kpisOf(krQ3.id) : []) {
      const slot = `q:${k.id}`; const ex = porOrigem.get(k.id);
      const q4 = herda(finish(ex ? fromExist(ex, 'KPI', slot) : (draft.dup[k.id] && vivo(krQ4) ? fromCopy(k, 'KPI', slot) : null)), krQ4);
      rows.push({ q3: k, q4, slot, podeDup: !q4 && vivo(krQ4) });
    }
    if (krQ4?.kind === 'exist') {
      for (const k of P.I.kpisOf(krQ4.id)) {
        if ((k.origem || []).some((o) => proprios.has(o))) continue;
        const q4 = herda(finish(fromExist(k, 'KPI', `e:${k.id}`)), krQ4);
        rows.push({ q3: null, q4, slot: q4.slot });
      }
    }
    if (vivo(krQ4)) novosDe(krQ4.slot, 'KPI').forEach((n) => rows.push({ q3: null, q4: n, slot: n.slot }));
    return rows;
  };
  const krRows = (oQ3, oQ4) => {
    const rows = [];
    const proprios = new Set(oQ3 ? R.I.krsOf(oQ3.id).map((k) => k.id) : []);
    for (const kr of oQ3 ? R.I.krsOf(oQ3.id) : []) {
      const slot = `q:${kr.id}`; const ex = porOrigem.get(kr.id);
      const q4 = herda(finish(ex ? fromExist(ex, 'Resultado-Chave', slot) : (draft.dup[kr.id] && vivo(oQ4) ? fromCopy(kr, 'Resultado-Chave', slot) : null)), oQ4);
      rows.push({ q3: kr, q4, slot, podeDup: !q4 && vivo(oQ4), kpis: kpiRows(kr, q4) });
    }
    if (oQ4?.kind === 'exist') {
      for (const kr of P.I.krsOf(oQ4.id)) {
        if ((kr.origem || []).some((o) => proprios.has(o))) continue;
        const q4 = herda(finish(fromExist(kr, 'Resultado-Chave', `e:${kr.id}`)), oQ4);
        rows.push({ q3: null, q4, slot: q4.slot, kpis: kpiRows(null, q4) });
      }
    }
    if (vivo(oQ4)) novosDe(oQ4.slot, 'Resultado-Chave').forEach((n) => rows.push({ q3: null, q4: n, slot: n.slot, kpis: kpiRows(null, n) }));
    return rows;
  };

  const grupos = [];
  for (const o of R.D.objetivos) {
    const slot = `q:${o.id}`; const ex = porOrigem.get(o.id);
    const q4 = finish(ex ? fromExist(ex, 'Objetivo', slot) : (draft.dup[o.id] ? fromCopy(o, 'Objetivo', slot) : null));
    grupos.push({ q3: o, q4, slot, krs: krRows(o, q4) });
  }
  const pareados = new Set(grupos.map((g) => g.q4?.id).filter(Boolean));
  for (const o of P.D.objetivos) {
    if (pareados.has(o.id)) continue;
    const q4 = finish(fromExist(o, 'Objetivo', `e:${o.id}`));
    grupos.push({ q3: null, q4, slot: q4.slot, krs: krRows(null, q4) });
  }
  draft.novos.filter((n) => n.grau === 'Objetivo').forEach((n) => { const q4 = finish(fromNovo(n)); grupos.push({ q3: null, q4, slot: q4.slot, krs: krRows(null, q4) }); });
  return { R, P, regra, grupos, eixo: eixo(R.D) };
}

// ---------- itens para o plano de escrita ----------
const edited = (node) => {
  const e = draft.edit[node.slot]; if (!e) return false;
  return Object.keys(e).some((k) => (e[k] ?? null) !== (node.base[k] ?? null));
};
// Ordem dos itens novos: depois do último irmão.
const ordemNova = (irmaos, i) => {
  const antes = irmaos.slice(0, i).map((r) => r.q4?.ordem ?? r.q3?.ordem).filter((x) => x != null);
  return antes.length ? Math.max(...antes) + 1 : i + 1;
};

export function itensDoRascunho(M) {
  const itens = [];
  // devolve true se o nó (ou algum descendente) vai para o plano
  const add = (node, paiSlot, ordem, filhos) => {
    if (!node) return false;
    if (node.kind === 'exist') {
      if (node.notionAbortado) return false;
      if (node.porPai) { itens.push({ key: node.slot, grau: node.grau, pai: paiSlot, id: node.id, abortar: true, titulo: node.base.titulo }); filhos.forEach((f) => f()); return true; }
      const sub = filhos.map((f) => f()).some(Boolean);
      const abortar = !!draft.abort[node.slot] || !!node.porPai; const ed = edited(node);
      if (!abortar && !ed && !sub) return false;
      itens.push({ key: node.slot, grau: node.grau, pai: paiSlot, id: node.id, abortar, editado: ed, ...(ed ? node.v : { titulo: node.base.titulo }) });
      return true;
    }
    if (node.abortado) return false;
    itens.push({ key: node.slot, grau: node.grau, pai: paiSlot, origem: node.kind === 'copy' ? node.src.id : null, ordem: node.ordem ?? ordem, ...node.v });
    filhos.forEach((f) => f());
    return true;
  };
  M.grupos.forEach((g, gi) => add(g.q4, null, ordemNova(M.grupos, gi),
    g.krs.map((r, ri) => () => add(r.q4, g.slot, ordemNova(g.krs, ri),
      r.kpis.map((k, ki) => () => add(k.q4, r.slot, ordemNova(r.kpis, ki), []))))));
  return itens;
}
const statusFinal = () => Object.entries(draft.fim).map(([id, status]) => ({ id, status }));
function contagem(M) {
  const it = itensDoRascunho(M);
  return { criar: it.filter((x) => !x.id).length, editar: it.filter((x) => x.id && x.editado && !x.abortar).length, abortar: it.filter((x) => x.abortar).length, fim: statusFinal().length };
}

// ---------- gráfico: revisado | planejado, alvo do planejado arrastável ----------
const W = 1800; const H = 150; const PT = 22; const PB = 22; const MID = W / 2; const GAP = 14;
function scaleFor(row, M) {
  const k = row.q3; const v4 = row.q4?.v;
  const nums = [];
  M.eixo.rev.forEach((s) => { const x = k?.serie?.[String(s.n)]; if (x != null) nums.push(x); });
  M.eixo.plan.forEach((s) => { const x = row.q4?.serie?.[String(s.n)]; if (x != null) nums.push(x); });
  if (k?.alvo != null) nums.push(k.alvo);
  if (v4?.alvo != null) nums.push(Number(v4.alvo));
  let lo = Math.min(0, ...nums); let hi = Math.max(1, ...nums);
  if (hi === lo) hi = lo + 1;
  const pad = (hi - lo) * 0.35; hi += pad; if (lo < 0) lo -= pad * 0.3;
  return { lo, hi };
}
const yOf = (sc, v) => H - PB - ((v - sc.lo) / (sc.hi - sc.lo)) * (H - PT - PB);
const vOf = (sc, y) => sc.lo + ((H - PB - y) / (H - PT - PB)) * (sc.hi - sc.lo);
export function niceStep(range) {
  const raw = range / 60; const p = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw - 1e-12) || p * 10;
}
export const snapTo = (v, step) => Number((Math.round(v / step) * step).toFixed(Math.max(0, -Math.floor(Math.log10(step)))));

function chart(row, M) {
  const sc = scaleFor(row, M); const k = row.q3; const q4 = row.q4 && !row.q4.abortado ? row.q4 : null;
  const xs3 = M.eixo.rev; const xs4 = M.eixo.plan;
  const x3 = (i) => (xs3.length > 1 ? 24 + (i * (MID - GAP - 48)) / (xs3.length - 1) : (MID - GAP) / 2);
  const x4 = (i) => (xs4.length > 1 ? MID + GAP + 24 + (i * (W - MID - GAP - 48 - 60)) / (xs4.length - 1) : MID + (W - MID) / 2);
  let s = `<svg class="tq-chart" viewBox="0 0 ${W} ${H}" data-lo="${sc.lo}" data-hi="${sc.hi}" role="img" aria-label="Série do KPI por sprint e alvos dos dois trimestres">`;
  s += `<line class="grid" x1="8" x2="${W - 8}" y1="${H - PB}" y2="${H - PB}"/><line class="sep" x1="${MID}" x2="${MID}" y1="4" y2="${H - 4}"/>`;
  if (k) {
    if (k.alvo != null) { const ty = yOf(sc, k.alvo); s += `<line class="tgt" x1="10" x2="${MID - GAP}" y1="${ty}" y2="${ty}"/><text class="tl" x="${MID - GAP}" y="${ty - 4}" text-anchor="end">alvo ${esc(k.dir || '')} ${fmt(k.alvo)}</text>`; }
    const pts = xs3.map((sp, i) => (k.serie[String(sp.n)] != null ? [x3(i), yOf(sc, k.serie[String(sp.n)])] : null)).filter(Boolean);
    if (pts.length > 1) s += `<polyline class="ln" points="${pts.map((p) => p.join(',')).join(' ')}"/>`;
    const col = stColor(kpiStatus(k).cls);
    xs3.forEach((sp, i) => {
      const v = k.serie[String(sp.n)];
      s += v != null ? `<circle class="pt" cx="${x3(i)}" cy="${yOf(sc, v)}" r="4.5" fill="${col}"><title>#${sp.n}: ${fmt(v)}</title></circle>` : `<circle class="miss" cx="${x3(i)}" cy="${H - PB}" r="3"/>`;
    });
  }
  xs3.forEach((sp, i) => { s += `<text class="sp ${sp.proj ? 'proj' : ''}" x="${x3(i)}" y="${H - 6}" text-anchor="middle">#${sp.n}${sp.proj ? '*' : ''}</text>`; });
  xs4.forEach((sp, i) => {
    const v = q4?.serie?.[String(sp.n)];
    s += v != null ? `<circle class="pt" cx="${x4(i)}" cy="${yOf(sc, v)}" r="4.5" fill="var(--accent)"><title>#${sp.n}: ${fmt(v)}</title></circle>` : `<circle class="miss" cx="${x4(i)}" cy="${H - PB}" r="3"/>`;
    s += `<text class="sp ${sp.proj ? 'proj' : ''}" x="${x4(i)}" y="${H - 6}" text-anchor="middle">#${sp.n}${sp.proj ? '*' : ''}</text>`;
  });
  if (q4) {
    const a = q4.v.alvo == null || q4.v.alvo === '' ? null : Number(q4.v.alvo);
    const ty = yOf(sc, a ?? (k?.alvo ?? (sc.lo + sc.hi) / 2));
    const lbl = a == null ? 'arraste para definir o alvo' : `alvo ${q4.v.direcao || ''} ${fmt(a)}${q4.v.unidade ? ` ${q4.v.unidade}` : ''}`;
    s += `<g class="tq-tgt4 ${a == null ? 'vazio' : ''} ${state.tv ? '' : 'drag'}" data-slot="${esc(row.slot)}"><line class="hit" x1="${MID + GAP}" x2="${W - 8}" y1="${ty}" y2="${ty}"/><line class="t4" x1="${MID + GAP}" x2="${W - 8}" y1="${ty}" y2="${ty}"/><circle class="h" cx="${W - 22}" cy="${ty}" r="8"/><text class="tl4" x="${W - 38}" y="${ty - 8}" text-anchor="end">${esc(lbl)}</text></g>`;
  }
  return `${s}</svg>`;
}

// ---------- desenho ----------
const pills = (M, x) => `<span class="pill ${M.regra[x.id].cls}" title="Status pela regra">${esc(M.regra[x.id].txt)}</span><span class="pill" title="Status no Notion">Notion: ${esc(x.status || '—')}</span>`;
const GRAU_TXT = { Objetivo: 'Objetivo', 'Resultado-Chave': 'Resultado-Chave', KPI: 'KPI' };
const GRAU_CLS = { Objetivo: 'g-o', 'Resultado-Chave': 'g-k', KPI: 'g-i' };
const lbl = (txt, grau) => (txt ? `<span class="tq-lbl ${GRAU_CLS[grau]}">${esc(txt)}</span>` : '');

function q3Cell(M, x, grau) {
  if (!x) return '<div class="tq-cell vazio"></div>';
  const regra = finalPelaRegra(M.regra[x.id]);
  const fim = state.tv ? '' : `<label class="tq-c">Status final <select data-fim="${x.id}"><option value="">não mudar${regra ? ` (regra: ${esc(regra)})` : ''}</option>${STATUS_FINAL.map((s) => `<option ${draft.fim[x.id] === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>`;
  return `<div class="tq-cell q3"><div class="tq-h"><span class="eyebrow">${lbl(x.label, grau)} ${GRAU_TXT[grau]}</span><a href="${esc(x.url)}" target="_blank" rel="noopener" title="Abrir no Notion">↗</a></div><div class="t">${grau === 'Objetivo' ? `${esc(x.icone)} ` : ''}${esc(x.titulo)}</div><div class="tq-pills">${pills(M, x)}</div>${grau === 'KPI' ? scoreHTML(x) : ''}${fim ? `<div class="tq-ctl">${fim}</div>` : ''}</div>`;
}

function q4Cell(row, grau) {
  const n = row.q4; const ro = state.tv;
  if (!n || n.abortado) {
    const restaurar = n && !n.notionAbortado && !n.porPai && !ro ? `<button type="button" class="btn small" data-restaurar="${esc(row.slot)}">↺ restaurar</button>` : '';
    const dup = row.q3 && !n && !ro && (grau === 'Objetivo' || row.podeDup) ? `<button type="button" class="btn small" data-dup="${esc(row.q3.id)}" data-grau="${grau}">${grau === 'Objetivo' ? 'duplicar objetivo (com KRs e KPIs)' : grau === 'KPI' ? 'duplicar KPI' : 'duplicar KR (com KPIs)'} →</button>` : '';
    const msg = n?.notionAbortado ? 'abortado no Notion' : n?.porPai ? 'abortado junto com o item principal' : n?.abortado ? 'abortado — não segue para o trimestre' : '';
    return `<div class="tq-cell vazio q4">${msg ? `<span class="hint">${msg}</span>` : ''}${dup}${restaurar}</div>`;
  }
  const tag = n.kind === 'copy' ? '<span class="pill st-run">cópia · a criar</span>' : n.kind === 'novo' ? '<span class="pill st-run">novo · a criar</span>' : `<span class="pill">no Notion</span>${edited(n) ? '<span class="pill st-warn">editado</span>' : ''}`;
  const origemTxt = n.kind === 'copy' ? ` <span class="tq-de">cópia de ${esc(n.src.label)}</span>` : '';
  const head = `<div class="tq-h"><span class="eyebrow">${lbl(n.label || (n.kind === 'copy' ? n.src.label : n.kind === 'novo' ? 'novo' : ''), grau)} ${GRAU_TXT[grau]}${origemTxt}</span>${n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener" title="Abrir no Notion">↗</a>` : ''}</div>`;
  if (ro) return `<div class="tq-cell q4">${head}<div class="t">${esc(n.v.titulo)}</div><div class="tq-pills">${tag}${grau === 'KPI' && n.v.alvo != null ? `<span class="pill">alvo ${esc(n.v.direcao || '')} ${fmt(Number(n.v.alvo))} ${esc(n.v.unidade || '')}</span>` : ''}</div></div>`;
  const s = esc(n.slot);
  const kpiCtl = grau === 'KPI' ? `<div class="tq-kctl"><label class="tq-c">Alvo <input type="number" step="any" data-campo="alvo" data-slot="${s}" value="${n.v.alvo ?? ''}"></label><label class="tq-c">Direção <select data-campo="direcao" data-slot="${s}"><option value=""></option>${DIRS.map((d) => `<option ${n.v.direcao === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label><label class="tq-c">Unidade <select data-campo="unidade" data-slot="${s}"><option value=""></option>${[...new Set([...UNIDADES, n.v.unidade].filter(Boolean))].map((u) => `<option ${n.v.unidade === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></label></div>` : '';
  const add = grau === 'Objetivo' ? `<button type="button" class="btn small" data-add="Resultado-Chave" data-pai="${s}">＋ KR</button>` : grau === 'Resultado-Chave' ? `<button type="button" class="btn small" data-add="KPI" data-pai="${s}">＋ KPI</button>` : '';
  const del = n.kind === 'novo' ? `<button type="button" class="btn small" data-remover="${s}">remover</button>` : `<button type="button" class="btn small tq-abort" data-abortar="${s}">abortar</button>`;
  return `<div class="tq-cell q4 ${n.kind}">${head}<textarea class="tq-txt" rows="2" data-campo="titulo" data-slot="${s}" placeholder="Descrição ${grau === 'KPI' ? 'do KPI' : grau === 'Objetivo' ? 'do objetivo' : 'do KR'}…">${esc(n.v.titulo)}</textarea><div class="tq-pills">${tag}</div>${kpiCtl}<div class="tq-ctl">${add}${del}</div></div>`;
}

const kpiRow = (M, r) => `<div class="tq-row kpi"><div class="tq-pair">${q3Cell(M, r.q3, 'KPI')}${q4Cell(r, 'KPI')}</div>${chart(r, M)}</div>`;
// faixa fixa do KR: fica sob o cabeçalho do objetivo enquanto se rola pelos KPIs dele
function krFaixa(r) {
  const x = r.q3 || r.q4; const titulo = r.q3 ? r.q3.titulo : (r.q4?.v.titulo || 'KR novo');
  const label = r.q3?.label || r.q4?.label || (r.q4?.kind === 'novo' ? 'novo' : '');
  const lado = !r.q4 ? 'sem cópia' : r.q4.abortado ? 'abortado' : r.q4.kind === 'exist' ? 'no Notion' : 'a criar';
  return x ? `<div class="tq-krh">${lbl(label, 'Resultado-Chave')}<span class="t">${esc(titulo)}</span><span class="hint">${r.kpis.length} KPIs · ${esc(triLabel(pg.plan))}: ${lado}</span></div>` : '';
}
const krRow = (M, r) => `<div class="tq-row kr">${krFaixa(r)}<div class="tq-pair">${q3Cell(M, r.q3, 'Resultado-Chave')}${q4Cell(r, 'Resultado-Chave')}</div>${r.kpis.map((k) => kpiRow(M, k)).join('')}</div>`;
function grupo(M, g) {
  const titulo = g.q3 ? `${g.q3.label} · ${g.q3.titulo}` : `${triLabel(pg.plan)} · ${g.q4?.v.titulo || 'objetivo novo'}`;
  return `<details class="tq-grp" data-id="${esc(g.slot)}" ${pg.closed.has(g.slot) ? '' : 'open'}><summary><span>${lbl(g.q3?.label || g.q4?.label || 'novo', 'Objetivo')} ${esc((g.q3 ? g.q3.titulo : titulo).slice(0, 160))}</span><span class="hint">${g.krs.length} KRs · ${g.krs.reduce((a, r) => a + r.kpis.length, 0)} KPIs</span></summary><div class="tq-row obj"><div class="tq-pair">${q3Cell(M, g.q3, 'Objetivo')}${q4Cell(g, 'Objetivo')}</div></div>${g.krs.map((r) => krRow(M, r)).join('')}</details>`;
}

function seletores() {
  const base = S.D.trimestre.id;
  const revs = [...new Set([-3, -2, -1, 0, 1].map((d) => quarterShift(base, d)).concat(pg.rev))].sort();
  const plans = [1, 2].map((d) => quarterShift(pg.rev, d));
  const opt = (list, v) => list.map((t) => `<option value="${esc(t)}" ${t === v ? 'selected' : ''}>${esc(triLabel(t))}</option>`).join('');
  return `<label class="ctl">Revisar <select id="tq-rev">${opt(revs, pg.rev)}</select></label><label class="ctl">Planejar <select id="tq-plan">${opt(plans, pg.plan)}</select></label>`;
}

function barra(M) {
  const c = contagem(M); const total = c.criar + c.editar + c.abortar + c.fim;
  const pode = !!S.meta?.pode_gravar && !state.tv;
  return `<div class="tq-bar"><span><b>${esc(triLabel(pg.rev))}</b>: ${M.R.D.objetivos.length} objetivos · ${M.R.D.krs.length} KRs · ${M.R.D.kpis.length} KPIs</span><span><b>${esc(triLabel(pg.plan))}</b> no Notion: ${M.P.D.objetivos.length} objetivos · ${M.P.D.krs.length} KRs · ${M.P.D.kpis.length} KPIs</span><span class="pill st-run" id="tq-cont">rascunho: ${c.criar} a criar · ${c.editar} editados · ${c.abortar} abortados · ${c.fim} status finais</span><span class="spacer"></span>${state.tv ? '' : `<button class="btn small" id="tq-novo-obj">＋ objetivo em ${esc(triLabel(pg.plan))}</button><button class="btn small" id="tq-descartar" ${total ? '' : 'disabled'}>Descartar rascunho</button><button class="btn primary" id="tq-gravar" ${total && pode ? '' : 'disabled'} title="${pode ? 'Mostra o plano de escrita antes de gravar' : 'Somente leitura: o rascunho fica só neste navegador'}">Gravar no Notion${total ? ` (${total})` : ''}</button>`}</div>`;
}

function paint() {
  const el = $('#page-trimestral');
  if (!el || el.hidden) return;
  // não redesenha enquanto alguém digita: espera sair do campo
  if (el.contains(document.activeElement) && document.activeElement.matches('input:not([type=checkbox]),textarea')) { pg.pending = true; return; }
  pg.pending = false;
  const M = model();
  const head = `<div class="page-h"><h2>Trimestral · OKRs de P&amp;D</h2>${seletores()}<p>À esquerda, a revisão de ${esc(triLabel(pg.rev))}; à direita, ${esc(triLabel(pg.plan))}. Duplique o objetivo (vem com KRs e KPIs), edite os textos, arraste o alvo no gráfico, aborte o que não segue ou acrescente KRs e KPIs. Tudo fica num rascunho neste navegador até <b>Gravar no Notion</b>, que mostra o plano de escrita antes. Sprints com * são projetadas.</p></div>`;
  if (!M) {
    el.innerHTML = `${head}<div class="panel">${pg.err ? `<div class="banner crit">Não foi possível ler o Notion: ${esc(pg.err)} <button class="btn small" id="tq-retry">Tentar de novo</button></div>` : '<div class="empty">Lendo os OKRs dos dois trimestres no Notion…</div>'}</div>`;
    bindHead(el);
    const r = el.querySelector('#tq-retry'); if (r) r.onclick = () => ensure(true);
    return;
  }
  const y = window.scrollY;
  el.innerHTML = `${head}${barra(M)}<div class="tq-cols"><div>${esc(triLabel(pg.rev))} · revisão</div><div>${esc(triLabel(pg.plan))} · planejamento</div></div>${M.grupos.map((g) => grupo(M, g)).join('<hr class="tq-div">') || '<div class="empty">Nenhum objetivo de P&amp;D nos dois trimestres.</div>'}`;
  window.scrollTo(0, y);
  const bar = el.querySelector('.tq-bar'); if (bar) el.style.setProperty('--tq-bar', `${bar.offsetHeight}px`);
  const sum = el.querySelector('.tq-grp>summary'); if (sum) el.style.setProperty('--tq-obj', `${sum.offsetHeight}px`);
  bindHead(el); bind(el, M);
}

function bindHead(el) {
  const rev = el.querySelector('#tq-rev'); const plan = el.querySelector('#tq-plan');
  rev.onchange = () => { pg.rev = rev.value; pg.plan = quarterShift(pg.rev, 1); loadDraft(); paint(); ensure(); };
  plan.onchange = () => { pg.plan = plan.value; loadDraft(); paint(); ensure(); };
}

// marca o item e toda a subárvore do revisado para duplicar
function marcarDup(M, id, grau) {
  const I = M.R.I;
  const marca = (x) => { draft.dup[x] = true; delete draft.abort[`q:${x}`]; };
  const kpis = (krId) => I.kpisOf(krId).forEach((k) => marca(k.id));
  marca(id);
  if (grau === 'Objetivo') I.krsOf(id).forEach((kr) => { marca(kr.id); kpis(kr.id); });
  else if (grau === 'Resultado-Chave') kpis(id);
}

function bind(el, M) {
  const repaint = () => { saveDraft(); paint(); };
  const contador = () => {
    const c = contagem(model()); const total = c.criar + c.editar + c.abortar + c.fim;
    const b = el.querySelector('#tq-cont'); if (b) b.textContent = `rascunho: ${c.criar} a criar · ${c.editar} editados · ${c.abortar} abortados · ${c.fim} status finais`;
    const g = el.querySelector('#tq-gravar'); if (g) { g.disabled = !(total && S.meta?.pode_gravar && !state.tv); g.textContent = `Gravar no Notion${total ? ` (${total})` : ''}`; }
    const d = el.querySelector('#tq-descartar'); if (d) d.disabled = !total;
  };
  $$('[data-dup]', el).forEach((b) => { b.onclick = () => { marcarDup(M, b.dataset.dup, b.dataset.grau); repaint(); }; });
  $$('[data-abortar]', el).forEach((b) => { b.onclick = () => { draft.abort[b.dataset.abortar] = true; repaint(); }; });
  $$('[data-restaurar]', el).forEach((b) => { b.onclick = () => { delete draft.abort[b.dataset.restaurar]; repaint(); }; });
  $$('[data-remover]', el).forEach((b) => {
    b.onclick = () => {
      const tira = (key) => { draft.novos.filter((n) => n.pai === key).forEach((n) => tira(n.key)); draft.novos = draft.novos.filter((n) => n.key !== key); delete draft.edit[key]; };
      tira(b.dataset.remover); repaint();
    };
  });
  $$('[data-add]', el).forEach((b) => { b.onclick = () => { draft.novos.push({ key: novoKey(), grau: b.dataset.add, pai: b.dataset.pai }); repaint(); }; });
  const novoObj = el.querySelector('#tq-novo-obj');
  if (novoObj) novoObj.onclick = () => { draft.novos.push({ key: novoKey(), grau: 'Objetivo', pai: null }); repaint(); window.scrollTo(0, document.body.scrollHeight); };
  $$('[data-campo]', el).forEach((i) => {
    const set = () => {
      const e = draft.edit[i.dataset.slot] = draft.edit[i.dataset.slot] || {};
      e[i.dataset.campo] = i.value === '' ? null : i.dataset.campo === 'alvo' ? Number(i.value) : i.value;
      saveDraft(); contador();
    };
    if (i.tagName === 'SELECT') i.onchange = () => { set(); paint(); };
    else { i.oninput = set; if (i.dataset.campo === 'alvo') i.onchange = () => { set(); i.blur(); paint(); }; }
  });
  $$('[data-fim]', el).forEach((s) => { s.onchange = () => { if (s.value) draft.fim[s.dataset.fim] = s.value; else delete draft.fim[s.dataset.fim]; repaint(); }; });
  $$('details[data-id]', el).forEach((d) => { d.ontoggle = () => { if (d.open) pg.closed.delete(d.dataset.id); else pg.closed.add(d.dataset.id); }; });
  const desc = el.querySelector('#tq-descartar');
  if (desc) desc.onclick = () => { if (confirm('Descartar todo o rascunho (duplicações, edições, abortos, itens novos e status finais)?')) { draft = emptyDraft(); repaint(); } };
  const grv = el.querySelector('#tq-gravar');
  if (grv) {
    // modelo refeito na hora: textos digitados depois do último desenho entram no plano
    grv.onclick = () => requestWrite('okr.trimestre', { rev: pg.rev, plan: pg.plan, itens: itensDoRascunho(model()), statusFinal: statusFinal() }, {
      tri: pg.rev,
      onDone: (fim) => { if (fim.ok) { draft = emptyDraft(); saveDraft(); pg.data = {}; ensure(true); toast('Gravado no Notion — rascunho limpo'); } },
    });
  }
  bindDrag(el);
  if (!el.dataset.focusout) {
    el.dataset.focusout = '1';
    el.addEventListener('focusout', () => setTimeout(() => {
      const a = document.activeElement;
      if (pg.pending && !(el.contains(a) && a.matches('input:not([type=checkbox]),textarea'))) paint();
    }, 0));
  }
}

// Arrastar o alvo do planejado no gráfico (escala fixa durante o arraste, valor arredondado a um passo "redondo").
function bindDrag(el) {
  $$('.tq-tgt4.drag', el).forEach((g) => {
    g.onpointerdown = (e) => {
      e.preventDefault();
      const svg = g.ownerSVGElement; const sc = { lo: Number(svg.dataset.lo), hi: Number(svg.dataset.hi) };
      const step = niceStep(sc.hi - sc.lo);
      const slot = g.dataset.slot;
      const input = el.querySelector(`input[data-campo="alvo"][data-slot="${CSS.escape(slot)}"]`);
      const toY = (ev) => { const r = svg.getBoundingClientRect(); return ((ev.clientY - r.top) / r.height) * H; };
      const n = (draft.edit[slot] || {}); const t0 = g.querySelector('text').textContent;
      const dir = n.direcao ?? (/alvo (\S+) /.exec(t0)?.[1] || ''); const uni = (/alvo \S+ [\d.,-]+ (.+)$/.exec(t0)?.[1]) || '';
      const y0 = e.clientY; let moveu = false;
      g.setPointerCapture(e.pointerId); g.classList.add('arrastando');
      const move = (ev) => {
        const v = snapTo(vOf(sc, Math.max(4, Math.min(H - PB, toY(ev)))), step); const ty = yOf(sc, v);
        g.querySelectorAll('line').forEach((l) => { l.setAttribute('y1', ty); l.setAttribute('y2', ty); });
        g.querySelector('circle').setAttribute('cy', ty);
        const t = g.querySelector('text'); t.setAttribute('y', ty - 8); t.textContent = `alvo ${['≥', '≤', '='].includes(dir) ? `${dir} ` : ''}${fmt(v)}${uni ? ` ${uni}` : ''}`;
        if (input) input.value = v;
        g.dataset.v = v;
      };
      g.onpointermove = (ev) => { if (!moveu && Math.abs(ev.clientY - y0) < 3) return; moveu = true; move(ev); };
      g.onpointerup = () => {
        g.onpointermove = null; g.onpointerup = null; g.classList.remove('arrastando');
        if (!moveu) return; // clique sem arrastar não muda o alvo
        const e2 = draft.edit[slot] = draft.edit[slot] || {}; e2.alvo = Number(g.dataset.v); saveDraft(); paint();
      };
    };
  });
}
