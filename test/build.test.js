// Notion → objeto D: o snapshot reconstruído do Notion falso reproduz os dados do mock, e os casos
// difíceis da API (relação > 25 itens, "Fazendo", convidado sem nome, bloqueadora fora da sprint) são tratados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeWithDemo, snapshotOf, readMockData, ecState } from './helpers.js';
import { createFakeNotion, makePage } from '../server/notion/fake.js';
import { createApi } from '../server/notion/client.js';
import { noLimiter } from '../server/notion/limiter.js';
import { buildIndex } from '../web/js/store.js';
import { computeAlerts } from '../web/js/rules.js';

test('snapshot do Notion reproduz o D do mock (objetivos, KRs, KPIs, metas, projetos)', async () => {
  const M = readMockData();
  const { api } = fakeWithDemo();
  const D = await snapshotOf(api);
  assert.equal(D.sprint, 27);
  assert.deepEqual(D.sprints.map((s) => s.n), M.sprints.map((s) => s.n));
  assert.deepEqual(D.sprints_tri, [23, 24, 25, 26, 27]);
  assert.equal(D.trimestre.id, '2026 - 3');
  assert.deepEqual(D.objetivos.map((o) => o.titulo), M.objetivos.map((o) => o.titulo));
  assert.deepEqual(D.objetivos.map((o) => o.label), ['O1', 'O2', 'O3', 'O4', 'O5']);
  assert.equal(D.krs.length, M.krs.length);
  assert.equal(D.kpis.length, M.kpis.length);

  // série de cada KPI igual à do mock
  const serieMock = Object.fromEntries(M.kpis.map((k) => [k.titulo, k.serie]));
  for (const k of D.kpis) assert.deepEqual(k.serie, serieMock[k.titulo], k.titulo);

  // os mesmos 4 projetos do mock
  const I = buildIndex(D);
  assert.deepEqual(Object.keys(D.projetos).map((id) => I.byId[id].nome).sort(), ['mini', 'scout', 'dados', 'exp'].map((id) => M.tree.find((n) => n.id === id).nome).sort());

  // metas: mesmos títulos, status e caminhos de subsistema
  const MI = { byId: Object.fromEntries(M.tree.map((n) => [n.id, n])) };
  const pathM = (id) => { const p = []; let n = MI.byId[id]; while (n && n.id !== 'outros') { p.unshift(n.nome); n = n.pai ? MI.byId[n.pai] : null; } return p.join(' › '); };
  const pathD = (id) => I.pathOf(id).filter((x) => !x.startsWith('Fora dos projetos')).join(' › ');
  const metas = D.metas.filter((m) => !m.fora);
  assert.equal(metas.length, M.metas.length);
  for (const mm of M.metas) {
    const m = metas.find((x) => x.titulo === mm.titulo);
    assert.ok(m, mm.titulo);
    assert.equal(m.status, mm.status);
    assert.deepEqual(m.sprints, mm.sprints);
    assert.deepEqual(m.subs.map(pathD).sort(), mm.subs.map(pathM).sort(), mm.titulo);
    assert.deepEqual(m.okrs.map((o) => I.objById[o].titulo).sort(), mm.okrs.map((o) => M.objetivos.find((x) => x.id === o).titulo).sort());
    assert.deepEqual([...m.okrs_extra].sort(), [...mm.okrs_extra].sort());
  }
});

test('alerta de objetivo apontando para projeto abortado', async () => {
  const { api } = fakeWithDemo();
  const D = await snapshotOf(api);
  const o2 = D.objetivos.find((o) => o.label === 'O2');
  assert.match(o2.alerta, /abortado/);
  assert.ok(!Object.keys(D.projetos).some((id) => D.tree.find((n) => n.id === id)?.status === 'Abortado'));
});

// ---------- casos da API ----------
function miniState() {
  const sprint = makePage({ base: 'sprints', props: { titulo: 'Sprint P&D #5', numero: 5, data: { start: '2026-09-14', end: '2026-09-25' }, status: 'Em andamento' } });
  const sprintAnt = makePage({ base: 'sprints', props: { titulo: 'Sprint P&D #4', numero: 4, data: { start: '2026-08-31', end: '2026-09-11' }, status: 'Concluído' } });
  const pd = makePage({ base: 'areas', props: { titulo: 'P&D', diretoria: 'P&D', nivel: 'Diretoria' } });
  const sw = makePage({ base: 'areas', props: { titulo: 'Software', diretoria: 'P&D', nivel: 'Equipe', pai: [pd.id] } });
  const proj = makePage({ base: 'projetos', props: { titulo: 'Robô X', tipo: 'Projeto', status: 'Em andamento', area: [pd.id], responsavel: [{ id: 'u-guest' }] } });
  const subs = Array.from({ length: 27 }, (_, i) => makePage({ base: 'projetos', props: { titulo: `Sub ${i}`, tipo: 'Subsistema', status: 'Não iniciado', pai: [proj.id] } }));
  const obj = makePage({ base: 'okrs', props: { titulo: 'Entregar o robô X', grau: 'Objetivo', trimestre: ['2026 - 3'], area: [sw.id], projetos: [proj.id] }, icon: '🤖' });
  const kr = makePage({ base: 'okrs', props: { titulo: 'KR do robô', grau: 'Resultado-Chave', pai: [obj.id] } });
  const kpi = makePage({ base: 'okrs', props: { titulo: 'Autonomia', grau: 'KPI', pai: [kr.id], alvo: 8, unidade: 'horas', direcao: '≥' } });
  const med = makePage({ base: 'medicoes', props: { titulo: 'Autonomia — Sprint #4', kpi: [kpi.id], sprint: [sprintAnt.id], valor: 6.5 } });
  const bloqueadora = makePage({ base: 'metas', props: { titulo: 'Comprar bateria', status: 'Não iniciada', sprint: [sprintAnt.id], area: [sw.id] } });
  const meta = makePage({ base: 'metas', props: { titulo: 'Integrar todos os subsistemas', status: 'Em andamento', sprint: [sprint.id], area: [sw.id], okr: [kr.id], subsistema: subs.map((s) => s.id), bloqueadoPor: [bloqueadora.id] } });
  const t1 = makePage({ base: 'tarefas', props: { titulo: 'Soldar', status: 'Fazendo', meta: [meta.id], sprint: [sprint.id] } });
  const t2 = makePage({ base: 'tarefas', props: { titulo: 'Testar', status: 'Concluída', meta: [meta.id] } });
  const pages = Object.fromEntries([sprint, sprintAnt, pd, sw, proj, ...subs, obj, kr, kpi, med, bloqueadora, meta, t1, t2].map((p) => [p.id, p]));
  return { state: { pages, users: { 'u-guest': { object: 'user', id: 'u-guest', name: 'Convidada Ana' } } }, ids: { meta: meta.id, bloqueadora: bloqueadora.id, obj: obj.id, kpi: kpi.id } };
}

test('relação com mais de 25 itens vem completa (pages.properties.retrieve)', async () => {
  const { state, ids } = miniState();
  const fake = createFakeNotion(state);
  const api = createApi(fake.client, { limiter: noLimiter });
  const D = await snapshotOf(api);
  const m = D.metas.find((x) => x.id === ids.meta);
  assert.equal(m.subs.length, 27);
  assert.ok(fake.log.some(([op]) => op === 'pages.properties.retrieve'), 'deveria buscar a relação completa');
});

test('"Fazendo" conta como Em Andamento; KR no campo OKR vira o objetivo; bloqueadora fora da sprint entra marcada', async () => {
  const { state, ids } = miniState();
  const api = createApi(createFakeNotion(state).client, { limiter: noLimiter });
  const D = await snapshotOf(api);
  const m = D.metas.find((x) => x.id === ids.meta);
  assert.equal(m.tarefas['Em Andamento'], 1);
  assert.equal(m.tarefas['Concluída'], 1);
  assert.deepEqual(m.okrs, [ids.obj]);
  const b = D.metas.find((x) => x.id === ids.bloqueadora);
  assert.ok(b && b.fora, 'bloqueadora fora da sprint deve vir no snapshot, marcada como fora');
  assert.deepEqual(b.sprints, [4]);
  assert.equal(D.kpis[0].serie['4'], 6.5);
  assert.equal(D.tree.find((n) => n.nome === 'Robô X').resp, 'Convidada Ana');
  assert.equal(D.areas.sw.nome, 'Software');
  assert.equal(D.areas.sw.ext, false);
});

// ---------- Entregável-Chave (saiu do modelo) ----------
test('Entregável-Chave não vira lane: sai da árvore e as metas aparecem no item pai', async () => {
  const { state, ids } = ecState();
  const api = createApi(createFakeNotion(state).client, { limiter: noLimiter });
  const D = await snapshotOf(api);
  const I = buildIndex(D);
  const meta = (id) => D.metas.find((m) => m.id === id);

  for (const ec of [ids.ecSub, ids.ecNeto, ids.ecSis]) assert.ok(!I.byId[ec], 'Entregável-Chave com pai não entra na árvore');
  assert.ok(I.isLane(I.byId[ids.sub]), 'o subsistema volta a ser folha (lane)');
  assert.deepEqual(D.ocultos.map((o) => o.id).sort(), [ids.ecSub, ids.ecNeto, ids.ecSis].sort());
  assert.equal(D.ocultos.find((o) => o.id === ids.ecNeto).pai, ids.sub, 'EC dentro de EC sobe até o primeiro item visível');

  assert.deepEqual(meta(ids.mEc).subs, [ids.sub]);
  assert.deepEqual(meta(ids.mEc).via_ec, { [ids.sub]: [{ id: ids.ecSub, nome: 'EC do subsistema' }] });
  assert.deepEqual(meta(ids.mNeto).subs, [ids.sub]);
  assert.deepEqual(meta(ids.mAmbos).subs, [ids.sub], 'subsistema e EC dele contam uma vez só');
  assert.deepEqual(meta(ids.mSis).subs, [ids.sis], 'EC de sistema → lane "metas ligadas ao sistema"');
  assert.ok(!('via_ec' in meta(ids.mSolto)));
  assert.deepEqual(D.desejos.find((d) => d.id === ids.desejo).subs, [ids.sub]);

  // sem pai não há onde exibir: continua visível em "outros", como antes
  assert.equal(I.byId[ids.ecSolto]?.pai, 'outros');
  assert.ok(!D.tree.some((n) => n.pai === 'outros' && n.id !== ids.ecSolto), 'só o EC sem pai vai para "outros"');

  const A = computeAlerts(D, I, { sprint: 5 });
  assert.ok(A.some((a) => a.t.includes('Validar o reabastecimento') && a.t.includes('Entregável-Chave "EC do subsistema"') && a.t.includes('Subsistema "Reabastecimento"')));
  assert.ok(!A.some((a) => a.t.includes('Integrar os insumos') && a.t.includes('não a um subsistema')), 'o alerta de EC substitui o de "não é subsistema"');
});
