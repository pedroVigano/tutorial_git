// IA: validação do que o Gemini devolve (só ids do snapshot, ações e valores conhecidos) e as rotas /api/ia/*
// em IA_MODE=fake (sem chamar o Google), incluindo a gravação da ata e da documentação pelo lote.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { fakeWithDemo, snapshotOf } from './helpers.js';
import { validarSugestao, validarAta, validarAprimorar, validarRegistro } from '../server/ia/validar.js';
import { buildApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { createFakeNotion } from '../server/notion/fake.js';
import { demoState } from '../server/notion/demo.js';
import { blockText, read } from '../server/notion/props.js';

test('validação: sugestões com ids inexistentes, status inválido ou valor não numérico são descartadas', async () => {
  const { api } = fakeWithDemo();
  const D = await snapshotOf(api);
  const t = D.tarefas.find((x) => x.status === 'A Fazer');
  const m = D.metas.find((x) => !x.fora && x.sprints.includes(D.sprint));
  const k = D.kpis[0];
  assert.equal(validarSugestao({ acao: 'tarefa.status', dados: { tarefa: t.id, status: 'Em Andamento' } }, D).dados.de, 'A Fazer');
  assert.equal(validarSugestao({ acao: 'tarefa.status', dados: { tarefa: 'nao-existe', status: 'Em Andamento' } }, D), null);
  assert.equal(validarSugestao({ acao: 'tarefa.status', dados: { tarefa: t.id, status: 'Feito' } }, D), null);
  assert.equal(validarSugestao({ acao: 'kpi.medir', dados: { kpi: k.id, valor: 'muito' } }, D), null);
  assert.equal(validarSugestao({ acao: 'kpi.medir', dados: { kpi: k.id, valor: 2.5 } }, D).dados.valor, '2.5');
  assert.equal(validarSugestao({ acao: 'apagar.tudo', dados: {} }, D), null);
  assert.equal(validarSugestao({ acao: 'meta.criar', dados: { titulo: 'Testar X', area: 'inexistente' } }, D), null);
  assert.ok(validarRegistro({ tipo: 'meta', id: m.id, discussao: 'ok' }, D));
  assert.equal(validarRegistro({ tipo: 'meta', id: m.id, discussao: '' }, D), null);
  const a = validarAta({ titulo: 'R', registros: [{ tipo: 'meta', id: 'x', discussao: 'y' }], sugestoes: [{ acao: 'meta.status', dados: { meta: m.id, status: 'Concluído' } }] }, D);
  assert.equal(a.registros.length, 0); assert.equal(a.sugestoes.length, 1); assert.equal(a.descartadas, 1);
  const ap = validarAprimorar({ sugestoes: [{ tipo: 'editar', item: 'c1', dados: { titulo: 'Novo', perigoso: 'x' }, justificativa: 'j' }, { tipo: 'editar', item: 'nao', dados: { titulo: 'x' }, justificativa: 'j' }] }, [{ id: 'c1' }], D);
  assert.deepEqual(ap.sugestoes[0].dados, { titulo: 'Novo' }); assert.equal(ap.descartadas, 1);
});

async function app() {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k', alg: 'ES256' }] });
  const AUD = '/projects/1/locations/r/services/s';
  const token = (email) => new SignJWT({ email }).setProtectedHeader({ alg: 'ES256', kid: 'k' }).setIssuer('https://cloud.google.com/iap').setAudience(AUD).setExpirationTime('5m').sign(privateKey);
  const fake = createFakeNotion(demoState());
  const config = loadConfig({ AUTH_MODE: 'iap', K_SERVICE: 's', NOTION_MODE: 'live', IA_MODE: 'fake', NOTION_RATE_PER_SEC: '10000', EDITOR_EMAILS: 'lider@bsvrobotics.com.br' });
  const a = await buildApp({ config, client: fake.client, jwks, audience: AUD, logger: false });
  const as = async (email = 'lider@bsvrobotics.com.br') => ({ 'x-goog-iap-jwt-assertion': await token(email) });
  return { a, as, fake };
}

test('rotas de IA (fake): transcrever, ata validada, aprimorar, documentar; leitor não usa', async () => {
  const { a, as } = await app();
  const leitor = await a.inject({ method: 'POST', url: '/api/ia/ata', headers: await as('eng@bsvrobotics.com.br'), payload: { transcricao: 'x'.repeat(50) } });
  assert.equal(leitor.statusCode, 403);
  const tr = await a.inject({ method: 'POST', url: '/api/ia/transcrever', headers: await as(), payload: { audio: Buffer.from('abc').toString('base64'), mime: 'audio/webm;codecs=opus' } });
  assert.equal(tr.statusCode, 200); assert.match(tr.json().texto, /demonstração/);
  const ruim = await a.inject({ method: 'POST', url: '/api/ia/transcrever', headers: await as(), payload: { audio: 'AAAA', mime: 'video/mp4' } });
  assert.equal(ruim.statusCode, 400);
  const ata = (await a.inject({ method: 'POST', url: '/api/ia/ata', headers: await as(), payload: { transcricao: 'Discutimos as metas da sprint e os testes de bancada.', tipo: 'Tática' } })).json();
  assert.match(ata.titulo, /Reunião tática #27/);
  assert.ok(ata.registros.length >= 1 && ata.sugestoes.length >= 1);
  const ap = (await a.inject({ method: 'POST', url: '/api/ia/aprimorar', headers: await as(), payload: { itens: [{ id: 'c1', acao: 'meta.criar', dados: { titulo: 'Testar sensor', tmp: 'tmp:c1' }, titulo: 'Criar meta' }] } })).json();
  assert.ok(ap.sugestoes.some((s) => s.tipo === 'editar' && s.dados.criterio));
  const snap = (await a.inject({ url: '/api/snapshot', headers: await as() })).json().D;
  const sub = snap.tree.find((n) => snap.tarefas.some((t) => (t.subs || []).includes(n.id)));
  const doc = (await a.inject({ method: 'POST', url: '/api/ia/documentar', headers: await as(), payload: { subsistema: sub.id } })).json();
  assert.ok(doc.situacao && doc.fontes.length >= 1);
});

test('ata e documentação gravadas pelo lote: linha em Reuniões com transcrição, registro com link da ata, toggle abaixo de "6. Desenvolvimento"', async () => {
  const { a, as, fake } = await app();
  const snap = (await a.inject({ url: '/api/snapshot', headers: await as() })).json().D;
  const m = snap.metas.find((x) => !x.fora && x.sprints.includes(snap.sprint) && x.url);
  const sub = snap.tree.find((n) => n.tipo === 'Subsistema' && n.url);
  const transcricao = Array.from({ length: 300 }, (_, i) => `[Participante ${i % 3}] fala número ${i} sobre a bancada e o protótipo.`).join('\n');
  const itens = [
    { id: 'r1', acao: 'reuniao.criar', dados: { tmp: 'tmp:r1', titulo: 'Reunião tática #27 — 05/10', data: '2026-10-05', duracao: 1.5, nivel: 'Tático', areas: ['sw'], participantes: [snap.pessoas[0].id], resumo: [{ topico: 'Bancada', itens: ['Montada'] }], decisoes: ['Seguir'], proximos: [{ acao: 'Testar', responsavel: 'Ana' }], transcricao } },
    { id: 'g1', acao: 'pagina.registro', dados: { base: 'metas', pagina: m.id, tipo: 'Tática', data: '2026-10-05', participantes: ['Ana'], discussao: 'Bancada pronta.', decisoes: 'Seguir', reuniao: 'tmp:r1' } },
    { id: 'd1', acao: 'pagina.documentar', dados: { pagina: sub.id, situacao: 'Em desenvolvimento', decisoes: ['Usar conversor X'], desafios: [], falta: ['Ensaio final'], fontes: ['Tarefa A'] } },
  ];
  const p = (await a.inject({ method: 'POST', url: '/api/plan', headers: await as(), payload: { acao: 'lote', dados: { itens } } })).json();
  assert.deepEqual(p.bloqueios, []);
  const ex = await a.inject({ method: 'POST', url: '/api/exec', headers: await as(), payload: { planId: p.planId } });
  const fim = ex.body.trim().split('\n').map((l) => JSON.parse(l)).at(-1);
  assert.ok(fim.ok, JSON.stringify(fim.erro));
  const ata = [...fake.pages.values()].find((pg) => read(pg, 'reunioes', 'titulo') === 'Reunião tática #27 — 05/10');
  assert.ok(ata, 'linha em Reuniões');
  assert.equal(read(ata, 'reunioes', 'frequencia'), 'Pontual');
  const corpo = fake.blocksOf(ata.id);
  assert.ok(corpo.some((b) => b.type === 'toggle' && /Transcrição/.test(blockText(b))), 'transcrição recolhida');
  const reg = fake.blocksOf(m.id).map(blockText);
  assert.ok(reg.some((t) => /^Reunião: https?:\/\//.test(t)), 'registro com link da ata criada no mesmo lote');
  assert.ok(fake.blocksOf(sub.id).some((b) => b.type === 'toggle' && /sugerida por IA, revisada por lider@/.test(blockText(b))));
});
