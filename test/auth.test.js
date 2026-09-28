// Autenticação IAP: JWT ES256 assinado com chave local (no lugar das chaves públicas do Google).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { createAuth, discoverAudience } from '../server/auth/iap.js';
import { loadConfig } from '../server/config.js';

const AUD = '/projects/123/locations/southamerica-east1/services/tatico-pd';

async function keys() {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' };
  const jwks = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims, { aud = AUD, iss = 'https://cloud.google.com/iap', exp = '5m' } = {}) => new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(privateKey);
  return { jwks, sign };
}

const cfg = (env) => loadConfig({ AUTH_MODE: 'iap', K_SERVICE: 'tatico-pd', EDITOR_EMAILS: 'lider@bsvrobotics.com.br', ...env });

test('JWT válido do IAP identifica o e-mail e o papel (editor ou leitura)', async () => {
  const { jwks, sign } = await keys();
  const auth = createAuth({ config: cfg(), jwks, audience: AUD });
  const lider = await auth.identify({ 'x-goog-iap-jwt-assertion': await sign({ email: 'Lider@bsvrobotics.com.br' }) });
  assert.deepEqual(lider, { email: 'lider@bsvrobotics.com.br', podeGravar: true });
  const leitor = await auth.identify({ 'x-goog-iap-jwt-assertion': await sign({ email: 'eng@bsvrobotics.com.br' }) });
  assert.equal(leitor.podeGravar, false);
});

test('sem JWT, audiência errada, emissor errado ou expirado → 401; fora do domínio → 403', async () => {
  const { jwks, sign } = await keys();
  const auth = createAuth({ config: cfg(), jwks, audience: AUD });
  await assert.rejects(auth.identify({}), { statusCode: 401 });
  await assert.rejects(auth.identify({ 'x-goog-iap-jwt-assertion': await sign({ email: 'a@bsvrobotics.com.br' }, { aud: '/projects/9/other' }) }), { statusCode: 401 });
  await assert.rejects(auth.identify({ 'x-goog-iap-jwt-assertion': await sign({ email: 'a@bsvrobotics.com.br' }, { iss: 'https://evil' }) }), { statusCode: 401 });
  await assert.rejects(auth.identify({ 'x-goog-iap-jwt-assertion': await sign({ email: 'a@bsvrobotics.com.br' }, { exp: '-1m' }) }), { statusCode: 401 });
  await assert.rejects(auth.identify({ 'x-goog-iap-jwt-assertion': await sign({ email: 'a@gmail.com' }) }), { statusCode: 403 });
  // o header em texto puro não é aceito sozinho
  await assert.rejects(auth.identify({ 'x-goog-authenticated-user-email': 'accounts.google.com:a@bsvrobotics.com.br' }), { statusCode: 401 });
});

test('audiência divergente é registrada no log para diagnóstico', async () => {
  const { jwks, sign } = await keys();
  const logs = [];
  const auth = createAuth({ config: cfg(), jwks, audience: AUD, log: (o) => logs.push(o) });
  await assert.rejects(auth.identify({ 'x-goog-iap-jwt-assertion': await sign({ email: 'a@bsvrobotics.com.br' }, { aud: '/projects/9/other' }) }), { statusCode: 401 });
  assert.equal(logs[0].message, 'iap.audiencia_divergente');
  assert.equal(logs[0].recebida, '"/projects/9/other"');
});

test('modo dev é recusado no Cloud Run', () => {
  assert.throws(() => createAuth({ config: loadConfig({ AUTH_MODE: 'dev', K_SERVICE: 'tatico-pd' }) }), /não é permitido no Cloud Run/);
  const dev = createAuth({ config: loadConfig({ AUTH_MODE: 'dev', DEV_USER_EMAIL: 'eu@bsvrobotics.com.br' }) });
  return dev.identify({}).then((u) => assert.deepEqual(u, { email: 'eu@bsvrobotics.com.br', podeGravar: true, dev: true }));
});

test('no Cloud Run, sem EDITOR_EMAILS ninguém grava', async () => {
  const { jwks, sign } = await keys();
  const auth = createAuth({ config: loadConfig({ AUTH_MODE: 'iap', K_SERVICE: 'x' }), jwks, audience: AUD });
  const u = await auth.identify({ 'x-goog-iap-jwt-assertion': await sign({ email: 'lider@bsvrobotics.com.br' }) });
  assert.equal(u.podeGravar, false);
});

test('audiência montada pelo servidor de metadados (número do projeto, região, serviço)', async () => {
  const fakeFetch = async (url) => ({
    ok: true,
    text: async () => (url.endsWith('numeric-project-id') ? '123\n' : 'projects/123/regions/southamerica-east1'),
  });
  assert.equal(await discoverAudience({ env: { K_SERVICE: 'tatico-pd' }, fetchImpl: fakeFetch }), AUD);
  assert.equal(await discoverAudience({ env: { IAP_AUDIENCE: '/x' } }), '/x');
});
