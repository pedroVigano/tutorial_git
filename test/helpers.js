// Utilitários de teste: Notion falso com os dados do mock e API sem limitador.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createFakeNotion } from '../server/notion/fake.js';
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
