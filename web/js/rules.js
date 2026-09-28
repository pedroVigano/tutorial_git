// Regras de status e alertas do modelo (Lucid "Gestão da Sprint — BSV Robótica"), portadas do mock v2.2.
// Funções puras: recebem D (snapshot) e I (índices) — testadas em Node (test/rules.test.js).

export function kpiLast(k) {
  const ks = Object.keys(k.serie || {}).map(Number).sort((a, b) => a - b);
  return ks.length ? { s: ks[ks.length - 1], v: k.serie[String(ks[ks.length - 1])] } : null;
}

export function kpiStatus(k) {
  if (k.alvo == null || !k.dir) return { cls: 'st-warn', txt: '⚠ definir alvo' };
  const l = kpiLast(k);
  if (!l) return { cls: 'st-neutral', txt: 'sem medição' };
  const v = l.v; const a = k.alvo;
  let ok; let part;
  if (k.dir === '≥') { ok = v >= a; part = v >= a * 0.5 && v > 0; }
  else if (k.dir === '≤') { ok = v <= a; part = v <= a * 1.5; }
  else { ok = v === a; part = v > 0 && v < a; }
  return ok ? { cls: 'st-good', txt: 'Atingido' } : part ? { cls: 'st-warn', txt: 'Parcial' } : { cls: 'st-crit', txt: 'Não atingido' };
}

export function krStatus(I, kr) {
  const ks = I.kpisOf(kr.id);
  const st = ks.map(kpiStatus);
  if (ks.length && st.every((s) => s.cls === 'st-good')) return { cls: 'st-good', txt: 'Atingido' };
  if (st.some((s) => (s.cls !== 'st-neutral' && s.cls !== 'st-warn') || s.txt === 'Parcial')) return { cls: 'st-run', txt: 'Em andamento' };
  return { cls: 'st-neutral', txt: 'Não iniciado' };
}

export function objStatus(I, o) {
  const ks = I.krsOf(o.id).map((kr) => krStatus(I, kr));
  if (ks.length && ks.every((s) => s.cls === 'st-good')) return { cls: 'st-good', txt: 'Atingido' };
  if (ks.some((s) => s.cls === 'st-run' || s.cls === 'st-good')) return { cls: 'st-run', txt: 'Em andamento' };
  return { cls: 'st-neutral', txt: 'Não iniciado' };
}

export function coverage(I, o) {
  const ks = I.krsOf(o.id).flatMap((k) => I.kpisOf(k.id));
  return { n: ks.length, med: ks.filter((k) => kpiLast(k)).length };
}

export const stColor = (cls) => ({ 'st-good': 'var(--good)', 'st-warn': 'var(--warn)', 'st-crit': 'var(--crit)', 'st-run': 'var(--accent)', 'st-neutral': 'var(--neutral)' }[cls]);

export const OUTROS = 'outros';

export function visibleProjects(D, I, { sprint, obj }) {
  const base = obj === 'all' || !I.objById[obj] ? Object.keys(D.projetos) : I.objById[obj].projetos.slice();
  const outros = D.metas.some((m) => m.sprints.includes(sprint) && m.subs.some((s) => I.rootOf(s) === OUTROS) && (obj === 'all' || (m.okrs || []).includes(obj)));
  if (outros && I.byId[OUTROS]) base.push(OUTROS);
  return base;
}

export function computeAlerts(D, I, { sprint, obj = 'all' }) {
  const A = [];
  const inS = D.metas.filter((m) => m.sprints.includes(sprint));
  D.objetivos.filter((o) => o.alerta).forEach((o) => A.push({ sev: 'warn', t: `${o.label}: ${o.alerta}`, r: 'Objetivo → projeto deprecado' }));
  inS.filter((m) => !m.okrs || !m.okrs.length).forEach((m) => A.push({ sev: 'crit', t: `Meta "${m.titulo}" sem Objetivo (campo OKR)`, r: 'toda meta liga a ≥ 1 objetivo' }));
  inS.filter((m) => !m.subs.length).forEach((m) => A.push({ sev: 'crit', t: `Meta "${m.titulo}" sem subsistema`, r: 'toda meta liga a ≥ 1 subsistema' }));
  inS.filter((m) => (m.areas || []).length > 1).forEach((m) => A.push({ sev: 'warn', t: `Meta "${m.titulo}" com ${m.areas.length} equipes (${m.areas.map(I.AREA_NAME).join(', ')})`, r: 'exatamente 1 Área por meta — meta de duas equipes vira duas metas' }));
  inS.filter((m) => m.subs.some((s) => I.rootOf(s) === OUTROS)).forEach((m) => A.push({ sev: 'warn', t: `Meta "${m.titulo}" ligada a item fora dos projetos (${m.subs.filter((s) => I.rootOf(s) === OUTROS).map((s) => I.byId[s].nome.split(' — ')[0]).join(', ')})`, r: 'reapontar para a árvore nova ou confirmar que fica fora do P&D' }));
  inS.filter((m) => m.subs.some((s) => I.byId[s] && !I.isLane(I.byId[s]) && s !== OUTROS)).forEach((m) => A.push({ sev: 'info', t: `Meta "${m.titulo}" ligada a ${m.subs.filter((s) => I.byId[s] && !I.isLane(I.byId[s])).map((s) => `${I.byId[s].tipo} "${I.byId[s].nome}"`).join(', ')}, não a um subsistema`, r: 'metas ligam a subsistemas (folhas da árvore)' }));
  inS.forEach((m) => (m.bloq || []).forEach((b) => {
    const bl = I.metaById[b];
    if (bl && (!bl.sprints.includes(sprint) || bl.status === 'Não iniciada' || bl.status === 'Abortado')) {
      A.push({ sev: 'warn', t: `"${m.titulo}" está bloqueada por "${bl.titulo}" (${bl.sprints.includes(sprint) ? bl.status : `fora da sprint #${sprint}`})`, r: 'Bloqueado por → bloqueadora precisa estar na sprint e andando' });
    }
  }));
  D.objetivos.forEach((o) => I.krsOf(o.id).forEach((kr) => {
    const has = inS.some((m) => (m.okrs || []).includes(o.id) && m.subs.length);
    if (!has) A.push({ sev: 'info', t: `${o.label} · KR "${kr.titulo.slice(0, 70)}…" sem meta na sprint #${sprint}`, r: 'KR descoberto (verificado por objetivo: as metas ligam ao objetivo no campo OKR)' });
  }));
  const prev = sprint - 1;
  D.kpis.forEach((k) => { if (k.alvo != null && k.serie[String(prev)] == null) A.push({ sev: 'warn', t: `KPI "${k.titulo.slice(0, 80)}" sem medição na sprint #${prev}`, r: 'Fim da sprint: responsável pelo OKR registra uma linha em Evolução de KPIs' }); });
  D.kpis.filter((k) => k.alvo == null || !k.dir || !k.unidade).forEach((k) => A.push({ sev: 'warn', t: `KPI "${k.titulo}" sem alvo, unidade ou direção`, r: 'KPI carrega Alvo, Unidade e Direção nos campos' }));
  const vis = visibleProjects(D, I, { sprint, obj });
  D.tree.filter((n) => !n.resp && n.id !== OUTROS && vis.includes(I.rootOf(n.id))).forEach((n) => A.push({ sev: 'warn', t: `${n.tipo} "${n.nome}" sem responsável`, r: 'Responsável (máx. 1) em qualquer nível da árvore' }));
  D.desejos.filter((d) => d.status === 'Em análise' && d.sprints_em_analise > 2).forEach((d) => A.push({ sev: 'info', t: `Desejo em análise há ~${d.sprints_em_analise} sprints: "${d.titulo.slice(0, 70)}…"`, r: 'desejo sem requisito sugerido vira Meta de elaboração no tático' }));
  const ord = { crit: 0, warn: 1, info: 2 };
  return A.sort((a, b) => ord[a.sev] - ord[b.sev]);
}
