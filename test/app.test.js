// API HTTP de ponta a ponta (Fastify inject + Notion falso + JWT local).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { buildApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { createFakeNotion } from '../server/notion/fake.js';
import { demoState } from '../server/notion/demo.js';

const AUD = '/projects/1/locations/r/services/s';

async function setup(env = {}, state = demoState()) {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k', alg: 'ES256' }] });
  const token = (email) => new SignJWT({ email }).setProtectedHeader({ alg: 'ES256', kid: 'k' })
    .setIssuer('https://cloud.google.com/iap').setAudience(AUD).setExpirationTime('5m').sign(privateKey);
  const fake = createFakeNotion(state);
  const config = loadConfig({ AUTH_MODE: 'iap', K_SERVICE: 's', NOTION_MODE: 'live', NOTION_RATE_PER_SEC: '10000', EDITOR_EMAILS: 'lider@bsvrobotics.com.br', ...env });
  const app = await buildApp({ config, client: fake.client, jwks, audience: AUD, logger: false });
  const as = async (email) => ({ 'x-goog-iap-jwt-assertion': await token(email) });
  return { app, as, fake };
}

test('health público; API exige o JWT do IAP', async () => {
  const { app } = await setup();
  const h = await app.inject('/api/health');
  assert.equal(h.statusCode, 200);
  assert.equal(h.json().schema.ok, true);
  assert.equal((await app.inject('/api/me')).statusCode, 401);
  assert.equal((await app.inject('/api/snapshot')).statusCode, 401);
});

test('snapshot com ETag (304 quando nada mudou) e papel do usuário', async () => {
  const { app, as } = await setup();
  const r = await app.inject({ url: '/api/snapshot', headers: await as('eng@bsvrobotics.com.br') });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.D.sprint, 27);
  assert.equal(body.meta.pode_gravar, false);
  const r2 = await app.inject({ url: '/api/snapshot', headers: { ...(await as('eng@bsvrobotics.com.br')), 'if-none-match': r.headers.etag } });
  assert.equal(r2.statusCode, 304);
});

test('leitor não gera plano nem grava; editor grava com stream NDJSON', async () => {
  const { app, as } = await setup();
  const snap = (await app.inject({ url: '/api/snapshot', headers: await as('lider@bsvrobotics.com.br') })).json();
  const m = snap.D.metas.find((x) => x.sprints.includes(27) && x.status !== 'Abortado');
  const body = { acao: 'meta.status', dados: { meta: m.id, status: 'Abortado' } };
  assert.equal((await app.inject({ method: 'POST', url: '/api/plan', headers: await as('eng@bsvrobotics.com.br'), payload: body })).statusCode, 403);
  const plan = (await app.inject({ method: 'POST', url: '/api/plan', headers: await as('lider@bsvrobotics.com.br'), payload: body })).json();
  assert.ok(plan.planId);
  assert.equal(plan.ops, undefined, 'operações internas não vão para o navegador');
  assert.equal((await app.inject({ method: 'POST', url: '/api/exec', headers: await as('eng@bsvrobotics.com.br'), payload: { planId: plan.planId } })).statusCode, 403);
  const ex = await app.inject({ method: 'POST', url: '/api/exec', headers: await as('lider@bsvrobotics.com.br'), payload: { planId: plan.planId } });
  assert.equal(ex.headers['content-type'], 'application/x-ndjson; charset=utf-8');
  const eventos = ex.body.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(eventos.at(-1).tipo, 'fim');
  assert.equal(eventos.at(-1).ok, true);
  // cache invalidado: o snapshot seguinte já mostra a meta abortada
  const depois = (await app.inject({ url: '/api/snapshot', headers: await as('lider@bsvrobotics.com.br') })).json();
  assert.equal(depois.D.metas.find((x) => x.id === m.id).status, 'Abortado');
  // o mesmo plano não roda de novo
  assert.equal((await app.inject({ method: 'POST', url: '/api/exec', headers: await as('lider@bsvrobotics.com.br'), payload: { planId: plan.planId } })).statusCode, 409);
});

test('campo renomeado no Notion: aviso e segue funcionando (casado pelo ID)', async () => {
  const { app, as, fake } = await setup();
  fake.renameProperty('metas', 'Meta', 'Nome da meta');
  await app.inject({ method: 'POST', url: '/api/schema-check', headers: await as('lider@bsvrobotics.com.br') });
  const h = (await app.inject('/api/health')).json();
  assert.equal(h.somente_leitura, false);
  assert.ok(h.schema.avisos.some((a) => a.key === 'titulo' && /renomeado/.test(a.msg)));
  await app.inject({ method: 'POST', url: '/api/refresh', headers: await as('lider@bsvrobotics.com.br') });
  const snap = (await app.inject({ url: '/api/snapshot', headers: await as('lider@bsvrobotics.com.br') })).json();
  assert.ok(snap.D.metas.every((m) => m.titulo), 'títulos lidos pelo nome novo');
  fake.renameProperty('metas', 'Nome da meta', 'Meta');
});

test('campo obrigatório apagado → somente leitura, gravação recusada; volta ao normal depois do check', async () => {
  const { app, as, fake } = await setup();
  const props = fake.dataSources['3268b1dc-5324-8023-a438-000bb62661ed'].properties;
  const guardado = props['Bloqueado por'];
  delete props['Bloqueado por'];
  await app.inject({ method: 'POST', url: '/api/schema-check', headers: await as('lider@bsvrobotics.com.br') });
  const h = (await app.inject('/api/health')).json();
  assert.equal(h.somente_leitura, true);
  assert.ok(h.schema.erros.some((e) => e.base === 'metas' && e.key === 'bloqueadoPor'));
  const me = (await app.inject({ url: '/api/me', headers: await as('lider@bsvrobotics.com.br') })).json();
  assert.equal(me.pode_gravar, false);
  const plan = await app.inject({ method: 'POST', url: '/api/plan', headers: await as('lider@bsvrobotics.com.br'), payload: { acao: 'meta.status', dados: {} } });
  assert.equal(plan.statusCode, 409);
  props['Bloqueado por'] = guardado;
  await app.inject({ method: 'POST', url: '/api/schema-check', headers: await as('lider@bsvrobotics.com.br') });
  assert.equal((await app.inject('/api/health')).json().somente_leitura, false);
});

test('serve o front', async () => {
  const { app } = await setup();
  const r = await app.inject('/');
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /Gestão Tática · P&amp;D/);
  assert.equal((await app.inject('/js/main.js')).statusCode, 200);
});
