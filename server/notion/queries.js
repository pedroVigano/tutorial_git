// Leitura das bases do Notion para montar um snapshot da sprint.
// Devolve as páginas cruas; a transformação para o formato do dashboard fica em snapshot/build.js.
import { read, relationTruncated } from './props.js';
import { queryByRelationAny, propRef } from './client.js';

const RELACOES_USADAS = {
  metas: ['okr', 'subsistema', 'sprint', 'area', 'bloqueadoPor'],
  okrs: ['pai', 'area', 'projetos'],
  projetos: ['pai', 'area'],
  desejos: ['projetos'],
  tarefas: ['meta', 'sprint'],
};

// Relações acima de 25 itens vêm cortadas: busca a lista completa e guarda em page.__rel.
async function expandRelations(api, pages, base) {
  for (const page of pages) {
    for (const key of RELACOES_USADAS[base] || []) {
      if (relationTruncated(page, base, key)) {
        page.__rel = page.__rel || {};
        page.__rel[key] = await api.relationIds(page, base, key);
      }
    }
  }
  return pages;
}

export const quarterOf = (isoDate) => {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return `${d.getUTCFullYear()} - ${Math.floor(d.getUTCMonth() / 3) + 1}`;
};

export function pickSprint(sprintPages, requestedN, today = new Date().toISOString().slice(0, 10)) {
  const list = sprintPages
    .map((p) => ({ page: p, n: read(p, 'sprints', 'numero'), status: read(p, 'sprints', 'status'), data: read(p, 'sprints', 'data') }))
    .filter((s) => Number.isFinite(s.n));
  if (requestedN != null) return list.find((s) => s.n === Number(requestedN)) || null;
  const andamento = list.filter((s) => s.status === 'Em andamento').sort((a, b) => b.n - a.n)[0];
  if (andamento) return andamento;
  const atual = list.filter((s) => s.data?.start && s.data.start <= today).sort((a, b) => b.n - a.n)[0];
  return atual || list.sort((a, b) => b.n - a.n)[0] || null;
}

const userCache = new Map();

export async function loadRaw(api, { sprint: requestedN, tri: requestedTri, today } = {}) {
  const [sprints, areas, projetos, desejos] = await Promise.all([
    api.queryAll('sprints'),
    api.queryAll('areas'),
    api.queryAll('projetos'),
    api.queryAll('desejos', { filter: { property: propRef('desejos', 'status'), status: { equals: 'Em análise' } } }),
  ]);

  const sel = pickSprint(sprints, requestedN, today);
  if (!sel) {
    const err = new Error(requestedN != null ? `Sprint #${requestedN} não encontrada` : 'Nenhuma sprint encontrada na base 🏃 Sprints');
    err.statusCode = 404;
    throw err;
  }
  const tri = requestedTri || quarterOf(sel.data?.start || today || new Date().toISOString().slice(0, 10));

  const objetivos = await api.queryAll('okrs', {
    filter: { and: [
      { property: propRef('okrs', 'grau'), select: { equals: 'Objetivo' } },
      { property: propRef('okrs', 'trimestre'), multi_select: { contains: tri } },
    ] },
  });
  const krs = (await queryByRelationAny(api, 'okrs', 'pai', objetivos.map((p) => p.id)))
    .filter((p) => read(p, 'okrs', 'grau') === 'Resultado-Chave');
  const kpis = (await queryByRelationAny(api, 'okrs', 'pai', krs.map((p) => p.id)))
    .filter((p) => read(p, 'okrs', 'grau') === 'KPI');

  const [medicoes, metas] = await Promise.all([
    queryByRelationAny(api, 'medicoes', 'kpi', kpis.map((p) => p.id)),
    api.queryAll('metas', { filter: { property: propRef('metas', 'sprint'), relation: { contains: sel.page.id } } }),
  ]);
  await Promise.all([
    expandRelations(api, metas, 'metas'),
    expandRelations(api, objetivos, 'okrs'),
    expandRelations(api, projetos, 'projetos'),
    expandRelations(api, desejos, 'desejos'),
  ]);

  const norm = (id) => id.replace(/-/g, '');
  const metaIds = new Set(metas.map((p) => norm(p.id)));
  const relIds = (p, key) => p.__rel?.[key] || read(p, 'metas', key);

  // Bloqueadoras fora da sprint: buscadas uma a uma (poucas)
  const fora = [...new Set(metas.flatMap((p) => relIds(p, 'bloqueadoPor')))].filter((id) => !metaIds.has(norm(id))).slice(0, 40);
  const metasExtra = (await Promise.all(fora.map((id) => api.retrievePage(id).catch(() => null)))).filter(Boolean);

  // OKRs citados por metas que não são objetivos/KRs/KPIs do trimestre (título para o alerta)
  const okrIds = new Set([...objetivos, ...krs, ...kpis].map((p) => norm(p.id)));
  const extraOkr = [...new Set(metas.flatMap((p) => relIds(p, 'okr')))].filter((id) => !okrIds.has(norm(id))).slice(0, 40);
  const okrsExtra = (await Promise.all(extraOkr.map((id) => api.retrievePage(id).catch(() => null)))).filter(Boolean);

  // Tarefas: as ligadas às metas da sprint + as ligadas à sprint (para o rollover)
  const [tarefasMeta, tarefasSprint] = await Promise.all([
    queryByRelationAny(api, 'tarefas', 'meta', metas.map((p) => p.id)),
    api.queryAll('tarefas', { filter: { property: propRef('tarefas', 'sprint'), relation: { contains: sel.page.id } } }),
  ]);
  const tarefas = [...new Map([...tarefasMeta, ...tarefasSprint].map((p) => [p.id, p])).values()];
  await expandRelations(api, tarefas, 'tarefas');

  // Nomes de pessoas: vêm na propriedade quando a integração lê usuários; convidados podem vir sem nome.
  const semNome = new Set();
  for (const [base, list] of [['projetos', projetos], ['tarefas', tarefas]]) {
    for (const p of list) for (const u of read(p, base, 'responsavel')) if (!u.nome && !userCache.has(u.id)) semNome.add(u.id);
  }
  await Promise.all([...semNome].slice(0, 40).map(async (id) => {
    try { const u = await api.retrieveUser(id); userCache.set(id, u.name || null); } catch { userCache.set(id, null); }
  }));

  return {
    lidoEm: new Date().toISOString(),
    tri,
    sprintId: sel.page.id,
    sprints, areas, objetivos, krs, kpis, medicoes, projetos, metas, metasExtra, okrsExtra, tarefas, desejos,
    users: Object.fromEntries(userCache),
  };
}
