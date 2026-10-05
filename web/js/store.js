// Dados do snapshot (objeto D, no formato do mock) + índices. Sem DOM: importável nos testes em Node.

// Ordem da árvore de projetos: coluna ID do Notion ("1.10" depois de "1.9"); sem ID vai para o fim, por nome.
export function porCodigo(a, b) {
  const ca = a?.codigo || ''; const cb = b?.codigo || '';
  if (ca && !cb) return -1;
  if (!ca && cb) return 1;
  return (ca && cb ? ca.localeCompare(cb, 'pt-BR', { numeric: true }) : 0) || String(a?.nome || '').localeCompare(String(b?.nome || ''), 'pt-BR');
}

export function buildIndex(D) {
  const byId = {};
  D.tree.forEach((n) => { byId[n.id] = n; });
  const children = {};
  D.tree.forEach((n) => { if (n.pai) (children[n.pai] = children[n.pai] || []).push(n.id); });
  Object.values(children).forEach((l) => l.sort((a, b) => porCodigo(byId[a], byId[b])));
  const rootOf = (id) => { let n = byId[id]; if (!n) return id; const seen = new Set(); while (n.pai && byId[n.pai] && !seen.has(n.id)) { seen.add(n.id); n = byId[n.pai]; } return n.id; };
  const pathOf = (id) => { const p = []; let n = byId[id]; while (n) { p.unshift(n.nome); n = n.pai ? byId[n.pai] : null; } return p; };
  const isLane = (n) => !!n.pai && !(children[n.id] || []).length;
  const objById = {}; D.objetivos.forEach((o) => { objById[o.id] = o; });
  const krById = {}; D.krs.forEach((k) => { krById[k.id] = k; });
  const metaById = {}; D.metas.forEach((m) => { metaById[m.id] = m; });
  const krsOf = (o) => D.krs.filter((k) => k.obj === o);
  const kpisOf = (k) => D.kpis.filter((x) => x.kr === k);
  const AREA_NAME = (key) => (D.areas[key] || {}).nome || key;
  const sprintNums = D.sprints_tri && D.sprints_tri.length ? D.sprints_tri : D.sprints.map((s) => s.n);
  const objLabel = (id) => (objById[id] ? objById[id].label : id);
  return { byId, children, rootOf, pathOf, isLane, objById, krById, metaById, krsOf, kpisOf, AREA_NAME, sprintNums, objLabel };
}

export const S = { D: null, I: null, meta: null };

// Quem está na lista de editores pode montar o rascunho e gravar — inclusive no modo TV (só o cabeçalho recolhe).
export const canWrite = () => !!S.meta?.pode_gravar;

export function setData(payload) {
  S.D = payload.D;
  S.meta = payload.meta;
  S.I = buildIndex(S.D);
  return S;
}
