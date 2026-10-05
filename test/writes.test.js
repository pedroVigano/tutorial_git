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

// ---------- reunião trimestral: rascunho gravado em lote ----------
test('trimestral: copia objetivo/KR/KPI com Origem e Trimestre novo, religa medições, cria KR novo, aplica status final; refazer não duplica', async () => {
  const { fake, api, D, run } = await setup();
  const o = D.objetivos[0];
  const kr = D.krs.find((k) => k.obj === o.id);
  const kpi = D.kpis.find((k) => k.kr === kr.id && Object.keys(k.medicoes).length);
  assert.ok(kpi, 'demo tem KPI com medição');
  const itens = [
    { key: `q:${o.id}`, grau: 'Objetivo', pai: null, origem: o.id, titulo: `${o.titulo} (Q4)`, ordem: 1 },
    { key: `q:${kr.id}`, grau: 'Resultado-Chave', pai: `q:${o.id}`, origem: kr.id, titulo: kr.titulo, ordem: 1 },
    { key: `q:${kpi.id}`, grau: 'KPI', pai: `q:${kr.id}`, origem: kpi.id, titulo: kpi.titulo, alvo: 42, unidade: kpi.unidade, direcao: '≥', ordem: 1 },
    { key: 'n:novo', grau: 'Resultado-Chave', pai: `q:${o.id}`, origem: null, titulo: 'KR novo do quarto trimestre', ordem: 9 },
  ];
  const dados = { rev: '2026 - 3', plan: '2026 - 4', itens, statusFinal: [{ id: kpi.id, status: 'Não atingido' }] };
  const { plan, fim } = await run('okr.trimestre', dados);
  assert.deepEqual(plan.bloqueios, []);
  assert.ok(fim.ok, JSON.stringify(fim?.erro));
  const novos = [...fake.pages.values()].filter((p) => read(p, 'okrs', 'trimestre').includes('2026 - 4'));
  assert.equal(novos.length, 4);
  const byTitle = (t) => novos.find((p) => read(p, 'okrs', 'titulo') === t);
  const oN = byTitle(`${o.titulo} (Q4)`); const krN = novos.find((p) => read(p, 'okrs', 'origem').includes(kr.id)); const kpiN = novos.find((p) => read(p, 'okrs', 'origem').includes(kpi.id));
  assert.deepEqual(read(oN, 'okrs', 'origem'), [o.id]);
  assert.deepEqual(read(krN, 'okrs', 'pai'), [oN.id]);
  assert.deepEqual(read(kpiN, 'okrs', 'pai'), [krN.id]);
  assert.equal(read(kpiN, 'okrs', 'alvo'), 42);
  assert.equal(read(kpiN, 'okrs', 'status'), 'Não iniciado');
  assert.equal(read(kpiN, 'okrs', 'limite')?.start, '2026-12-31');
  assert.deepEqual(read(byTitle('KR novo do quarto trimestre'), 'okrs', 'pai'), [oN.id]);
  // medições do KPI original agora também apontam para a cópia (acumulativo)
  for (const mId of Object.values(kpi.medicoes)) {
    const ks = read(fake.page(mId), 'medicoes', 'kpi');
    assert.ok(ks.includes(kpi.id) && ks.includes(kpiN.id));
  }
  assert.equal(read(fake.page(kpi.id), 'okrs', 'status'), 'Não atingido');

  // a cópia aparece no snapshot de 2026-4 com Origem e a série herdada
  const D4 = await snapshotOf(api, { tri: '2026 - 4' });
  const k4 = D4.kpis.find((k) => k.id === kpiN.id);
  assert.deepEqual(k4.origem, [kpi.id]);
  assert.deepEqual(k4.serie, kpi.serie);

  // refazer o mesmo rascunho não cria nada de novo
  const again = await run('okr.trimestre', { ...dados, statusFinal: [] });
  assert.ok(again.fim.ok);
  assert.equal([...fake.pages.values()].filter((p) => read(p, 'okrs', 'trimestre').includes('2026 - 4')).length, 4);
});

test('trimestral: edita e aborta itens existentes do trimestre planejado; descrição vazia bloqueia', async () => {
  const { fake, api, run } = await setup();
  // cria um objetivo com KR em 2026-4 e depois edita/aborta
  const D = await snapshotOf(api);
  const o = D.objetivos[1];
  await run('okr.trimestre', { rev: '2026 - 3', plan: '2026 - 4', itens: [
    { key: 'n:o', grau: 'Objetivo', pai: null, titulo: 'Objetivo só do Q4', ordem: 1 },
    { key: 'n:k', grau: 'Resultado-Chave', pai: 'n:o', titulo: 'KR só do Q4', ordem: 1 },
  ] });
  const oQ4 = [...fake.pages.values()].find((p) => read(p, 'okrs', 'titulo') === 'Objetivo só do Q4');
  const kQ4 = [...fake.pages.values()].find((p) => read(p, 'okrs', 'titulo') === 'KR só do Q4');
  const { plan, fim } = await run('okr.trimestre', { rev: '2026 - 3', plan: '2026 - 4', itens: [
    { key: `e:${oQ4.id}`, grau: 'Objetivo', pai: null, id: oQ4.id, titulo: 'Objetivo só do Q4 (revisado)' },
    { key: `e:${kQ4.id}`, grau: 'Resultado-Chave', pai: `e:${oQ4.id}`, id: kQ4.id, abortar: true, titulo: 'KR só do Q4' },
  ] });
  assert.ok(fim.ok, JSON.stringify(fim?.erro));
  assert.equal(plan.linhas.length, 2);
  assert.equal(read(fake.page(oQ4.id), 'okrs', 'titulo'), 'Objetivo só do Q4 (revisado)');
  assert.equal(read(fake.page(kQ4.id), 'okrs', 'status'), 'Abortado');
  const vazio = await run('okr.trimestre', { rev: '2026 - 3', plan: '2026 - 4', itens: [{ key: 'n:x', grau: 'Objetivo', pai: null, origem: o.id, titulo: '  ' }] });
  assert.ok(vazio.plan.bloqueios.some((b) => /vazia/.test(b)));
});

test('lote: plano único do rascunho — meta nova + dependência com ela + medição; refs por item; bloqueio de um item aparece', async () => {
  const { fake, api, D, ex, metasComSub } = await setup();
  const alvo = metasComSub[2];
  const k = D.kpis.find((x) => x.alvo != null && x.serie[String(D.sprint)] == null);
  const itens = [
    { id: 'c1', acao: 'meta.criar', dados: { titulo: 'Integrar sensores ao chassi', area: 'sw', sprint: D.sprint, subs: alvo.subs, objetivo: D.objetivos[0].id, tmp: 'tmp:c1' } },
    { id: 'c2', acao: 'dependencia.criar', dados: { bloqueada: alvo.id, bloqueadora: 'tmp:c1' } },
    { id: 'c3', acao: 'kpi.medir', dados: { kpi: k.id, sprint: D.sprint, valor: '2' } },
  ];
  const plan = await buildPlan('lote', { api, D, dados: { itens }, email: EMAIL });
  assert.deepEqual(plan.bloqueios, []);
  assert.deepEqual(plan.itens.map((i) => i.id), ['c1', 'c2', 'c3']);
  assert.ok(plan.linhas.every((l) => ['c1', 'c2', 'c3'].includes(l.item)), 'cada linha diz de que item vem');
  assert.equal(plan.opItens.length, plan.ops.length);
  assert.ok(plan.ops.some((o) => o.op === 'create' && o.ref === 'c1/meta'), 'ref da criação com o prefixo do item');
  const fim = await ex.exec(ex.store(plan, EMAIL), EMAIL);
  assert.ok(fim.ok, JSON.stringify(fim.erro));
  const criada = [...fake.pages.values()].find((p) => read(p, 'metas', 'titulo') === 'Integrar sensores ao chassi');
  assert.ok(read(fake.page(alvo.id), 'metas', 'bloqueadoPor').some((id) => id.replace(/-/g, '') === criada.id.replace(/-/g, '')), 'dependência ligada à meta recém-criada');
  // item inválido bloqueia, mas aparece com o motivo
  const p2 = await buildPlan('lote', { api, D, dados: { itens: [{ id: 'x', acao: 'meta.status', dados: { meta: alvo.id, status: 'Inexistente' } }, { id: 'y', acao: 'kpi.medir', dados: { kpi: k.id, sprint: D.sprint, valor: '3' } }] }, email: EMAIL });
  assert.equal(p2.itens.find((i) => i.id === 'x').bloqueios.length, 1);
  assert.ok(p2.bloqueios.length >= 1);
  // rollover só sozinho
  const p3 = await buildPlan('lote', { api, D, dados: { itens: [{ id: 'r', acao: 'rollover', dados: { sprint: D.sprint, metas: [], tarefas: [], medicoes: [] } }, itens[2]] }, email: EMAIL });
  assert.ok(p3.bloqueios.some((b) => /sozinho/.test(b)));
});

test('tarefas: criar (ligada a meta nova do mesmo lote), mudar status com aviso do gate, editar responsável e prazo', async () => {
  const { fake, api, D, ex, metasComSub } = await setup();
  const m = metasComSub[0];
  const pessoa = D.pessoas[0];
  const itens = [
    { id: 'm1', acao: 'meta.criar', dados: { titulo: 'Calibrar sensor de chuva', area: 'sw', sprint: D.sprint, subs: m.subs, tmp: 'tmp:m1' } },
    { id: 't1', acao: 'tarefa.criar', dados: { titulo: 'Montar bancada do sensor', meta: 'tmp:m1', subs: m.subs, resp: [pessoa.id], area: 'sw', sprint: D.sprint, prazo: '2026-09-25', prioridade: 'P1 - Avançar' } },
  ];
  const plan = await buildPlan('lote', { api, D, dados: { itens }, email: EMAIL });
  assert.deepEqual(plan.bloqueios, []);
  const fim = await ex.exec(ex.store(plan, EMAIL), EMAIL);
  assert.ok(fim.ok, JSON.stringify(fim.erro));
  const t = [...fake.pages.values()].find((p) => read(p, 'tarefas', 'titulo') === 'Montar bancada do sensor');
  const meta = [...fake.pages.values()].find((p) => read(p, 'metas', 'titulo') === 'Calibrar sensor de chuva');
  assert.ok(read(t, 'tarefas', 'meta').some((id) => id.replace(/-/g, '') === meta.id.replace(/-/g, '')), 'tarefa ligada à meta nova');
  assert.equal(read(t, 'tarefas', 'prioridade'), 'P1 - Avançar');
  assert.equal(read(t, 'tarefas', 'prazo').start, '2026-09-25');
  // status: Em Andamento é gravado como "Fazendo" (nome atual no Notion) e lido de volta como Em Andamento
  const tid = t.id;
  const p1 = await buildPlan('tarefa.status', { api, D, dados: { tarefa: tid, status: 'Em Andamento' }, email: EMAIL });
  assert.ok((await ex.exec(ex.store(p1, EMAIL), EMAIL)).ok);
  assert.equal(t.properties.Status.status.name, 'Fazendo');
  const p2 = await buildPlan('tarefa.status', { api, D, dados: { tarefa: tid, status: 'Concluída' }, email: EMAIL });
  assert.ok(p2.avisos.some((a) => /sem passar por Em Revisão/.test(a)) && p2.avisos.some((a) => /Gate de conclusão/.test(a)));
  const p3 = await buildPlan('tarefa.editar', { api, D, dados: { tarefa: tid, prazo: '2026-10-02', resp: [] }, email: EMAIL });
  assert.equal(p3.linhas.length, 2);
  assert.ok((await ex.exec(ex.store(p3, EMAIL), EMAIL)).ok);
  assert.deepEqual(read(t, 'tarefas', 'responsavel'), []);
});

test('registro de reunião: cria "🗣️ Registro de reuniões" na primeira vez e acrescenta a entrada depois, sem apagar', async () => {
  const { fake, api, D, ex, metasComSub } = await setup();
  const m = metasComSub[1];
  const dados = (disc) => ({ base: 'metas', pagina: m.id, tipo: 'Operacional', data: '2026-10-05', participantes: ['Ana', 'Beto'], discussao: disc, decisoes: 'Seguir com o plano B' });
  for (const disc of ['Primeira conversa', 'Segunda conversa']) {
    const p = await buildPlan('pagina.registro', { api, D, dados: dados(disc), email: EMAIL });
    assert.deepEqual(p.bloqueios, []);
    assert.ok((await ex.exec(ex.store(p, EMAIL), EMAIL)).ok);
  }
  const textos = fake.blocksOf(m.id).map((b) => `${b.type}:${blockText(b)}`);
  assert.equal(textos.filter((t) => t === 'heading_2:🗣️ Registro de reuniões').length, 1, 'uma seção só');
  assert.equal(textos.filter((t) => t === 'heading_3:05/10/2026 · Operacional · ⬜ Conferido por —').length, 2);
  assert.ok(textos.includes('bulleted_list_item:Discussão: Primeira conversa') && textos.includes('bulleted_list_item:Discussão: Segunda conversa'));
  const vazio = await buildPlan('pagina.registro', { api, D, dados: { ...dados(''), discussao: '' }, email: EMAIL });
  assert.ok(vazio.bloqueios.length);
});
