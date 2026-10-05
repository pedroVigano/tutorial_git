// Aplicação Fastify: estático (web/) + API.
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { createApi, createSdkClient } from './notion/client.js';
import { createLimiter, noLimiter } from './notion/limiter.js';
import { createFakeNotion } from './notion/fake.js';
import { demoState } from './notion/demo.js';
import { checkSchema, formatReport } from './notion/schema-check.js';
import { applyResolution } from './notion/schema.js';
import { createSnapshotService } from './snapshot/cache.js';
import { buildPlan } from './writes/plans.js';
import { createExecutor } from './writes/executor.js';
import { createAuth } from './auth/iap.js';

const TRI_RE = /^\d{4} - [1-4]$/;

const WEB_ROOT = fileURLToPath(new URL('../web/', import.meta.url));

export async function buildApp({ config, client, jwks, audience, logger = true } = {}) {
  const app = Fastify({
    logger: logger && {
      level: config.logLevel,
      messageKey: 'message',
      formatters: { level: (label) => ({ severity: label === 'warn' ? 'WARNING' : label.toUpperCase() }) },
    },
    trustProxy: true,
  });

  // ---------- Notion ----------
  const fixture = config.notionMode === 'fixture';
  const notionClient = client || (fixture ? createFakeNotion(demoState()).client : createSdkClient(config.notionToken));
  const api = createApi(notionClient, { limiter: fixture ? noLimiter : createLimiter({ ratePerSec: config.notionRatePerSec }) });

  let schema = { ok: false, erros: [], avisos: [], items: [], em: null };
  async function runSchemaCheck() {
    try {
      schema = await checkSchema(api);
      applyResolution(schema.resolution);
    } catch (e) {
      schema = { ok: false, erros: [{ base: '*', key: '*', nivel: 'ERRO', msg: `Não foi possível ler o schema do Notion: ${e.message}` }], avisos: [], items: [], em: new Date().toISOString() };
    }
    app.log[schema.ok ? 'info' : 'error']({ schema_ok: schema.ok }, formatReport({ items: schema.items, erros: schema.erros, avisos: schema.avisos }));
    return schema;
  }
  await runSchemaCheck();
  const somenteLeitura = () => !schema.ok;

  const snapshots = createSnapshotService({ api, ttlMs: config.cacheTtlMs, log: (o) => app.log.info(o) });
  const executor = createExecutor({ api, audit: (o) => app.log.info(o) });
  const auth = createAuth({ config, jwks, audience, log: (o) => app.log.warn(o) });

  // ---------- erros ----------
  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : (err.status === 404 ? 404 : 500);
    if (status >= 500) req.log.error({ err }, 'erro');
    reply.code(status).send({ erro: status >= 500 && !err.expose ? `Erro interno: ${err.message}` : err.message });
  });

  // ---------- autenticação em /api ----------
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/health')) return;
    req.user = await auth.identify(req.headers);
  });
  const exigeEditor = (req) => {
    if (somenteLeitura()) { const e = new Error('Dashboard em modo somente leitura: o schema do Notion tem erros (veja /api/health).'); e.statusCode = 409; throw e; }
    if (!req.user.podeGravar) { const e = new Error(`${req.user.email} não está na lista de quem grava (EDITOR_EMAILS).`); e.statusCode = 403; throw e; }
  };

  // ---------- rotas ----------
  app.get('/api/health', async () => ({
    ok: true, modo: config.notionMode, auth: auth.mode, somente_leitura: somenteLeitura(),
    schema: { ok: schema.ok, em: schema.em, erros: schema.erros, avisos: schema.avisos },
  }));

  // Refaz o schema check (ex.: depois de conectar uma base à integração). Vale também em somente leitura.
  app.post('/api/schema-check', async (req) => {
    if (!req.user.podeGravar) { const e = new Error('Só editores podem refazer o schema check.'); e.statusCode = 403; throw e; }
    const s = await runSchemaCheck();
    return { ok: s.ok, erros: s.erros, avisos: s.avisos };
  });

  app.get('/api/me', async (req) => ({
    email: req.user.email, pode_gravar: req.user.podeGravar && !somenteLeitura(), editor: req.user.podeGravar,
    auth: auth.mode, dev: !!req.user.dev, modo: config.notionMode,
  }));

  app.get('/api/snapshot', async (req, reply) => {
    const { sprint, tri, force } = req.query;
    if (tri && !TRI_RE.test(tri)) return reply.code(400).send({ erro: `Trimestre inválido: use o formato "2026 - 3"` });
    const v = await snapshots.get({ sprint: sprint ? Number(sprint) : null, tri: tri || null, force: force === '1' });
    const meta = {
      email: req.user.email, pode_gravar: req.user.podeGravar && !somenteLeitura(), somente_leitura: somenteLeitura(),
      avisos_schema: [...schema.erros, ...schema.avisos], modo: config.notionMode, auth: auth.mode,
    };
    const etag = `${v.etag.slice(0, -1)}-${meta.pode_gravar ? 'w' : 'r'}${meta.avisos_schema.length}"`;
    reply.header('ETag', etag).header('Cache-Control', 'no-cache');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    reply.type('application/json; charset=utf-8');
    return `{"meta":${JSON.stringify(meta)},"D":${v.json}}`;
  });

  app.post('/api/refresh', async () => { snapshots.invalidate(); return { ok: true }; });

  app.post('/api/plan', async (req, reply) => {
    exigeEditor(req);
    const { acao, dados = {}, sprint = null, tri = null } = req.body || {};
    if (tri && !TRI_RE.test(tri)) return reply.code(400).send({ erro: 'Trimestre inválido' });
    const temRollover = acao === 'rollover' || (acao === 'lote' && (dados.itens || []).some((x) => x.acao === 'rollover'));
    const v = await snapshots.get({ sprint: sprint ? Number(sprint) : null, tri, force: temRollover });
    // itens do lote com outro trimestre (ex.: Trimestral revisando outro trimestre) usam o snapshot dele
    const snapshotDe = async (t) => {
      if (!TRI_RE.test(String(t))) throw Object.assign(new Error('Trimestre inválido'), { statusCode: 400 });
      return (await snapshots.get({ sprint: sprint ? Number(sprint) : null, tri: t })).data;
    };
    const plan = await buildPlan(acao, { api, D: v.data, dados, email: req.user.email, snapshotDe });
    const planId = plan.bloqueios.length ? null : executor.store(plan, req.user.email);
    const { ops, ...visivel } = plan;
    return { planId, ...visivel, n_operacoes: ops.length };
  });

  app.post('/api/exec', async (req, reply) => {
    exigeEditor(req);
    const { planId } = req.body || {};
    const write = (ev) => reply.raw.write(`${JSON.stringify(ev)}\n`);
    const running = executor.exec(planId, req.user.email, write); // valida (lança 404/403/409) antes de abrir o stream
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    try {
      await running;
    } catch (e) {
      write({ tipo: 'fim', ok: false, erro: { mensagem: e.message } });
    } finally {
      snapshots.invalidate();
      reply.raw.end();
    }
  });

  // ---------- front ----------
  await app.register(fastifyStatic, { root: WEB_ROOT, index: 'index.html', cacheControl: true, maxAge: '5m' });

  app.decorate('snapshots', snapshots);
  app.decorate('executor', executor);
  return app;
}
