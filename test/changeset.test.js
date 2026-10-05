// Rascunho único: consolidação das ações (stage), overlay na tela e ordem do lote.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stage, overlay, paraLote, isTmp, StageError } from '../web/js/changeset.js';

const st = (lista, acao, dados) => stage(lista, { acao, dados, autor: 'a@b' });

test('meta nova: editar, mover e mudar status entram no próprio item de criação; abortar tira do rascunho', () => {
  let l = st([], 'meta.criar', { titulo: 'Montar bancada', area: 'sw', subs: ['s1'], sprint: 27 });
  const tmp = l[0].dados.tmp;
  assert.ok(isTmp(tmp));
  l = st(l, 'meta.editar', { meta: tmp, titulo: 'Montar bancada de testes' });
  l = st(l, 'meta.mover', { meta: tmp, de: 's1', para: 's2' });
  l = st(l, 'meta.status', { meta: tmp, status: 'Em andamento' });
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].dados.titulo, l[0].dados.subs, l[0].dados.status], ['Montar bancada de testes', ['s2'], 'Em andamento']);
  l = st(l, 'dependencia.criar', { bloqueada: 'm9', bloqueadora: tmp });
  assert.equal(l.length, 2, 'dependência com meta nova fica como item próprio');
  l = st(l, 'meta.status', { meta: tmp, status: 'Abortado' });
  assert.deepEqual(l, [], 'abortar meta não criada some com ela e com a dependência dela');
});

test('meta existente: edições se juntam, mover A→B→C vira A→C e voltar para A anula; status pendente entra na edição', () => {
  let l = st([], 'meta.editar', { meta: 'm1', titulo: 'Novo título' });
  l = st(l, 'meta.editar', { meta: 'm1', area: 'el' });
  assert.equal(l.length, 1);
  assert.deepEqual(l[0].dados, { meta: 'm1', titulo: 'Novo título', area: 'el' });
  l = st(l, 'meta.status', { meta: 'm1', status: 'Concluído' });
  assert.equal(l.length, 1); assert.equal(l[0].dados.status, 'Concluído');
  let m = st([], 'meta.mover', { meta: 'm2', de: 'a', para: 'b' });
  m = st(m, 'meta.mover', { meta: 'm2', de: 'b', para: 'c' });
  assert.deepEqual([m.length, m[0].dados.de, m[0].dados.para], [1, 'a', 'c']);
  m = st(m, 'meta.mover', { meta: 'm2', de: 'c', para: 'a' });
  assert.deepEqual(m, []);
});

test('dependência criada e removida se anulam; duplicada não entra; medição do mesmo KPI×sprint fica com a última', () => {
  let l = st([], 'dependencia.criar', { bloqueada: 'a', bloqueadora: 'b' });
  l = st(l, 'dependencia.criar', { bloqueada: 'a', bloqueadora: 'b' });
  assert.equal(l.length, 1);
  l = st(l, 'dependencia.remover', { bloqueada: 'a', bloqueadora: 'b' });
  assert.deepEqual(l, []);
  l = st(l, 'kpi.medir', { kpi: 'k', sprint: 27, valor: '1' });
  l = st(l, 'kpi.medir', { kpi: 'k', sprint: 27, valor: '2' });
  assert.deepEqual([l.length, l[0].dados.valor], [1, '2']);
  assert.throws(() => st([], 'dependencia.criar', { bloqueada: 'x', bloqueadora: 'x' }), StageError);
  assert.throws(() => st(st([], 'meta.criar', { titulo: 'X' }), 'meta.proximaSprint', { meta: 'tmp:zzz', sprint: 27 }), StageError);
});

test('overlay: meta nova, edição, dependência pendente e medição aparecem na tela sem mexer no snapshot', () => {
  const D = {
    sprint: 27, metas: [{ id: 'm1', titulo: 'A', status: 'Não iniciada', area: 'sw', areas: ['sw'], subs: ['s1'], sprints: [27], okrs: [], bloq: [] }],
    kpis: [{ id: 'k', serie: { 26: 1 } }], tarefas: [],
  };
  let l = st([], 'meta.criar', { titulo: 'Nova', area: 'el', subs: ['s2'], sprint: 27 });
  l = st(l, 'meta.editar', { meta: 'm1', titulo: 'A2' });
  l = st(l, 'dependencia.criar', { bloqueada: 'm1', bloqueadora: l[0].dados.tmp });
  l = st(l, 'kpi.medir', { kpi: 'k', sprint: 27, valor: '3,5' });
  const O = overlay(D, l);
  assert.equal(O.metas.length, 2);
  assert.deepEqual(O.metas[1].pend, ['nova']);
  assert.equal(O.metas[0].titulo, 'A2');
  assert.ok(O.metas[0].bloq.includes(l[0].dados.tmp));
  assert.equal(O.pendEdges.length, 1);
  assert.equal(O.kpis[0].serie['27'], 3.5);
  assert.equal(D.metas[0].titulo, 'A', 'snapshot original intacto');
  assert.equal(D.kpis[0].serie['27'], undefined);
  assert.equal(overlay(D, []), D);
});

test('lote: só itens incluídos, criações antes do resto', () => {
  let l = st([], 'kpi.medir', { kpi: 'k', sprint: 27, valor: '1' });
  l = st(l, 'meta.criar', { titulo: 'Nova' });
  l = st(l, 'meta.status', { meta: 'm1', status: 'Abortado' });
  l[2].incluir = false;
  assert.deepEqual(paraLote(l).map((x) => x.acao), ['meta.criar', 'kpi.medir']);
});
