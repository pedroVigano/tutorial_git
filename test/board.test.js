// Peças puras do board (aba Tática): ordem da árvore pela coluna ID, gráfico de KR (normalização e
// repetição da última medição) e layout das setas (ordem dos cards, portas, rotas).
import test from 'node:test';
import assert from 'node:assert/strict';
import { porCodigo, buildIndex } from '../web/js/store.js';
import { normaliza, normalizavel, pontos } from '../web/js/kchart.js';
import { ordemAuto, lados, portas, planejar, poli } from '../web/js/layout.js';
import { fakeWithDemo, snapshotOf } from './helpers.js';

test('árvore: ordem pela coluna ID (numérica por segmento), sem ID no fim, depois por nome', () => {
  const ns = [{ codigo: '1.10', nome: 'b' }, { codigo: '1.9', nome: 'a' }, { codigo: null, nome: 'z' }, { codigo: '1.2.1', nome: 'c' }, { codigo: null, nome: 'm' }, { codigo: '2', nome: 'x' }];
  assert.deepEqual(ns.slice().sort(porCodigo).map((n) => n.codigo || n.nome), ['1.2.1', '1.9', '1.10', '2', 'm', 'z']);
  const D = { tree: [{ id: 'p', pai: null, nome: 'P' }, { id: 'b', pai: 'p', nome: 'B', codigo: '1.10' }, { id: 'a', pai: 'p', nome: 'A', codigo: '1.2' }], objetivos: [], krs: [], kpis: [], metas: [], areas: {}, sprints: [] };
  assert.deepEqual(buildIndex(D).children.p, ['a', 'b'], 'filhos ordenados pelo ID');
});

test('snapshot: coluna ID dos Projetos vira codigo do nó (demo: 1, 1.1, 1.1.1…)', async () => {
  const { api } = fakeWithDemo();
  const D = await snapshotOf(api);
  const I = buildIndex(D);
  const raiz = D.tree.find((n) => !n.pai && n.tipo === 'Projeto' && n.codigo);
  assert.ok(raiz, 'projeto com código');
  const filho = I.byId[I.children[raiz.id][0]];
  assert.ok(filho.codigo.startsWith(`${raiz.codigo}.`), `filho ${filho.codigo} dentro de ${raiz.codigo}`);
});

test('gráfico de KR: % do alvo, para cima = melhor; sem alvo (ou alvo 0) não normaliza', () => {
  assert.equal(normaliza({ alvo: 4, dir: '≥' }, 2), 0.5);
  assert.equal(normaliza({ alvo: 4, dir: '=' }, 4), 1);
  assert.equal(normaliza({ alvo: 5, dir: '≤' }, 10), 0.5, '≤: alvo/valor');
  assert.equal(normaliza({ alvo: 5, dir: '≤' }, 0), Infinity);
  assert.equal(normaliza({ alvo: null, dir: '≥' }, 3), null);
  assert.equal(normalizavel({ alvo: 0, dir: '≤' }), false);
  assert.equal(normaliza({ alvo: 2, dir: '≥' }, null), null);
});

test('gráfico de KR: sprint sem medição depois de uma medição repete o último valor (até a sprint atual)', () => {
  const k = { serie: { 24: 1, 26: 3 } };
  const ps = pontos(k, [23, 24, 25, 26, 27, 28], 27);
  assert.deepEqual(ps.map((p) => [p.sp, p.v, p.rep]), [[24, 1, false], [25, 1, true], [26, 3, false], [27, 3, true]]);
  assert.equal(ps.find((p) => p.sp === 27).de, 26);
  assert.deepEqual(pontos({ serie: {} }, [23, 24], 24), [], 'sem medição: nada a repetir');
});

test('ordem automática: card vai para perto dos ligados; bloqueadora antes da bloqueada na mesma lane; lane manual não muda', () => {
  const lanes = new Map([['A', ['a1', 'a2', 'a3']], ['B', ['b1', 'b2', 'b3']], ['C', ['c2', 'c1']]]);
  const edges = [{ from: 'a3', to: 'b1' }, { from: 'c1', to: 'c2' }, { from: 'a1', to: 'c2' }];
  const o = ordemAuto(lanes, edges, { manual: new Set(['A']) });
  assert.deepEqual(o.get('A'), ['a1', 'a2', 'a3'], 'manual');
  assert.equal(o.get('B').at(-1), 'b1', 'b1 vai para o lado de a3 (fim)');
  assert.deepEqual(o.get('C'), ['c1', 'c2'], 'bloqueadora antes');
});

test('setas: lados pela geometria e portas espalhadas na borda, na ordem da outra ponta', () => {
  const A = { x: 0, y: 0, w: 100, h: 50 }; const B = { x: 0, y: 200, w: 100, h: 50 }; const C = { x: 200, y: 0, w: 100, h: 50 };
  assert.deepEqual(lados(A, B), ['s', 'n']);
  assert.deepEqual(lados(A, C), ['e', 'w']);
  const rects = new Map([['a', A], ['b', { x: -50, y: 200, w: 100, h: 50 }], ['c', { x: 150, y: 200, w: 100, h: 50 }]]);
  const ps = portas(rects, [{ a: 'a', b: 'c' }, { a: 'a', b: 'b' }]);
  assert.equal(ps[0].p1.lado, 's'); assert.equal(ps[1].p1.lado, 's');
  assert.ok(ps[1].p1.x < ps[0].p1.x, 'a seta para a esquerda sai mais à esquerda (não cruzam junto ao card)');
});

test('setas: rota longa vai pelo corredor; vizinhas e mesma fileira ficam curtas; grupo recolhido entra pela direita', () => {
  const A = { x: 400, y: 0, w: 200, h: 80 };
  assert.equal(planejar(A, { x: 400, y: 600, w: 200, h: 80 }).tipo, 'guia');
  assert.equal(planejar(A, { x: 400, y: 100, w: 200, h: 80 }).tipo, 'vert');
  assert.equal(planejar(A, { x: 620, y: 0, w: 200, h: 80 }).tipo, 'lado');
  assert.equal(planejar(A, { x: 900, y: 0, w: 200, h: 80 }).tipo, 'topo');
  assert.deepEqual(planejar(A, { x: 0, y: 600, w: 250, h: 60 }, { grupoB: true }).lados, ['s', 'e']);
  assert.match(poli([{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 80, y: 50 }]), /^M0,0 L0,44 Q0,50 6,50 L80,50$/);
});
