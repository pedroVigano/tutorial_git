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
import { createIA } from './ia/vertex.js';
import { validarAta, validarAprimorar } from './ia/validar.js';

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
      // pessoa do Notion com o mesmo e-mail do login (aba Eu); null se a integração não lê e-mails
      eu: (v.data.pessoas || []).find((u) => u.email && u.email.toLowerCase() === String(req.user.email).toLowerCase()) || null,
      emails_pessoas: (v.data.pessoas || []).some((u) => u.email),
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

  // ---------- IA (Gemini no Vertex) — só para editores, com limite por pessoa ----------
  const ia = createIA({ config, log: (o) => app.log.info(o) });
  const usoIA = new Map();
  const exigeIA = (req) => {
    exigeEditor(req);
    const agora = Date.now(); const janela = (usoIA.get(req.user.email) || []).filter((t) => agora - t < 600_000);
    if (janela.length >= config.iaLimitePor10Min) { const e = new Error('Limite de chamadas à IA atingido — espere alguns minutos.'); e.statusCode = 429; throw e; }
    janela.push(agora); usoIA.set(req.user.email, janela);
  };
  const snapDo = async (req) => (await snapshots.get({ sprint: req.body?.sprint ? Number(req.body.sprint) : null, tri: req.body?.tri && TRI_RE.test(req.body.tri) ? req.body.tri : null })).data;
  // Contexto enxuto do snapshot para os prompts (ids + nomes).
  const contexto = (D, { equipe } = {}) => {
    const metas = D.metas.filter((m) => m.sprints.includes(D.sprint) && !m.fora && (!equipe || m.area === equipe));
    const idsMetas = new Set(metas.map((m) => m.id));
    return {
      sprint: D.sprint, trimestre: D.trimestre.id, data: new Date().toISOString().slice(0, 10),
      objetivos: D.objetivos.map((o) => ({ id: o.id, label: o.label, titulo: o.titulo })),
      krs: D.krs.map((k) => ({ id: k.id, label: k.label, titulo: k.titulo })),
      kpis: D.kpis.map((k) => ({ id: k.id, titulo: k.titulo, alvo: k.alvo, unidade: k.unidade, dir: k.dir, ultima: Object.entries(k.serie || {}).at(-1) || null })),
      metas: metas.map((m) => ({ id: m.id, titulo: m.titulo, status: m.status, equipe: D.areas[m.area]?.nome, subs: m.subs })),
      tarefas: (D.tarefas || []).filter((t) => t.metas.some((id) => idsMetas.has(id))).map((t) => ({ id: t.id, titulo: t.titulo, status: t.status, meta: t.metas[0], resp: t.resp })),
      arvore: D.tree.map((n) => ({ id: n.id, nome: n.nome, tipo: n.tipo, resp: n.resp })),
      pessoas: (D.pessoas || []).map((p) => ({ id: p.id, nome: p.nome })),
      equipes: Object.fromEntries(Object.entries(D.areas).filter(([, a]) => !a.ext).map(([k, a]) => [k, a.nome])),
    };
  };

  app.get('/api/ia', async () => ({ modo: ia.modo, modelos: { transcricao: config.vertexModelTranscricao, revisao: config.vertexModelRevisao }, local: config.vertexLocation }));

  // Pedaço de áudio (base64, ~5 min) → texto. O áudio não é guardado.
  app.post('/api/ia/transcrever', { bodyLimit: 25 * 1024 * 1024 }, async (req) => {
    exigeIA(req);
    const { audio, mime = 'audio/webm', anterior = '' } = req.body || {};
    if (!audio) { const e = new Error('Sem áudio.'); e.statusCode = 400; throw e; }
    const tipo = String(mime).split(';')[0];
    if (!/^audio\/(webm|ogg|mp4|mpeg|wav|aac|flac)$/.test(tipo)) { const e = new Error(`Formato de áudio não aceito: ${tipo}`); e.statusCode = 400; throw e; }
    const D = await snapDo(req);
    const glossario = [...D.metas.filter((m) => m.sprints.includes(D.sprint)).map((m) => m.titulo), ...D.krs.map((k) => k.titulo), ...D.tree.map((n) => n.nome), ...(D.pessoas || []).map((p) => p.nome).filter(Boolean)].join('\n').slice(0, 15000);
    return ia.transcrever({ audio: Buffer.from(audio, 'base64'), mime: tipo, contexto: glossario, anterior: String(anterior).slice(-1500) });
  });

  // Transcrição → ata (resumo, decisões, próximos passos) + registros por página + sugestões, já validados.
  app.post('/api/ia/ata', { bodyLimit: 5 * 1024 * 1024 }, async (req) => {
    exigeIA(req);
    const { transcricao = '', tipo = 'Tática', equipe = null } = req.body || {};
    if (String(transcricao).trim().length < 20) { const e = new Error('Transcrição curta demais.'); e.statusCode = 400; throw e; }
    const D = await snapDo(req);
    const bruto = await ia.ata({ transcricao: String(transcricao), contexto: contexto(D, { equipe }), tipo });
    return validarAta(bruto, D);
  });

  // Rascunho → sugestões de revisão (editar item, ação nova, comentário), lendo o texto atual das páginas tocadas.
  app.post('/api/ia/aprimorar', { bodyLimit: 5 * 1024 * 1024 }, async (req) => {
    exigeIA(req);
    const { itens = [], transcricao = '' } = req.body || {};
    if (!itens.length) { const e = new Error('Rascunho vazio.'); e.statusCode = 400; throw e; }
    const D = await snapDo(req);
    const ids = [...new Set(itens.flatMap((x) => [x.dados?.meta, x.dados?.tarefa, x.dados?.bloqueada, x.dados?.pagina]).filter((id) => typeof id === 'string' && !id.startsWith('tmp:')))].slice(0, 8);
    const paginas = await Promise.all(ids.map(async (id) => ({ id, texto: await api.pageText(id, { limite: 3000 }).catch(() => '') })));
    const bruto = await ia.aprimorar({ itens: itens.slice(0, 40).map(({ id, acao, dados, titulo }) => ({ id, acao, dados, titulo })), paginas, transcricao: String(transcricao).slice(-40000), contexto: contexto(D) });
    return validarAprimorar(bruto, itens, D);
  });

  // Subsistema → acréscimo para "6. Desenvolvimento", a partir das tarefas e dos registros de reunião delas.
  app.post('/api/ia/documentar', async (req) => {
    exigeIA(req);
    const D = await snapDo(req);
    const n = D.tree.find((x) => x.id === req.body?.subsistema);
    if (!n || !n.url) { const e = new Error('Subsistema não encontrado.'); e.statusCode = 404; throw e; }
    const ts = (D.tarefas || []).filter((t) => (t.subs || []).includes(n.id) && t.url).slice(0, 10);
    const [pagina, tarefas] = await Promise.all([
      api.pageText(n.id, { limite: 8000 }).catch(() => ''),
      Promise.all(ts.map(async (t) => ({ titulo: t.titulo, status: t.status, resp: t.resp, texto: await api.pageText(t.id, { limite: 2500 }).catch(() => '') }))),
    ]);
    const doc = await ia.documentar({ subsistema: { id: n.id, nome: n.nome }, pagina, tarefas });
    const lista = (xs) => (Array.isArray(xs) ? xs : []).slice(0, 12).map((x) => String(x).slice(0, 600));
    return {
      subsistema: { id: n.id, nome: n.nome }, fontes: ts.map((t) => t.titulo),
      situacao: String(doc.situacao || '').slice(0, 400), decisoes: lista(doc.decisoes), desafios: lista(doc.desafios), falta: lista(doc.falta),
      verificacao: (Array.isArray(doc.verificacao) ? doc.verificacao : []).slice(0, 10).map((v) => ({ requisito: String(v.requisito || ''), ensaio: String(v.ensaio || ''), resultado: String(v.resultado || ''), data: String(v.data || '') })),
    };
  });

  // ---------- front ----------
  await app.register(fastifyStatic, { root: WEB_ROOT, index: 'index.html', cacheControl: true, maxAge: '5m' });

  app.decorate('snapshots', snapshots);
  app.decorate('executor', executor);
  return app;
}
