// Schema check: compara schema.js com o schema vivo e reporta OK / AVISO / ERRO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeNotion, fakeDataSources, fakePropId } from '../server/notion/fake.js';
import { createApi } from '../server/notion/client.js';
import { noLimiter } from '../server/notion/limiter.js';
import { checkSchema } from '../server/notion/schema-check.js';
import { BASES, applyResolution, has } from '../server/notion/schema.js';

const apiFor = (ds) => createApi(createFakeNotion({ dataSources: ds }).client, { limiter: noLimiter });

test('schema de hoje: sem erros; campos da Fase 4 aparecem como aviso', async () => {
  const r = await checkSchema(apiFor(fakeDataSources()));
  assert.equal(r.ok, true);
  assert.deepEqual(r.avisos.map((a) => `${a.base}.${a.key}`).sort(), ['metas.sprintOrigem', 'okrs.responsavel']);
});

test('campo obrigatório ausente, tipo errado, opção de status ausente e base sem acesso viram ERRO', async () => {
  const ds = fakeDataSources();
  const metas = ds[BASES.metas.ds].properties;
  delete metas['Bloqueado por'];
  metas['🏃 Sprint'] = { ...metas['🏃 Sprint'], type: 'rich_text' };
  metas.Status.status.options = metas.Status.status.options.filter((o) => o.name !== 'Abortado');
  delete ds[BASES.desejos.ds];
  const r = await checkSchema(apiFor(ds));
  assert.equal(r.ok, false);
  const erros = r.erros.map((e) => `${e.base}.${e.key}`);
  assert.ok(erros.includes('metas.bloqueadoPor'));
  assert.ok(erros.includes('metas.sprint'));
  assert.ok(erros.includes('metas.status'));
  assert.ok(erros.includes('desejos.*'));
});

test('renomeação detectada pelo ID da propriedade', async () => {
  const ds = fakeDataSources();
  const props = ds[BASES.metas.ds].properties;
  props['Título da meta'] = { ...props.Meta, name: 'Título da meta' };
  delete props.Meta;
  const antes = { ...BASES.metas.props.titulo };
  BASES.metas.props.titulo.id = fakePropId('metas', 'titulo');
  try {
    const r = await checkSchema(apiFor(ds));
    assert.ok(r.avisos.some((a) => a.key === 'titulo' && /renomeado/.test(a.msg)));
    assert.equal(r.resolution.metas.titulo.name, 'Título da meta');
  } finally {
    BASES.metas.props.titulo = antes;
  }
});

test('"Fazendo" renomeado para "Em Andamento" (Fase 4, item 4) não é erro', async () => {
  const ds = fakeDataSources();
  const st = ds[BASES.tarefas.ds].properties.Status.status;
  st.options = st.options.map((o) => (o.name === 'Fazendo' ? { ...o, name: 'Em Andamento' } : o));
  const r = await checkSchema(apiFor(ds));
  assert.ok(!r.erros.length && !r.avisos.some((a) => a.base === 'tarefas'));
});

test('campo opcional só é usado depois que o check confirma que existe', async () => {
  assert.equal(has('metas', 'sprintOrigem'), false);
  const ds = fakeDataSources();
  const sp = ds[BASES.metas.ds].properties['🏃 Sprint'];
  ds[BASES.metas.ds].properties.Sprint_de_origem = { ...sp, id: 'orig', name: 'Sprint_de_origem' };
  const r = await checkSchema(apiFor(ds));
  applyResolution(r.resolution);
  assert.equal(has('metas', 'sprintOrigem'), true);
});
