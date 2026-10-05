// Layout das dependências entre metas (funções puras, testadas em Node — test/layout.test.js).
// 1. ordemAuto: ordem dos cards em cada lane que reduz cruzamentos — cada card vai para perto da média das
//    posições dos cards ligados a ele (baricentro), em algumas passadas; na mesma lane, a bloqueadora fica antes
//    da bloqueada. Lanes com ordem manual (arrastada pela pessoa) não mudam.
// 2. portas: em que lado do card cada seta sai/chega e em que ponto desse lado — várias setas no mesmo lado se
//    espalham pela borda, na ordem da outra ponta, para não se cruzarem junto ao card.

// lanes: Map laneId → [metaId] (ordem de partida) · edges: [{from, to}] (bloqueadora → bloqueada)
// manual: Set de laneIds com ordem manual · devolve Map laneId → [metaId]
export function ordemAuto(lanes, edges, { manual = new Set(), passadas = 4 } = {}) {
  const ordem = new Map([...lanes].map(([l, ids]) => [l, ids.slice()]));
  const viz = new Map(); // metaId → [{id, papel: 'bloqueadora'|'bloqueada'}] (papel do vizinho)
  const add = (a, b, papel) => { if (!viz.has(a)) viz.set(a, []); viz.get(a).push({ id: b, papel }); };
  edges.forEach((e) => { if (e.from !== e.to) { add(e.to, e.from, 'bloqueadora'); add(e.from, e.to, 'bloqueada'); } });
  const pos = () => { // metaId → posições (uma por lane em que a meta aparece)
    const p = new Map();
    ordem.forEach((ids, l) => ids.forEach((id, i) => { if (!p.has(id)) p.set(id, []); p.get(id).push({ l, x: i }); }));
    return p;
  };
  for (let k = 0; k < passadas; k += 1) {
    const P = pos();
    ordem.forEach((ids, l) => {
      if (manual.has(l) || ids.length < 2) return;
      const chave = new Map(ids.map((id, i) => {
        const vs = (viz.get(id) || []).flatMap((v) => (P.get(v.id) || []).map((q) => {
          if (q.l !== l) return q.x;
          return v.papel === 'bloqueadora' ? q.x + 0.5 : q.x - 0.5; // mesma lane: bloqueadora antes
        }));
        return [id, vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : i];
      }));
      const idx = new Map(ids.map((id, i) => [id, i]));
      // empate: o card ligado que "quer" ir para a direita fica depois do que não se mexe (e vice-versa)
      const rumo = (id) => Math.sign(chave.get(id) - idx.get(id));
      ids.sort((a, b) => chave.get(a) - chave.get(b) || rumo(a) - rumo(b) || idx.get(a) - idx.get(b));
      // regra firme na mesma lane: bloqueadora antes da bloqueada (ciclos ficam como estão)
      const naLane = new Set(ids);
      const dentro = edges.filter((e) => naLane.has(e.from) && naLane.has(e.to) && e.from !== e.to);
      for (let r = 0; r < ids.length; r += 1) {
        const e = dentro.find((x) => ids.indexOf(x.from) > ids.indexOf(x.to));
        if (!e) break;
        ids.splice(ids.indexOf(e.from), 1);
        ids.splice(ids.indexOf(e.to), 0, e.from);
      }
    });
  }
  return ordem;
}

// Lados das pontas de uma seta entre dois retângulos {x, y, w, h} (coordenadas da área das lanes).
export function lados(a, b) {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }; const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const sobrepoeY = a.y < b.y + b.h && b.y < a.y + a.h;
  const sobrepoeX = a.x < b.x + b.w && b.x < a.x + a.w;
  if (sobrepoeY && !sobrepoeX) return cb.x >= ca.x ? ['e', 'w'] : ['w', 'e']; // mesma linha
  if (!sobrepoeY && (sobrepoeX || Math.abs(cb.y - ca.y) * 1.2 >= Math.abs(cb.x - ca.x) * 0.5)) return cb.y >= ca.y ? ['s', 'n'] : ['n', 's'];
  return cb.x >= ca.x ? ['e', 'w'] : ['w', 'e'];
}

// rects: Map chave → {x,y,w,h}; ligs: [{a, b, lados?}] (chaves das pontas; lados forçados opcionais)
// → [{p1:{x,y,lado}, p2:{x,y,lado}}]
export function portas(rects, ligs) {
  const pontas = new Map(); // `${chave}|${lado}` → [{lig, ponta: 'p1'|'p2', outra: {x,y}}]
  const res = ligs.map(() => ({}));
  ligs.forEach((g, i) => {
    const A = rects.get(g.a); const B = rects.get(g.b);
    const [la, lb] = g.lados || lados(A, B);
    const centro = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    [[g.a, la, 'p1', centro(B)], [g.b, lb, 'p2', centro(A)]].forEach(([chave, lado, ponta, outra]) => {
      const k = `${chave}|${lado}`;
      if (!pontas.has(k)) pontas.set(k, []);
      pontas.get(k).push({ i, ponta, outra });
    });
  });
  pontas.forEach((lista, k) => {
    const [chave, lado] = [k.slice(0, k.lastIndexOf('|')), k.slice(k.lastIndexOf('|') + 1)];
    const r = rects.get(chave);
    const horiz = lado === 'n' || lado === 's';
    lista.sort((p, q) => (horiz ? p.outra.x - q.outra.x : p.outra.y - q.outra.y));
    lista.forEach((p, j) => {
      const t = (j + 1) / (lista.length + 1);
      const x = horiz ? r.x + r.w * t : (lado === 'e' ? r.x + r.w : r.x);
      const y = horiz ? (lado === 's' ? r.y + r.h : r.y) : r.y + r.h * t;
      res[p.i][p.ponta] = { x, y, lado };
    });
  });
  return res;
}

const DIR = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };
// Curva entre duas portas, com os controles saindo na direção do lado.
export function caminho(p1, p2) {
  const c = Math.max(28, Math.min(140, Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2));
  const [a, b] = [DIR[p1.lado], DIR[p2.lado]];
  return `M${p1.x},${p1.y} C${p1.x + a[0] * c},${p1.y + a[1] * c} ${p2.x + b[0] * c},${p2.y + b[1] * c} ${p2.x},${p2.y}`;
}

// Tipo de rota entre dois retângulos:
//   'lado'  mesma fileira e vizinhos → curva pelos lados (e/w)
//   'topo'  mesma fileira, com cards no meio → sai pelo topo, corre no vão acima da fileira, entra pelo topo
//   'vert'  fileiras vizinhas (vão vertical curto) → curva de baixo para cima
//   'guia'  longe na vertical → corredor vertical entre as colunas Desejos e Metas (não atravessa cards),
//           com os trechos horizontais nos vãos entre fileiras. Ponta que é cabeçalho de grupo recolhido
//           entra/sai pelo lado direito (e).
export function planejar(A, B, { grupoA = false, grupoB = false, vao = 40, vizinho = 40 } = {}) {
  const sobrepoeY = A.y < B.y + B.h && B.y < A.y + A.h;
  const desce = B.y >= A.y;
  const gapV = desce ? B.y - (A.y + A.h) : A.y - (B.y + B.h);
  if (grupoA || grupoB) {
    if (sobrepoeY && !(grupoA && grupoB)) return { tipo: 'lado', lados: lados(A, B) };
    return { tipo: 'guia', lados: [grupoA ? 'e' : (desce ? 's' : 'n'), grupoB ? 'e' : (desce ? 'n' : 's')] };
  }
  if (sobrepoeY) {
    const gapH = B.x >= A.x ? B.x - (A.x + A.w) : A.x - (B.x + B.w);
    return gapH <= vizinho ? { tipo: 'lado', lados: lados(A, B) } : { tipo: 'topo', lados: ['n', 'n'] };
  }
  if (gapV <= vao) return { tipo: 'vert', lados: desce ? ['s', 'n'] : ['n', 's'] };
  return { tipo: 'guia', lados: desce ? ['s', 'n'] : ['n', 's'] };
}

// Polilinha com cantos arredondados.
export function poli(pts, r = 6) {
  const q = pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);
  let d = `M${q[0].x},${q[0].y}`;
  for (let i = 1; i < q.length - 1; i += 1) {
    const a = q[i - 1]; const b = q[i]; const c = q[i + 1];
    const r1 = Math.min(r, Math.hypot(b.x - a.x, b.y - a.y) / 2); const r2 = Math.min(r, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    const u = { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) }; const v = { x: Math.sign(c.x - b.x), y: Math.sign(c.y - b.y) };
    d += ` L${b.x - u.x * r1},${b.y - u.y * r1} Q${b.x},${b.y} ${b.x + v.x * r2},${b.y + v.y * r2}`;
  }
  const z = q[q.length - 1];
  return `${d} L${z.x},${z.y}`;
}

// Desenho da rota: gx = x do corredor (rota 'guia'); off = deslocamento para rotas paralelas não se sobreporem.
export function desenhar(tipo, p1, p2, { gx = 0, off = 0 } = {}) {
  if (tipo === 'lado' || tipo === 'vert') return caminho(p1, p2);
  const sai = (p, d) => ({ n: { x: p.x, y: p.y - d }, s: { x: p.x, y: p.y + d }, e: { x: p.x + d, y: p.y }, w: { x: p.x - d, y: p.y } }[p.lado]);
  if (tipo === 'topo') {
    const y = Math.min(p1.y, p2.y) - 5 - off;
    return poli([p1, { x: p1.x, y }, { x: p2.x, y }, p2]);
  }
  const d = 5 + off;
  const a = sai(p1, d); const b = sai(p2, d);
  const pts = [p1, a];
  if (p1.lado === 'e') pts.push({ x: gx, y: a.y }); else pts.push({ x: gx, y: a.y });
  if (p2.lado === 'e') pts.push({ x: gx, y: p2.y }, p2);
  else pts.push({ x: gx, y: b.y }, b, p2);
  return poli(pts);
}
