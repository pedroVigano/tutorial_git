// Paridade com o mock v2.2: as regras portadas para web/js/rules.js dão o mesmo resultado que o código
// original do mock (executado numa VM), tanto sobre o D do mock quanto sobre o D reconstruído a partir
// do Notion falso (mock → páginas do Notion → snapshot).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mockRules, fakeWithDemo, snapshotOf } from './helpers.js';
import { buildIndex } from '../web/js/store.js';
import { kpiStatus, krStatus, objStatus, computeAlerts } from '../web/js/rules.js';

const withLabels = (D) => ({ ...D, objetivos: D.objetivos.map((o) => ({ ...o, label: o.id })) });

test('status de KPI, KR e objetivo iguais aos do mock', () => {
  const m = mockRules();
  const D = withLabels(m.D);
  const I = buildIndex(D);
  for (const k of D.kpis) assert.deepEqual(kpiStatus(k), { ...m.kpiStatus(k) }, k.titulo);
  for (const kr of D.krs) assert.deepEqual(krStatus(I, kr), { ...m.krStatus(kr) }, kr.titulo);
  for (const o of D.objetivos) assert.deepEqual(objStatus(I, o), { ...m.objStatus(o) }, o.titulo);
});

// Diferenças intencionais de redação da versão real
const norm = (s) => s.replace('fora dos 4 projetos', 'fora dos projetos').replace('P&D (diretoria)', 'P&D');
const ignorar = (s) => /^warn\|O2: /.test(s) || s.includes('"Fora dos 4 projetos') || s.includes('(exemplo)');

test('alertas por regra iguais aos do mock (sobre o D do mock)', () => {
  const m = mockRules();
  const D = withLabels(m.D);
  const mock = [...m.computeAlerts()].map((a) => `${a.sev}|${norm(a.t)}`).filter((s) => !ignorar(s));
  const ours = computeAlerts(D, buildIndex(D), { sprint: 27, obj: 'all' }).map((a) => `${a.sev}|${norm(a.t)}`).filter((s) => !ignorar(s));
  assert.deepEqual(ours, mock);
});

test('alertas iguais aos do mock depois da ida e volta pelo Notion (fake)', async () => {
  const m = mockRules();
  const mock = [...m.computeAlerts()].map((a) => `${a.sev}|${norm(a.t)}`).filter((s) => !ignorar(s));
  const { api } = fakeWithDemo();
  const D = await snapshotOf(api);
  const ours = computeAlerts(D, buildIndex(D), { sprint: 27, obj: 'all' }).map((a) => `${a.sev}|${norm(a.t)}`).filter((s) => !ignorar(s));
  // mesma lista; a ordem dentro de uma severidade segue a ordem da árvore no Notion
  assert.deepEqual([...ours].sort(), [...mock].sort());
});

test('KPI sem alvo pede definição; ≤ e = seguem a regra do mock', () => {
  assert.equal(kpiStatus({ alvo: null, dir: '≥', serie: {} }).txt, '⚠ definir alvo');
  assert.equal(kpiStatus({ alvo: 5, dir: '≤', serie: { 26: 4 } }).txt, 'Atingido');
  assert.equal(kpiStatus({ alvo: 5, dir: '≤', serie: { 26: 7 } }).txt, 'Parcial');
  assert.equal(kpiStatus({ alvo: 2, dir: '=', serie: { 26: 0 } }).txt, 'Não atingido');
  assert.equal(kpiStatus({ alvo: 2, dir: '=', serie: {} }).txt, 'sem medição');
});
