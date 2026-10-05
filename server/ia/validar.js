// Validação do que a IA devolve, contra o snapshot (funções puras, testadas em test/ia.test.js).
// Só passam ações conhecidas, com ids que existem e valores no domínio; o resto é descartado (com o motivo
// contado em `descartadas`). O resultado vira itens do rascunho — nada é gravado sem a revisão.

const STATUS_TAREFA = ['A Fazer', 'Em Andamento', 'Em Revisão', 'Concluída', 'Bloqueada'];
const STATUS_META = ['Não iniciada', 'Em andamento', 'Concluído', 'Abortado'];
const norm = (id) => String(id || '').replace(/-/g, '').toLowerCase();

export function indice(D) {
  const por = (xs) => new Map((xs || []).map((x) => [norm(x.id), x]));
  return {
    metas: por(D.metas.filter((m) => !m.fora)), tarefas: por(D.tarefas), kpis: por(D.kpis),
    okrs: por([...D.objetivos, ...D.krs, ...D.kpis]), tree: por(D.tree), sprints: new Map(D.sprints.map((s) => [norm(s.id), s])),
    areas: D.areas, pessoas: por(D.pessoas),
  };
}

// Sugestão de ação → { acao, dados, titulo, justificativa, trecho } ou null
export function validarSugestao(s, D, X = indice(D)) {
  if (!s || typeof s !== 'object') return null;
  const d = s.dados || {};
  const meta = (id) => X.metas.get(norm(id)); const tarefa = (id) => X.tarefas.get(norm(id));
  const base = { justificativa: String(s.justificativa || '').slice(0, 500), trecho: s.trecho ? String(s.trecho).slice(0, 400) : null };
  switch (s.acao) {
    case 'tarefa.status': {
      const t = tarefa(d.tarefa);
      if (!t || !STATUS_TAREFA.includes(d.status) || t.status === d.status) return null;
      return { ...base, acao: s.acao, dados: { tarefa: t.id, status: d.status, de: t.status }, titulo: `Tarefa "${t.titulo.slice(0, 50)}" → ${d.status}` };
    }
    case 'meta.status': {
      const m = meta(d.meta);
      if (!m || !STATUS_META.includes(d.status) || m.status === d.status) return null;
      return { ...base, acao: s.acao, dados: { meta: m.id, status: d.status }, titulo: `Status de "${m.titulo.slice(0, 50)}" → ${d.status}` };
    }
    case 'tarefa.criar': {
      const titulo = String(d.titulo || '').trim(); const m = d.meta ? meta(d.meta) : null;
      if (!titulo || (d.meta && !m)) return null;
      const resp = (d.resp || []).map((id) => X.pessoas.get(norm(id))?.id).filter(Boolean);
      return { ...base, acao: s.acao, dados: { titulo, meta: m?.id || null, subs: m?.subs?.slice(0, 1) || [], resp, area: m?.area || null, sprint: D.sprint, status: 'A Fazer' }, titulo: `Criar tarefa "${titulo.slice(0, 60)}"` };
    }
    case 'kpi.medir': {
      const k = X.kpis.get(norm(d.kpi)); const v = Number(d.valor);
      const sp = Number(d.sprint || D.sprint);
      if (!k || !Number.isFinite(v) || !D.sprints.some((x) => x.n === sp)) return null;
      return { ...base, acao: s.acao, dados: { kpi: k.id, sprint: sp, valor: String(v), data: new Date().toISOString().slice(0, 10) }, titulo: `Medição: ${k.titulo.slice(0, 50)} — #${sp}` };
    }
    case 'meta.criar': {
      const titulo = String(d.titulo || '').trim(); const area = d.area && X.areas[d.area] ? d.area : null;
      const subs = (d.subs || []).map((id) => X.tree.get(norm(id))?.id).filter(Boolean);
      if (!titulo || !area) return null;
      return { ...base, acao: s.acao, dados: { titulo, area, subs, status: 'Não iniciada', criterio: d.criterio ? String(d.criterio) : '', sprint: D.sprint }, titulo: `Criar meta "${titulo.slice(0, 60)}"` };
    }
    case 'dependencia.criar': {
      const a = meta(d.bloqueada); const b = meta(d.bloqueadora);
      if (!a || !b || a.id === b.id || (a.bloq || []).includes(b.id)) return null;
      return { ...base, acao: s.acao, dados: { bloqueada: a.id, bloqueadora: b.id }, titulo: `"${a.titulo.slice(0, 40)}" bloqueada por "${b.titulo.slice(0, 40)}"` };
    }
    default: return null;
  }
}

// Registro por página → { base, pagina, titulo, discussao, decisoes } ou null
export function validarRegistro(r, D, X = indice(D)) {
  if (!r || !String(r.discussao || '').trim()) return null;
  const pega = { meta: ['metas', X.metas], tarefa: ['tarefas', X.tarefas], okr: ['okrs', X.okrs], projeto: ['projetos', X.tree], sprint: ['sprints', X.sprints] }[r.tipo];
  if (!pega) return null;
  const x = pega[1].get(norm(r.id));
  if (!x || !x.url) return null;
  return { base: pega[0], pagina: x.id, titulo: x.titulo || x.nome || `Sprint #${x.n}`, discussao: String(r.discussao).slice(0, 1500), decisoes: String(r.decisoes || '').slice(0, 800) };
}

export function validarAta(a, D) {
  const X = indice(D);
  const sugestoes = (a.sugestoes || []).map((s) => validarSugestao(s, D, X));
  const registros = (a.registros || []).map((r) => validarRegistro(r, D, X));
  const lista = (xs, n = 30) => (Array.isArray(xs) ? xs : []).slice(0, n);
  return {
    titulo: String(a.titulo || '').slice(0, 200),
    resumo: lista(a.resumo, 20).map((t) => ({ topico: String(t.topico || '').slice(0, 200), itens: lista(t.itens, 12).map((x) => String(x).slice(0, 500)) })),
    decisoes: lista(a.decisoes).map((x) => String(x).slice(0, 500)),
    proximos: lista(a.proximos).map((p) => ({ acao: String(p.acao || '').slice(0, 300), responsavel: p.responsavel ? String(p.responsavel).slice(0, 80) : '' })),
    registros: registros.filter(Boolean),
    sugestoes: sugestoes.filter(Boolean),
    descartadas: sugestoes.filter((x) => !x).length + registros.filter((x) => !x).length,
  };
}

// Sugestões de revisão do rascunho: "editar" só em itens que existem e só com campos simples do item.
const CAMPOS_EDITAVEIS = ['titulo', 'criterio', 'status', 'area', 'subs', 'prazo', 'prioridade', 'discussao', 'decisoes'];
export function validarAprimorar(r, itens, D) {
  const ids = new Set(itens.map((x) => x.id));
  const X = indice(D);
  const out = []; let descartadas = 0;
  for (const s of (r?.sugestoes || []).slice(0, 40)) {
    const just = String(s.justificativa || '').slice(0, 500); const trecho = s.trecho ? String(s.trecho).slice(0, 400) : null;
    if (s.tipo === 'editar' && ids.has(s.item)) {
      const dados = Object.fromEntries(Object.entries(s.dados || {}).filter(([k, v]) => CAMPOS_EDITAVEIS.includes(k) && v != null && v !== ''));
      if (Object.keys(dados).length) { out.push({ tipo: 'editar', item: s.item, dados, justificativa: just, trecho }); continue; }
    } else if (s.tipo === 'comentario' && just) {
      out.push({ tipo: 'comentario', item: ids.has(s.item) ? s.item : null, justificativa: just, trecho }); continue;
    } else if (s.tipo === 'nova') {
      const v = validarSugestao({ ...s, justificativa: just, trecho }, D, X);
      if (v) { out.push({ tipo: 'nova', ...v }); continue; }
    }
    descartadas += 1;
  }
  return { sugestoes: out, descartadas };
}
