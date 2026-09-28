// Utilitários de teste: Notion falso com os dados do mock e API sem limitador.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createFakeNotion, makePage } from '../server/notion/fake.js';
import { createApi } from '../server/notion/client.js';
import { noLimiter } from '../server/notion/limiter.js';
import { demoState, readMockData, MOCK_PATH } from '../server/notion/demo.js';
import { loadRaw } from '../server/notion/queries.js';
import { buildSnapshot } from '../server/snapshot/build.js';

export { readMockData };

export function fakeWithDemo() {
  const fake = createFakeNotion(demoState());
  const api = createApi(fake.client, { limiter: noLimiter });
  return { fake, api };
}

export async function snapshotOf(api, opts = {}) {
  return buildSnapshot(await loadRaw(api, opts), { sprintN: opts.sprint });
}

// Árvore com Entregáveis-Chave (tipo fora do modelo) pendurados em subsistema, sistema, outro EC e sem pai.
export function ecState() {
  const sprint = makePage({ base: 'sprints', props: { titulo: 'Sprint P&D #5', numero: 5, data: { start: '2026-09-14', end: '2026-09-25' }, status: 'Em andamento' } });
  const sprintAnt = makePage({ base: 'sprints', props: { titulo: 'Sprint P&D #4', numero: 4, data: { start: '2026-08-31', end: '2026-09-11' }, status: 'Concluído' } });
  const pd = makePage({ base: 'areas', props: { titulo: 'P&D', diretoria: 'P&D', nivel: 'Diretoria' } });
  const sw = makePage({ base: 'areas', props: { titulo: 'Software', diretoria: 'P&D', nivel: 'Equipe', pai: [pd.id] } });
  const proj = makePage({ base: 'projetos', props: { titulo: 'Scout', tipo: 'Projeto', status: 'Em andamento', area: [pd.id] } });
  const sis = makePage({ base: 'projetos', props: { titulo: 'Insumos', tipo: 'Sistema', status: 'Em andamento', pai: [proj.id] } });
  const sub = makePage({ base: 'projetos', props: { titulo: 'Reabastecimento', tipo: 'Subsistema', status: 'Em andamento', pai: [sis.id] } });
  const ec = (titulo, pai) => makePage({ base: 'projetos', props: { titulo, tipo: 'Entregável-Chave', status: 'Em andamento', pai } });
  const ecSub = ec('EC do subsistema', [sub.id]);
  const ecNeto = ec('EC dentro de EC', [ecSub.id]);
  const ecSis = ec('EC do sistema', [sis.id]);
  const ecSolto = ec('EC sem pai', []);
  const obj = makePage({ base: 'okrs', props: { titulo: 'Entregar o Scout', grau: 'Objetivo', trimestre: ['2026 - 3'], area: [sw.id], projetos: [proj.id] } });
  const kr = makePage({ base: 'okrs', props: { titulo: 'KR do Scout', grau: 'Resultado-Chave', pai: [obj.id] } });
  const meta = (titulo, subsistema) => makePage({ base: 'metas', props: { titulo, status: 'Em andamento', sprint: [sprint.id], area: [sw.id], okr: [obj.id], subsistema } });
  const mEc = meta('Validar o reabastecimento', [ecSub.id]);
  const mNeto = meta('Testar o bocal', [ecNeto.id]);
  const mAmbos = meta('Documentar o reabastecimento', [sub.id, ecSub.id]);
  const mSis = meta('Integrar os insumos', [ecSis.id]);
  const mSolto = meta('Fechar o EC antigo', [ecSolto.id]);
  const desejo = makePage({ base: 'desejos', props: { titulo: 'Abastecer sozinho', status: 'Em análise', projetos: [ecSub.id] } });
  const all = { sprint, sprintAnt, pd, sw, proj, sis, sub, ecSub, ecNeto, ecSis, ecSolto, obj, kr, mEc, mNeto, mAmbos, mSis, mSolto, desejo };
  return {
    state: { pages: Object.fromEntries(Object.values(all).map((p) => [p.id, p])) },
    ids: Object.fromEntries(Object.entries(all).map(([k, p]) => [k, p.id])),
  };
}

// Funções originais do mock v2.2 (índices, regras de status e alertas), executadas numa VM com o D do mock —
// base dos testes de paridade (test/rules.test.js).
export function mockRules() {
  const lines = readFileSync(MOCK_PATH, 'utf8').split('\n');
  const block = (from, to) => {
    const a = lines.findIndex((l) => l.startsWith(from));
    const b = lines.findIndex((l, i) => i > a && l.startsWith(to));
    return lines.slice(a, b);
  };
  const src = [
    ...block('/* ---------- índices ---------- */', '/* ---------- header ---------- */')
      .filter((l) => !l.includes('SRC_B64') && !l.startsWith('loadEdits();') && !l.startsWith('try{ const s=JSON.parse(localStorage')),
    lines.find((l) => l.startsWith('function visibleProjects(')),
    ...block('/* ---------- alertas por regra ---------- */', '/* ---------- fila para o Claude ---------- */')
      .filter((l) => !l.startsWith('function renderAlerts(')),
    'globalThis.__mock = { computeAlerts, kpiStatus, krStatus, objStatus, state, D };',
  ].join('\n');
  const ctx = vm.createContext({ D: readMockData(), localStorage: { getItem: () => null, setItem() {} }, document: { getElementById: () => null } });
  vm.runInContext(src, ctx);
  return ctx.__mock;
}
