// Páginas cruas do Notion → objeto `D` no mesmo formato do mock v2.2 (função pura, testada com fixtures).
import { read, titleOf, iconOf, normId, withDashes } from '../notion/props.js';
import { DIRETORIA, TIPOS_OCULTOS } from '../notion/schema.js';
import { areaDisplay, normName } from '../display.js';

const ID = (x) => withDashes(normId(x));
const normTipo = (t) => normName(t).replace(/[\s-]+/g, ' ');
const OCULTOS = new Set(TIPOS_OCULTOS.map(normTipo));
const tipoOculto = (t) => OCULTOS.has(normTipo(t));
const rel = (page, base, key) => (page.__rel?.[key] || read(page, base, key)).map(ID);
const first = (arr) => (arr && arr.length ? arr[0] : null);

export const OUTROS = 'outros';
export const STATUS_TAREFA = ['A Fazer', 'Em Andamento', 'Em Revisão', 'Concluída', 'Bloqueada'];

const fmtLido = (iso) => new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso)).replace(',', '');

function quarterBounds(tri) {
  const m = /^(\d{4})\s*-\s*(\d)$/.exec(tri || '');
  if (!m) return null;
  const y = Number(m[1]); const q = Number(m[2]);
  const start = new Date(Date.UTC(y, (q - 1) * 3, 1));
  const end = new Date(Date.UTC(y, q * 3, 0));
  return { ini: start.toISOString().slice(0, 10), fim: end.toISOString().slice(0, 10) };
}

const curto = (titulo, max = 28) => {
  const t = titulo.replace(/^\p{Extended_Pictographic}\s*/u, '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 12 ? cut.lastIndexOf(' ') : max).replace(/[,;:]$/, '')}…`;
};

// Status do Notion e trimestres (multi-select) de um item de OKR.
const okrMeta = (p) => ({ status: read(p, 'okrs', 'status') || null, trimestres: read(p, 'okrs', 'trimestre'), ordem: read(p, 'okrs', 'ordem'), origem: read(p, 'okrs', 'origem').map(ID) });
// Ordem do Notion (vazia vai para o fim); empate pelo critério anterior.
const porOrdem = (a, b) => (read(a, 'okrs', 'ordem') ?? Infinity) - (read(b, 'okrs', 'ordem') ?? Infinity) || 0;

export function buildSnapshot(raw, { sprintN } = {}) {
  const users = raw.users || {};

  // ---------- sprints ----------
  const sprints = raw.sprints
    .map((p) => {
      const d = read(p, 'sprints', 'data');
      return { id: ID(p.id), n: read(p, 'sprints', 'numero'), ini: d?.start?.slice(0, 10) || null, fim: (d?.end || d?.start || '').slice(0, 10) || null, status: read(p, 'sprints', 'status') || '—', url: p.url, nome: titleOf(p) };
    })
    .filter((s) => Number.isFinite(s.n))
    .sort((a, b) => a.n - b.n);
  const sprintById = new Map(sprints.map((s) => [s.id, s]));
  const sel = sprintById.get(ID(raw.sprintId)) || sprints.find((s) => s.n === sprintN);
  const qb = quarterBounds(raw.tri);
  let sprintsTri = sprints.filter((s) => qb && s.ini && s.fim && s.ini <= qb.fim && s.fim >= qb.ini && s.n <= sel.n).map((s) => s.n);
  if (sprintsTri.length < 2) sprintsTri = sprints.filter((s) => s.n <= sel.n).slice(-5).map((s) => s.n);
  sprintsTri = sprintsTri.slice(-8);

  // ---------- áreas ----------
  const areaPages = new Map(raw.areas.map((p) => [ID(p.id), p]));
  const isPD = (id, seen = new Set()) => {
    const p = areaPages.get(id);
    if (!p || seen.has(id)) return false;
    seen.add(id);
    if (read(p, 'areas', 'diretoria') === DIRETORIA) return true;
    if (normName(titleOf(p)).startsWith(normName(DIRETORIA))) return true;
    const pai = first(rel(p, 'areas', 'pai'));
    return pai ? isPD(pai, seen) : false;
  };
  const usados = new Set();
  const areas = {};
  const areaKey = new Map();
  // equipes de P&D primeiro, para ficarem com as chaves/cores conhecidas
  const areaOrder = [...areaPages.entries()].sort(([a], [b]) => Number(isPD(b)) - Number(isPD(a)));
  for (const [id, p] of areaOrder) {
    const nome = titleOf(p);
    const disp = areaDisplay(nome, usados);
    usados.add(disp.key);
    areaKey.set(id, disp.key);
    areas[disp.key] = { id, nome, url: p.url, c: disp.c, cd: disp.cd, ext: !isPD(id), nivel: read(p, 'areas', 'nivel') };
  }
  const keysOf = (ids) => [...new Set(ids.map((id) => areaKey.get(id)).filter(Boolean))];

  // ---------- árvore de projetos ----------
  const nodes = new Map();
  for (const p of raw.projetos) {
    const resp = first(read(p, 'projetos', 'responsavel'));
    nodes.set(ID(p.id), {
      id: ID(p.id), pai: first(rel(p, 'projetos', 'pai')), tipo: read(p, 'projetos', 'tipo') || '—',
      nome: titleOf(p), status: read(p, 'projetos', 'status') || '—', codigo: read(p, 'projetos', 'codigo') || null,
      resp: resp ? (resp.nome || users[resp.id] || `pessoa ${resp.id.slice(0, 4)}`) : null,
      areas: keysOf(rel(p, 'projetos', 'area')), url: p.url,
    });
  }
  // Tipos fora do modelo (Entregável-Chave): saem da árvore, os filhos sobem para o ancestral visível mais
  // próximo, e metas/desejos ligados a eles aparecem nesse ancestral. Sem ancestral, o item fica como está.
  const ocultoPara = new Map();
  for (const n of nodes.values()) {
    if (!tipoOculto(n.tipo)) continue;
    let a = n.pai; const seen = new Set([n.id]);
    while (a && nodes.has(a) && tipoOculto(nodes.get(a).tipo) && !seen.has(a)) { seen.add(a); a = nodes.get(a).pai; }
    if (a && nodes.has(a) && !tipoOculto(nodes.get(a).tipo)) ocultoPara.set(n.id, a);
  }
  const ocultos = [...ocultoPara].map(([id, pai]) => ({ id, nome: nodes.get(id).nome, tipo: nodes.get(id).tipo, pai, url: nodes.get(id).url }));
  const ocultoNome = new Map(ocultos.map((o) => [o.id, o.nome]));
  for (const id of ocultoPara.keys()) nodes.delete(id);
  for (const n of nodes.values()) if (ocultoPara.has(n.pai)) n.pai = ocultoPara.get(n.pai);
  const exib = (id) => ocultoPara.get(id) || id;
  // relação com a árvore → ids exibidos (sem repetição) + via_ec {idExibido: [Entregáveis-Chave de origem]}
  const relArvore = (ids) => {
    const subs = []; const via = {};
    for (const id of ids) {
      const e = exib(id);
      if (!subs.includes(e)) subs.push(e);
      if (e !== id) (via[e] ||= []).push({ id, nome: ocultoNome.get(id) });
    }
    return { subs, via_ec: Object.keys(via).length ? via : null };
  };

  const rootOf = (id) => {
    let n = nodes.get(exib(id)); const seen = new Set();
    while (n && n.pai && nodes.has(n.pai) && !seen.has(n.id)) { seen.add(n.id); n = nodes.get(n.pai); }
    return n ? n.id : id;
  };

  // ---------- OKRs ----------
  const objPages = raw.objetivos.filter((p) => {
    const a = rel(p, 'okrs', 'area');
    return a.some((id) => isPD(id));
  });
  objPages.sort((a, b) => porOrdem(a, b) || (() => {
    const la = read(a, 'okrs', 'limite')?.start || '9999'; const lb = read(b, 'okrs', 'limite')?.start || '9999';
    return la.localeCompare(lb) || a.created_time.localeCompare(b.created_time);
  })());
  const objetivos = objPages.map((p, i) => {
    const titulo = titleOf(p);
    const linked = rel(p, 'okrs', 'projetos');
    const roots = [...new Set(linked.map(rootOf))];
    const vivos = roots.filter((r) => nodes.has(r) && nodes.get(r).status !== 'Abortado');
    const abortados = roots.filter((r) => nodes.get(r)?.status === 'Abortado');
    return {
      id: ID(p.id), label: `O${i + 1}`, icone: iconOf(p) || '◎', curto: curto(titulo), titulo, url: p.url,
      projetos: vivos, areas: keysOf(rel(p, 'okrs', 'area')), ...okrMeta(p),
      limite: read(p, 'okrs', 'limite')?.start?.slice(0, 10) || null,
      alerta: abortados.length ? `Também aponta para projeto abortado: ${abortados.map((r) => `"${nodes.get(r).nome}"`).join(', ')} — reapontar` : null,
    };
  });
  const objIdx = new Map(objetivos.map((o, i) => [o.id, i]));
  const krs = [];
  const krByObj = new Map();
  for (const p of raw.krs) {
    const obj = rel(p, 'okrs', 'pai').find((id) => objIdx.has(id));
    if (!obj) continue;
    const list = krByObj.get(obj) || [];
    list.push(p); krByObj.set(obj, list);
  }
  for (const o of objetivos) {
    const list = (krByObj.get(o.id) || []).sort((a, b) => porOrdem(a, b) || a.created_time.localeCompare(b.created_time));
    list.forEach((p, j) => krs.push({
      id: ID(p.id), label: `K${o.label.slice(1)}${String.fromCharCode(97 + j)}`, obj: o.id, titulo: titleOf(p),
      limite: read(p, 'okrs', 'limite')?.start?.slice(0, 10) || null, url: p.url, ...okrMeta(p),
    }));
  }
  const krIds = new Set(krs.map((k) => k.id));
  const krById = new Map(krs.map((k) => [k.id, k]));
  const sprintNOf = (id) => sprintById.get(id)?.n;

  const medByKpi = new Map();
  for (const m of [...raw.medicoes].sort((a, b) => a.created_time.localeCompare(b.created_time))) {
    const n = sprintNOf(first(rel(m, 'medicoes', 'sprint')));
    const v = read(m, 'medicoes', 'valor');
    if (n == null) continue;
    // KPI duplicado para outro trimestre fica na mesma medição: vale para todos os KPIs da relação
    for (const kpi of rel(m, 'medicoes', 'kpi')) {
      const e = medByKpi.get(kpi) || { serie: {}, medicoes: {} };
      if (v != null) e.serie[String(n)] = v;
      e.medicoes[String(n)] = ID(m.id);
      medByKpi.set(kpi, e);
    }
  }
  const kpiN = new Map(); // numeração dos KPIs dentro de cada KR
  const krPos = new Map(krs.map((k, i) => [k.id, i]));
  const kpis = raw.kpis
    .map((p) => ({ p, kr: rel(p, 'okrs', 'pai').find((id) => krIds.has(id)) }))
    .filter((x) => x.kr)
    .sort((a, b) => krPos.get(a.kr) - krPos.get(b.kr) || porOrdem(a.p, b.p) || a.p.created_time.localeCompare(b.p.created_time))
    .map(({ p, kr }) => {
      const i = (kpiN.get(kr) || 0); kpiN.set(kr, i + 1);
      const med = medByKpi.get(ID(p.id)) || { serie: {}, medicoes: {} };
      return {
        id: ID(p.id), label: `${krById.get(kr).label}.${i + 1}`, kr, titulo: titleOf(p), url: p.url,
        alvo: read(p, 'okrs', 'alvo'), unidade: read(p, 'okrs', 'unidade'), dir: read(p, 'okrs', 'direcao'),
        limite: read(p, 'okrs', 'limite')?.start?.slice(0, 10) || null,
        serie: med.serie, medicoes: med.medicoes, ...okrMeta(p),
      };
    });
  const kpiById = new Map(kpis.map((k) => [k.id, k]));

  // ---------- metas ----------
  const extraTitle = new Map([...raw.objetivos, ...(raw.okrsExtra || [])].map((p) => [ID(p.id), titleOf(p)]));
  const toObj = (id) => {
    if (objIdx.has(id)) return id;
    if (krById.has(id)) return krById.get(id).obj;
    if (kpiById.has(id)) return krById.get(kpiById.get(id).kr)?.obj || null;
    return null;
  };
  const tarefasPorMeta = new Map();
  const tarefas = (raw.tarefas || []).map((p) => {
    const t = {
      id: ID(p.id), url: p.url, titulo: titleOf(p), status: read(p, 'tarefas', 'status') || '—',
      metas: rel(p, 'tarefas', 'meta'), sprints: rel(p, 'tarefas', 'sprint').map(sprintNOf).filter((n) => n != null).sort((a, b) => a - b),
      resp: read(p, 'tarefas', 'responsavel').map((u) => u.nome || users[u.id] || `pessoa ${u.id.slice(0, 4)}`).join(', ') || null,
    };
    for (const m of t.metas) { const l = tarefasPorMeta.get(m) || []; l.push(t); tarefasPorMeta.set(m, l); }
    return t;
  });

  const metaFrom = (p) => {
    const areaIds = rel(p, 'metas', 'area');
    const okrIds = rel(p, 'metas', 'okr');
    const okrs = [...new Set(okrIds.map(toObj).filter(Boolean))];
    const okrsExtra = okrIds.filter((id) => !toObj(id)).map((id) => extraTitle.get(id) || 'OKR fora do trimestre ou de outra diretoria');
    const sp = rel(p, 'metas', 'sprint').map(sprintNOf).filter((n) => n != null).sort((a, b) => a - b);
    const ts = (tarefasPorMeta.get(ID(p.id)) || []).filter((t) => t.status !== 'Abortada');
    const cont = ts.length ? Object.fromEntries(STATUS_TAREFA.map((s) => [s, ts.filter((t) => t.status === s).length])) : null;
    const ak = keysOf(areaIds);
    const { subs, via_ec } = relArvore(rel(p, 'metas', 'subsistema'));
    return {
      id: ID(p.id), url: p.url, titulo: titleOf(p), status: read(p, 'metas', 'status') || 'Não iniciada',
      area: ak[0] || 'pd', areas: ak, sprints: sp, n_sprints: sp.length,
      subs, subs_unknown: [], ...(via_ec ? { via_ec } : {}),
      okrs, okrs_extra: okrsExtra, bloq: rel(p, 'metas', 'bloqueadoPor'), tarefas: cont,
    };
  };
  const metas = raw.metas.map(metaFrom);
  const metaIds = new Set(metas.map((m) => m.id));
  for (const p of raw.metasExtra || []) if (!metaIds.has(ID(p.id))) metas.push({ ...metaFrom(p), fora: true });

  // ---------- desejos ----------
  const hoje = raw.lidoEm.slice(0, 10);
  const desejos = raw.desejos.map((p) => {
    const criado = (p.created_time || hoje).slice(0, 10);
    return {
      id: ID(p.id), url: p.url, titulo: titleOf(p), status: read(p, 'desejos', 'status'),
      stakeholder: read(p, 'desejos', 'stakeholder').join(' / ') || '—', evidencia: read(p, 'desejos', 'evidencia') || '—',
      subs: relArvore(rel(p, 'desejos', 'projetos')).subs,
      sprints_em_analise: Math.max(1, sprints.filter((s) => s.fim && s.fim >= criado && s.ini <= hoje).length),
    };
  });

  // ---------- árvore visível: projetos dos objetivos + "outros" ----------
  const referenced = new Set([
    ...metas.filter((m) => !m.fora).flatMap((m) => m.subs),
    ...desejos.flatMap((d) => d.subs),
  ]);
  const childrenOf = new Map();
  for (const n of nodes.values()) if (n.pai) { const l = childrenOf.get(n.pai) || []; l.push(n.id); childrenOf.set(n.pai, l); }
  const subtreeReferenced = (id, seen = new Set()) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return referenced.has(id) || (childrenOf.get(id) || []).some((c) => subtreeReferenced(c, seen));
  };
  // Projetos visíveis: os dos objetivos do trimestre + projetos-raiz de P&D (Área) não abortados;
  // um projeto concluído só aparece se ainda tiver meta ou desejo nesta sprint.
  const projetosPD = [...nodes.values()]
    .filter((n) => n.tipo === 'Projeto' && !(n.pai && nodes.has(n.pai)) && n.status !== 'Abortado')
    .filter((n) => raw.projetos.some((p) => ID(p.id) === n.id && rel(p, 'projetos', 'area').some((a) => isPD(a))))
    .filter((n) => n.status !== 'Concluído' || subtreeReferenced(n.id))
    .map((n) => n.id);
  const visibleRoots = [...new Set([...objetivos.flatMap((o) => o.projetos), ...projetosPD])];
  const tree = [];
  const inTree = new Set();
  const walk = (id) => {
    const n = nodes.get(id);
    const kids = (childrenOf.get(id) || []).map(walk).some(Boolean);
    const keep = n && (n.status !== 'Abortado' || referenced.has(id) || kids);
    if (keep) inTree.add(id);
    return keep;
  };
  visibleRoots.forEach((r) => { walk(r); inTree.add(r); });
  for (const n of nodes.values()) if (inTree.has(n.id)) tree.push({ ...n, pai: n.pai && inTree.has(n.pai) ? n.pai : null });

  const foraIds = [...referenced].filter((id) => !inTree.has(id));
  if (foraIds.length) {
    tree.push({ id: OUTROS, pai: null, tipo: 'Projeto', nome: 'Fora dos projetos dos objetivos (itens antigos ou de outras diretorias)', status: '—', resp: null, areas: [], url: null });
    for (const id of foraIds) {
      const n = nodes.get(id);
      if (n) tree.push({ ...n, pai: OUTROS });
      else {
        tree.push({ id, pai: OUTROS, tipo: 'Subsistema', nome: `(sem acesso) ${id.slice(0, 8)}`, status: '—', resp: null, areas: [], url: null, sem_acesso: true });
        metas.forEach((m) => { if (m.subs.includes(id)) m.subs_unknown.push(id); });
      }
    }
  }

  const lido = raw.lidoEm;
  return {
    lido_em: `${fmtLido(lido)} (America/Sao_Paulo)`,
    lido_em_iso: lido,
    trimestre: { id: raw.tri, fim: qb?.fim || null },
    sprint: sel.n,
    sprints: sprints.map(({ nome, ...s }) => s),
    sprints_tri: sprintsTri,
    areas,
    projetos: Object.fromEntries(visibleRoots.map((r) => [r, nodes.get(r)?.url || null])),
    objetivos, krs, kpis, tree, metas, tarefas, desejos,
    ...(ocultos.length ? { ocultos } : {}),
  };
}
