// Planos de escrita + executor contra o Notion falso: o que o plano mostra é o que é gravado,
// relações são acumulativas, remoções aparecem explícitas, conflitos param, nada duplica ao refazer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeWithDemo, snapshotOf, ecState } from './helpers.js';
import { buildPlan } from '../server/writes/plans.js';
import { createExecutor } from '../server/writes/executor.js';
import { read, blockText } from '../server/notion/props.js';
import { createFakeNotion } from '../server/notion/fake.js';
import { createApi } from '../server/notion/client.js';
import { noLimiter } from '../server/notion/limiter.js';

const EMAIL = 'lider@bsvrobotics.com.br';

async function setup() {
  const { fake, api } = fakeWithDemo();
  const D = await snapshotOf(api);
  const audit = [];
  const ex = createExecutor({ api, audit: (o) => audit.push(o) });
  const run = async (acao, dados, d = D) => {
    const plan = await buildPlan(acao, { api, D: d, dados, email: EMAIL });
    if (plan.bloqueios.length) return { plan, fim: null };
    const planId = ex.store(plan, EMAIL);
    const eventos = [];
    const fim = await ex.exec(planId, EMAIL, (e) => eventos.push(e));
    return { plan, fim, eventos, planId };
  };
  const metasComSub = D.metas.filter((m) => !m.fora && m.subs.length && m.sprints.includes(D.sprint));
  return { fake, api, D, ex, run, audit, metasComSub };
}

test('dependência: acrescenta em "Bloqueado por" e o Notion espelha em "Bloqueando"', async () => {
  const { fake, run, metasComSub } = await setup();
  const [a, b] = [metasComSub[6], metasComSub[7]];
  const { plan, fim } = await run('dependencia.criar', { bloqueada: a.id, bloqueadora: b.id });
  assert.equal(plan.linhas.length, 1);
  assert.match(plan.linhas[0].novo, /^\+ /);
  assert.ok(fim.ok);
  assert.ok(read(fake.page(a.id), 'metas', 'bloqueadoPor').includes(b.id));
  assert.ok(read(fake.page(b.id), 'metas', 'bloqueando').includes(a.id));
  // bloqueios anteriores continuam (acumulativo)
  for (const x of a.bloq) assert.ok(read(fake.page(a.id), 'metas', 'bloqueadoPor').includes(x));
});

test('plano de uso único e só de quem gerou', async () => {
  const { api, D, ex, metasComSub } = await setup();
  const plan = await buildPlan('meta.status', { api, D, dados: { meta: metasComSub[0].id, status: 'Abortado' }, email: EMAIL });
  const id = ex.store(plan, EMAIL);
  assert.throws(() => ex.exec(id, 'outra@bsvrobotics.com.br'), /outra pessoa/);
  await ex.exec(id, EMAIL);
  assert.throws(() => ex.exec(id, EMAIL), /já foi executado/);
});

test('mover de subsistema: remoção aparece como linha própria e é gravada', async () => {
  const { fake, D, run, metasComSub } = await setup();
  const m = metasComSub.find((x) => x.subs.length === 1);
  const destino = D.tree.find((n) => n.tipo === 'Subsistema' && !m.subs.includes(n.id));
  const { plan, fim } = await run('meta.mover', { meta: m.id, de: m.subs[0], para: destino.id });
  assert.equal(plan.linhas.filter((l) => l.remocao).length, 1);
  assert.ok(fim.ok);
  assert.deepEqual(read(fake.page(m.id), 'metas', 'subsistema'), [destino.id]);
});

test('Entregável-Chave: mover da lane do pai tira o EC; editar sem mexer na lane mantém o vínculo', async () => {
  const { state, ids } = ecState();
  const fake = createFakeNotion(state);
  const api = createApi(fake.client, { limiter: noLimiter });
  const D = await snapshotOf(api);
  const ex = createExecutor({ api, audit: () => {} });
  const run = async (acao, dados) => {
    const plan = await buildPlan(acao, { api, D, dados, email: EMAIL });
    return { plan, fim: plan.bloqueios.length ? null : await ex.exec(ex.store(plan, EMAIL), EMAIL) };
  };

  // editar o título com a lane exibida (subsistema pai) não troca o EC pelo pai
  const ed = await run('meta.editar', { meta: ids.mEc, titulo: 'Validar o reabastecimento em campo', subs: [ids.sub] });
  assert.ok(!ed.plan.linhas.some((l) => l.campo.startsWith('Subsistema')), 'nenhuma linha de Subsistema');
  assert.deepEqual(read(fake.page(ids.mEc), 'metas', 'subsistema'), [ids.ecSub]);

  // arrastar da lane "Reabastecimento" para "Insumos": sai o EC (linha explícita, com o nome dele), entra o destino
  const mv = await run('meta.mover', { meta: ids.mEc, de: ids.sub, para: ids.sis });
  const rem = mv.plan.linhas.filter((l) => l.remocao);
  assert.equal(rem.length, 1);
  assert.match(rem[0].atual, /EC do subsistema \(Entregável-Chave\)/);
  assert.ok(mv.fim.ok);
  assert.deepEqual(read(fake.page(ids.mEc), 'metas', 'subsistema'), [ids.sis]);

  // meta ligada ao subsistema e ao EC dele: mover tira os dois, cada um na sua linha
  const mv2 = await run('meta.mover', { meta: ids.mAmbos, de: ids.sub, para: ids.sis });
  assert.equal(mv2.plan.linhas.filter((l) => l.remocao).length, 2);
  assert.deepEqual(read(fake.page(ids.mAmbos), 'metas', 'subsistema'), [ids.sis]);
});

test('abortar com conflito: se o status mudou no Notion depois do plano, nada é gravado', async () => {
  const { fake, api, D, ex, metasComSub } = await setup();
  const m = metasComSub[1];
  const plan = await buildPlan('meta.status', { api, D, dados: { meta: m.id, status: 'Abortado' }, email: EMAIL });
  // alguém muda no Notion entre o plano e a gravação
  await fake.client.pages.update({ page_id: m.id, properties: { Status: { status: { name: 'Concluído' } } } });
  const fim = await ex.exec(ex.store(plan, EMAIL), EMAIL);
  assert.equal(fim.ok, false);
  assert.ok(fim.erro.conflito);
  assert.equal(read(fake.page(m.id), 'metas', 'status'), 'Concluído');
});

test('nova meta a partir de desejo: cria página com corpo e registra decisão no desejo; refazer não duplica', async () => {
  const { fake, D, run } = await setup();
  const desejo = D.desejos[0];
  const dados = { titulo: 'Elaborar requisito de aviso de bateria', area: 'el', objetivo: D.objetivos[0].id, subs: desejo.subs, status: 'Não iniciada', criterio: 'Requisito aprovado', desejo: desejo.id, sprint: D.sprint };
  const { plan, fim } = await run('meta.criar', dados);
  assert.ok(fim.ok, JSON.stringify(fim.erro));
  assert.ok(plan.avisos.some((a) => /chat P&D – Liderança/.test(a)));
  const criada = [...fake.pages.values()].filter((p) => read(p, 'metas', 'titulo') === dados.titulo);
  assert.equal(criada.length, 1);
  assert.equal(read(criada[0], 'metas', 'status'), 'Não iniciada');
  assert.deepEqual(read(criada[0], 'metas', 'area'), [D.areas.el.id]);
  const corpo = fake.blocksOf(criada[0].id).map(blockText);
  assert.deepEqual(corpo.slice(0, 2), ['Critério de conclusão', 'Requisito aprovado']);
  const noDesejo = fake.blocksOf(desejo.id).map(blockText);
  assert.equal(noDesejo[0], 'Decisão da reunião tática');
  assert.match(noDesejo[1], /Meta de elaboração criada: "Elaborar requisito de aviso de bateria" https:\/\//);
  // mesmo pedido de novo → reaproveita a página
  const again = await run('meta.criar', dados);
  assert.ok(again.fim.ok);
  assert.equal([...fake.pages.values()].filter((p) => read(p, 'metas', 'titulo') === dados.titulo).length, 1);
});

test('título sem verbo e meta sem objetivo geram avisos; sem equipe bloqueia', async () => {
  const { api, D } = await setup();
  const p1 = await buildPlan('meta.criar', { api, D, email: EMAIL, dados: { titulo: 'Relatório de testes', area: 'sw', subs: [] } });
  assert.ok(p1.avisos.some((a) => /verbo/.test(a)));
  assert.ok(p1.avisos.some((a) => /objetivo/.test(a)));
  const p2 = await buildPlan('meta.criar', { api, D, email: EMAIL, dados: { titulo: 'Testar', area: 'nao-existe' } });
  assert.ok(p2.bloqueios.length);
});

test('medição de KPI: cria a linha KPI × Sprint; com linha existente, troca o valor', async () => {
  const { fake, D, run } = await setup();
  const semMed = D.kpis.find((k) => k.serie['27'] == null && k.alvo != null);
  const r1 = await run('kpi.medir', { kpi: semMed.id, sprint: 27, valor: '3,5' });
  assert.ok(r1.fim.ok);
  const linha = [...fake.pages.values()].find((p) => read(p, 'medicoes', 'titulo') === `${semMed.titulo} — Sprint #27`);
  assert.equal(read(linha, 'medicoes', 'valor'), 3.5);
  const comMed = D.kpis.find((k) => k.serie['26'] != null);
  const r2 = await run('kpi.medir', { kpi: comMed.id, sprint: 26, valor: 9 });
  assert.equal(r2.plan.linhas[0].atual, comMed.serie['26']);
  assert.ok(r2.fim.ok);
  assert.equal(read(fake.page(comMed.medicoes['26']), 'medicoes', 'valor'), 9);
});

test('rollover: cria a #28, revincula metas e tarefas (acumulativo), registra histórico, mede e fecha a sprint', async () => {
  const { fake, D, run, audit } = await setup();
  const metas = D.metas.filter((m) => m.sprints.includes(27) && !m.fora && !['Concluído', 'Abortado'].includes(m.status)).slice(0, 3);
  const tarefas = D.tarefas.slice(0, 2);
  const kpi = D.kpis.find((k) => k.alvo != null && k.serie['27'] == null);
  const dados = { sprint: 27, metas: metas.map((m) => m.id), tarefas: tarefas.map((t) => t.id), medicoes: [{ kpi: kpi.id, valor: '1' }], fechar: true };
  const { plan, fim } = await run('rollover', dados);
  assert.ok(fim.ok, JSON.stringify(fim.erro));
  assert.deepEqual([...new Set(plan.linhas.map((l) => l.passo))], ['R1', 'R2', 'R3', 'R4', 'R6']);
  const s28 = [...fake.pages.values()].filter((p) => read(p, 'sprints', 'numero') === 28);
  assert.equal(s28.length, 1);
  assert.equal(read(s28[0], 'sprints', 'status'), 'Em andamento');
  assert.deepEqual(read(s28[0], 'sprints', 'data'), { start: '2026-09-28', end: '2026-10-09' });
  const s27 = D.sprints.find((s) => s.n === 27);
  assert.equal(read(fake.page(s27.id), 'sprints', 'status'), 'Concluído');
  for (const m of metas) {
    const sp = read(fake.page(m.id), 'metas', 'sprint');
    assert.ok(sp.includes(s28[0].id) && sp.includes(s27.id), 'mantém a #27 e acrescenta a #28');
    const hist = fake.blocksOf(m.id).map(blockText);
    assert.equal(hist[0], 'Histórico de sprints');
    assert.match(hist[1], /^Sprint #27 → #28: rollover/);
  }
  for (const t of tarefas) assert.ok(read(fake.page(t.id), 'tarefas', 'sprint').includes(s28[0].id));
  assert.equal(audit.length, 1);
  assert.equal(audit[0].email, EMAIL);

  // Rollover de novo com o snapshot antigo: não cria outra #28 nem duplica relações
  const again = await run('rollover', { ...dados, fechar: false });
  assert.ok(again.fim.ok, JSON.stringify(again.fim.erro));
  assert.equal([...fake.pages.values()].filter((p) => read(p, 'sprints', 'numero') === 28).length, 1);
  for (const m of metas) assert.equal(read(fake.page(m.id), 'metas', 'sprint').filter((id) => id === s28[0].id).length, 1);
});
