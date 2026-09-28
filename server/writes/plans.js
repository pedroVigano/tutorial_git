// Construtores de plano de escrita — um por ação do dashboard.
// Cada plano tem:
//   titulo    resumo da ação
//   linhas    o que o usuário confere: base → página → campo → atual → novo
//   ops       operações que o executor roda em ordem (idempotentes, relidas antes de gravar)
//   avisos    regras do modelo que merecem atenção (não impedem gravar)
//   bloqueios problemas que impedem gravar
//
// Princípios (skill gestao-sprint-notion): nada é apagado; relações são acumulativas — remoções só
// aparecem como linha própria em "mover de subsistema" e "remover dependência"; apagar meta = Abortado.
import { BASES, SECOES, has } from '../notion/schema.js';
import { read, normId, withDashes } from '../notion/props.js';

const ID = (x) => withDashes(normId(x));
const hoje = () => new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const COMECA_COM_VERBO = /^[a-zà-ú]+(ar|er|ir|or|ôr)(-(se|lo|la|los|las))?$/i;

export class PlanError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}

// Nomes legíveis a partir do snapshot.
export function namer(D) {
  const byId = new Map();
  for (const n of D.tree) byId.set(n.id, n);
  const pathOf = (id) => { const p = []; let n = byId.get(id); while (n) { if (n.id !== 'outros') p.unshift(n.nome); n = n.pai ? byId.get(n.pai) : null; } return p; };
  const areaById = new Map(Object.entries(D.areas).map(([k, a]) => [a.id, { ...a, key: k }]));
  const obj = new Map(D.objetivos.map((o) => [o.id, o]));
  const kr = new Map(D.krs.map((k) => [k.id, k]));
  const meta = new Map(D.metas.map((m) => [m.id, m]));
  const sprintById = new Map(D.sprints.map((s) => [s.id, s]));
  return {
    sub: (id) => (byId.has(id) ? pathOf(id).join(' › ') : `(item ${id.slice(0, 8)})`),
    area: (id) => areaById.get(id)?.nome || `(área ${id.slice(0, 8)})`,
    okr: (id) => (obj.has(id) ? `${obj.get(id).label} · ${obj.get(id).curto}` : kr.has(id) ? `${kr.get(id).label} · KR` : `(OKR ${id.slice(0, 8)})`),
    meta: (id) => meta.get(id)?.titulo || `(meta ${id.slice(0, 8)})`,
    sprint: (id) => (sprintById.has(id) ? `#${sprintById.get(id).n}` : `(sprint ${id.slice(0, 8)})`),
    areaKey: (key) => D.areas[key],
    metaObj: (id) => meta.get(id),
    sprintN: (n) => D.sprints.find((s) => s.n === Number(n)),
    node: (id) => byId.get(id),
    objetivo: (id) => obj.get(id),
  };
}

const lista = (ids, f) => (ids.length ? ids.map(f).join(' · ') : '—');
const pag = (page, titulo) => ({ id: page?.id || null, titulo: titulo ?? '(nova)', url: page?.url || null });

async function lerMeta(api, id) {
  const page = await api.retrievePage(id);
  const rel = async (key) => (await api.relationIds(page, 'metas', key)).map(ID);
  return {
    page,
    titulo: read(page, 'metas', 'titulo'),
    status: read(page, 'metas', 'status'),
    area: await rel('area'),
    okr: await rel('okr'),
    subs: await rel('subsistema'),
    sprints: await rel('sprint'),
    bloq: await rel('bloqueadoPor'),
  };
}

// Próxima sprint: existente ou criada no R1 (referência "proxima").
function proximaSprint(D, n, linhas, ops) {
  const cur = D.sprints.find((s) => s.n === n);
  const nxt = D.sprints.find((s) => s.n === n + 1);
  if (nxt) return { ref: nxt.id, nxt, cur };
  if (!cur?.fim) throw new PlanError(`Sprint #${n} sem data de fim — não dá para calcular a #${n + 1}`);
  const ini = addDays(cur.fim, 3); const fim = addDays(cur.fim, 14);
  const props = { titulo: `Sprint P&D #${n + 1}`, numero: n + 1, data: { start: ini, end: fim }, status: 'Não iniciada' };
  ops.push({ op: 'create', base: 'sprints', ref: 'proxima', props, dedupe: { key: 'numero', value: n + 1 } });
  linhas.push({ base: BASES.sprints.titulo, pagina: pag(null, `Sprint P&D #${n + 1}`), campo: 'criar página', atual: 'não existe', novo: `Número ${n + 1} · ${ini} → ${fim} · Não iniciada` });
  return { ref: { ref: 'proxima' }, nxt: null, cur };
}

// Rollover e "próxima sprint": preenche Sprint_de_origem se o campo existir (e estiver vazio);
// senão registra a linha no "## Histórico de sprints" da meta (formato da skill).
function historicoOuOrigem({ meta, cur, nxtN, motivo, email }) {
  const P = pag(meta.page, meta.titulo);
  if (has('metas', 'sprintOrigem')) {
    return {
      ops: [{ op: 'setIfEmpty', base: 'metas', pageId: meta.page.id, key: 'sprintOrigem', value: [cur.id] }],
      linhas: [{ base: BASES.metas.titulo, pagina: P, campo: BASES.metas.props.sprintOrigem.name, atual: '(se vazio)', novo: `#${cur.n}` }],
    };
  }
  const linha = `Sprint #${cur.n} → #${nxtN}: ${motivo} (${hoje()}, via dashboard, ${email})`;
  return {
    ops: [{ op: 'section', pageId: meta.page.id, heading: SECOES.historico, lines: [linha] }],
    linhas: [{ base: BASES.metas.titulo, pagina: P, campo: `## ${SECOES.historico}`, atual: '', novo: `+ "${linha}"` }],
  };
}

export const ACOES = {
  // ---------------------------------------------------------------- nova meta
  async 'meta.criar'({ D, dados, email }) {
    const N = namer(D);
    const titulo = String(dados.titulo || '').trim();
    const area = N.areaKey(dados.area);
    const sprint = N.sprintN(dados.sprint ?? D.sprint);
    const subs = (dados.subs || []).map(ID);
    const objetivo = dados.objetivo ? ID(dados.objetivo) : null;
    const status = dados.status || 'Não iniciada';
    const bloqueios = []; const avisos = [];
    if (!titulo) bloqueios.push('A meta precisa de um título.');
    if (!area) bloqueios.push('Escolha exatamente 1 equipe (Área).');
    if (!sprint) bloqueios.push(`Sprint #${dados.sprint} não encontrada.`);
    if (!BASES.metas.props.status.options.includes(status)) bloqueios.push(`Status inválido: ${status}`);
    if (titulo && !COMECA_COM_VERBO.test(titulo.split(/\s+/)[0])) avisos.push('Regra do modelo: o título da meta começa com verbo no infinitivo.');
    if (!objetivo) avisos.push('Regra do modelo: toda meta liga a ≥ 1 objetivo (campo OKR).');
    if (!subs.length) avisos.push('Regra do modelo: toda meta liga a ≥ 1 subsistema.');
    avisos.push('Meta criada fora da reunião tática deve ser comunicada no chat P&D – Liderança.');

    const criterio = String(dados.criterio || '').trim() || '(a definir)';
    const desejo = dados.desejo ? D.desejos.find((d) => d.id === ID(dados.desejo)) : null;
    const props = { titulo, status, area: area ? [area.id] : [], okr: objetivo ? [objetivo] : [], subsistema: subs, sprint: sprint ? [sprint.id] : [] };
    const children = [
      { h2: SECOES.criterio }, { p: criterio },
      ...(desejo ? [{ h2: SECOES.origem }, { link: `Desejo: ${desejo.titulo}`, url: desejo.url }] : []),
    ];
    const ops = [{
      op: 'create', base: 'metas', ref: 'meta', props, children,
      dedupe: { key: 'titulo', value: titulo, sprint: sprint?.id },
    }];
    const nova = pag(null, titulo);
    const linhas = [
      { base: BASES.metas.titulo, pagina: nova, campo: BASES.metas.props.titulo.name, atual: '', novo: titulo },
      { base: BASES.metas.titulo, pagina: nova, campo: BASES.metas.props.status.name, atual: '', novo: status },
      { base: BASES.metas.titulo, pagina: nova, campo: BASES.metas.props.area.name, atual: '', novo: area?.nome || '—' },
      { base: BASES.metas.titulo, pagina: nova, campo: BASES.metas.props.okr.name, atual: '', novo: objetivo ? N.okr(objetivo) : '—' },
      { base: BASES.metas.titulo, pagina: nova, campo: BASES.metas.props.subsistema.name, atual: '', novo: lista(subs, N.sub) },
      { base: BASES.metas.titulo, pagina: nova, campo: BASES.metas.props.sprint.name, atual: '', novo: sprint ? `#${sprint.n}` : '—' },
      { base: BASES.metas.titulo, pagina: nova, campo: `## ${SECOES.criterio}`, atual: '', novo: criterio },
    ];
    if (desejo) {
      const linha = `${hoje()} — Meta de elaboração criada: "${titulo}" {url:meta} (via dashboard, ${email})`;
      ops.push({ op: 'section', pageId: desejo.id, heading: SECOES.decisaoTatica, lines: [linha] });
      linhas.push({ base: BASES.desejos.titulo, pagina: pag(desejo, desejo.titulo), campo: `## ${SECOES.decisaoTatica}`, atual: '', novo: `+ "${linha.replace(' {url:meta}', '')}"` });
    }
    return { titulo: `Criar meta "${titulo}"`, linhas, ops, avisos, bloqueios };
  },

  // ---------------------------------------------------------------- editar meta
  async 'meta.editar'({ api, D, dados, email }) {
    const N = namer(D);
    const meta = await lerMeta(api, ID(dados.meta));
    const m = { id: ID(meta.page.id) };
    const P = pag(meta.page, meta.titulo);
    const linhas = []; const ops = []; const avisos = []; const bloqueios = [];
    const B = BASES.metas.props;

    if (dados.titulo != null && dados.titulo.trim() && dados.titulo.trim() !== meta.titulo) {
      const t = dados.titulo.trim();
      if (!COMECA_COM_VERBO.test(t.split(/\s+/)[0])) avisos.push('Regra do modelo: o título da meta começa com verbo no infinitivo.');
      ops.push({ op: 'set', base: 'metas', pageId: m.id, key: 'titulo', value: t, expect: meta.titulo });
      linhas.push({ base: BASES.metas.titulo, pagina: P, campo: B.titulo.name, atual: meta.titulo, novo: t });
    }
    if (dados.status && dados.status !== meta.status) {
      ops.push({ op: 'set', base: 'metas', pageId: m.id, key: 'status', value: dados.status, expect: meta.status });
      linhas.push({ base: BASES.metas.titulo, pagina: P, campo: B.status.name, atual: meta.status, novo: dados.status });
    }
    if (dados.area) {
      const a = N.areaKey(dados.area);
      if (!a) bloqueios.push('Equipe (Área) inválida.');
      else if (!(meta.area.length === 1 && meta.area[0] === a.id)) {
        // 🔼 Área tem limite 1 no Notion: é troca de valor único, conferida contra o valor atual
        ops.push({ op: 'set', base: 'metas', pageId: m.id, key: 'area', value: [a.id], expect: meta.area });
        linhas.push({ base: BASES.metas.titulo, pagina: P, campo: B.area.name, atual: lista(meta.area, N.area), novo: a.nome });
      }
    }
    if (dados.objetivo !== undefined) {
      const novo = dados.objetivo ? ID(dados.objetivo) : null;
      const atuais = meta.okr.filter((id) => N.objetivo(id));
      if (novo && !meta.okr.includes(novo)) {
        ops.push({ op: 'relAdd', base: 'metas', pageId: m.id, key: 'okr', ids: [novo] });
        linhas.push({ base: BASES.metas.titulo, pagina: P, campo: `${B.okr.name} (adicionar)`, atual: lista(meta.okr, N.okr), novo: `+ ${N.okr(novo)}` });
      }
      for (const velho of atuais.filter((id) => id !== novo)) {
        ops.push({ op: 'relRemove', base: 'metas', pageId: m.id, key: 'okr', ids: [velho] });
        linhas.push({ base: BASES.metas.titulo, pagina: P, campo: `${B.okr.name} (remover)`, atual: N.okr(velho), novo: `− ${N.okr(velho)}`, remocao: true });
      }
      if (!novo && !meta.okr.some((id) => !N.objetivo(id))) avisos.push('Regra do modelo: toda meta liga a ≥ 1 objetivo (campo OKR).');
    }
    if (dados.subs) {
      const novos = dados.subs.map(ID);
      const add = novos.filter((id) => !meta.subs.includes(id));
      const rem = meta.subs.filter((id) => !novos.includes(id));
      if (add.length) {
        ops.push({ op: 'relAdd', base: 'metas', pageId: m.id, key: 'subsistema', ids: add });
        linhas.push({ base: BASES.metas.titulo, pagina: P, campo: `${B.subsistema.name} (adicionar)`, atual: lista(meta.subs, N.sub), novo: add.map((id) => `+ ${N.sub(id)}`).join(' · ') });
      }
      if (rem.length) {
        ops.push({ op: 'relRemove', base: 'metas', pageId: m.id, key: 'subsistema', ids: rem });
        linhas.push({ base: BASES.metas.titulo, pagina: P, campo: `${B.subsistema.name} (remover)`, atual: lista(rem, N.sub), novo: rem.map((id) => `− ${N.sub(id)}`).join(' · '), remocao: true });
      }
      if (!novos.length) avisos.push('Regra do modelo: toda meta liga a ≥ 1 subsistema.');
    }
    if (dados.criterio && dados.criterio.trim()) {
      const linha = `${hoje()} (atualizado via dashboard, ${email}): ${dados.criterio.trim()}`;
      ops.push({ op: 'section', pageId: m.id, heading: SECOES.criterio, lines: [linha] });
      linhas.push({ base: BASES.metas.titulo, pagina: P, campo: `## ${SECOES.criterio}`, atual: '(texto atual mantido)', novo: `+ "${linha}"` });
    }
    if (!ops.length) bloqueios.push('Nada mudou.');
    return { titulo: `Editar "${meta.titulo}"`, linhas, ops, avisos, bloqueios };
  },

  // ---------------------------------------------------------------- mover de subsistema (drag)
  async 'meta.mover'({ api, D, dados }) {
    const N = namer(D);
    const meta = await lerMeta(api, ID(dados.meta));
    const P = pag(meta.page, meta.titulo);
    const de = dados.de ? ID(dados.de) : null; const para = ID(dados.para);
    const ops = []; const linhas = [];
    const campo = BASES.metas.props.subsistema.name;
    if (!meta.subs.includes(para)) {
      ops.push({ op: 'relAdd', base: 'metas', pageId: meta.page.id, key: 'subsistema', ids: [para] });
      linhas.push({ base: BASES.metas.titulo, pagina: P, campo: `${campo} (adicionar)`, atual: lista(meta.subs, N.sub), novo: `+ ${N.sub(para)}` });
    }
    if (de && de !== para && meta.subs.includes(de)) {
      ops.push({ op: 'relRemove', base: 'metas', pageId: meta.page.id, key: 'subsistema', ids: [de] });
      linhas.push({ base: BASES.metas.titulo, pagina: P, campo: `${campo} (remover)`, atual: N.sub(de), novo: `− ${N.sub(de)}`, remocao: true });
    }
    return { titulo: `Mover "${meta.titulo}" para ${N.sub(para).split(' › ').pop()}`, linhas, ops, avisos: [], bloqueios: ops.length ? [] : ['A meta já está nesse subsistema.'] };
  },

  // ---------------------------------------------------------------- dependências
  async 'dependencia.criar'({ api, D, dados }) {
    const N = namer(D);
    const bloqueada = await lerMeta(api, ID(dados.bloqueada));
    const bId = ID(dados.bloqueadora);
    const bloqueadora = N.metaObj(bId);
    const avisos = []; const bloqueios = [];
    if (ID(bloqueada.page.id) === bId) bloqueios.push('Uma meta não pode bloquear a si mesma.');
    if (bloqueada.bloq.includes(bId)) bloqueios.push('Essa dependência já existe.');
    if (bloqueadora && !bloqueadora.sprints.includes(D.sprint)) avisos.push(`A bloqueadora não está na sprint #${D.sprint}.`);
    if (bloqueadora && ['Não iniciada', 'Abortado'].includes(bloqueadora.status)) avisos.push(`A bloqueadora está "${bloqueadora.status}".`);
    if (bloqueadora?.bloq?.includes(ID(bloqueada.page.id))) avisos.push('Dependência circular: a bloqueadora já é bloqueada por esta meta.');
    const P = pag(bloqueada.page, bloqueada.titulo);
    return {
      titulo: `"${bloqueada.titulo}" bloqueada por "${N.meta(bId)}"`,
      linhas: [{ base: BASES.metas.titulo, pagina: P, campo: `${BASES.metas.props.bloqueadoPor.name} (adicionar)`, atual: lista(bloqueada.bloq, N.meta), novo: `+ ${N.meta(bId)}` }],
      ops: [{ op: 'relAdd', base: 'metas', pageId: bloqueada.page.id, key: 'bloqueadoPor', ids: [bId] }],
      avisos: [...avisos, `"${BASES.metas.props.bloqueando.name}" na bloqueadora é atualizado pelo Notion (espelho).`],
      bloqueios,
    };
  },

  async 'dependencia.remover'({ api, D, dados }) {
    const N = namer(D);
    const bloqueada = await lerMeta(api, ID(dados.bloqueada));
    const bId = ID(dados.bloqueadora);
    const P = pag(bloqueada.page, bloqueada.titulo);
    return {
      titulo: `Remover dependência: "${bloqueada.titulo}" ← "${N.meta(bId)}"`,
      linhas: [{ base: BASES.metas.titulo, pagina: P, campo: `${BASES.metas.props.bloqueadoPor.name} (remover)`, atual: lista(bloqueada.bloq, N.meta), novo: `− ${N.meta(bId)}`, remocao: true }],
      ops: [{ op: 'relRemove', base: 'metas', pageId: bloqueada.page.id, key: 'bloqueadoPor', ids: [bId] }],
      avisos: [],
      bloqueios: bloqueada.bloq.includes(bId) ? [] : ['Essa dependência não existe mais no Notion.'],
    };
  },

  // ---------------------------------------------------------------- status (Abortar = "apagar")
  async 'meta.status'({ api, dados }) {
    const meta = await lerMeta(api, ID(dados.meta));
    const status = dados.status;
    const bloqueios = [];
    if (!BASES.metas.props.status.options.includes(status)) bloqueios.push(`Status inválido: ${status}`);
    if (status === meta.status) bloqueios.push(`A meta já está "${status}".`);
    return {
      titulo: `Status de "${meta.titulo}" → ${status}`,
      linhas: [{ base: BASES.metas.titulo, pagina: pag(meta.page, meta.titulo), campo: BASES.metas.props.status.name, atual: meta.status, novo: status }],
      ops: [{ op: 'set', base: 'metas', pageId: meta.page.id, key: 'status', value: status, expect: meta.status }],
      avisos: status === 'Abortado' ? ['Nada é apagado no Notion: a meta fica com status Abortado.'] : [],
      bloqueios,
    };
  },

  // ---------------------------------------------------------------- meta → próxima sprint
  async 'meta.proximaSprint'({ api, D, dados, email }) {
    const meta = await lerMeta(api, ID(dados.meta));
    const n = Number(dados.sprint ?? D.sprint);
    if (!D.sprints.some((s) => s.n === n)) throw new PlanError(`Sprint #${n} não encontrada.`, 404);
    const linhas = []; const ops = [];
    const { ref, cur } = proximaSprint(D, n, linhas, ops);
    const bloqueios = [];
    if (typeof ref === 'string' && meta.sprints.includes(ref)) bloqueios.push(`A meta já está na sprint #${n + 1}.`);
    const motivo = String(dados.motivo || '').trim();
    if (!motivo) bloqueios.push('Informe o motivo (vai para o Histórico de sprints da meta).');
    ops.push({ op: 'relAdd', base: 'metas', pageId: meta.page.id, key: 'sprint', ids: [ref] });
    linhas.push({ base: BASES.metas.titulo, pagina: pag(meta.page, meta.titulo), campo: `${BASES.metas.props.sprint.name} (adicionar)`, atual: meta.sprints.map((id) => namer(D).sprint(id)).join(' → ') || '—', novo: `+ #${n + 1} (mantém as anteriores)` });
    const h = historicoOuOrigem({ meta, cur, nxtN: n + 1, motivo, email });
    ops.push(...h.ops); linhas.push(...h.linhas);
    return { titulo: `"${meta.titulo}" → sprint #${n + 1}`, linhas, ops, avisos: [], bloqueios };
  },

  // ---------------------------------------------------------------- medição de KPI
  async 'kpi.medir'({ D, dados }) {
    const k = D.kpis.find((x) => x.id === ID(dados.kpi));
    if (!k) throw new PlanError('KPI não encontrado no trimestre carregado.', 404);
    const s = D.sprints.find((x) => x.n === Number(dados.sprint));
    const bloqueios = [];
    if (!s) bloqueios.push(`Sprint #${dados.sprint} não encontrada.`);
    const valor = dados.valor === '' || dados.valor == null ? null : Number(String(dados.valor).replace(',', '.'));
    if (valor == null || !Number.isFinite(valor)) bloqueios.push('Informe um valor numérico.');
    return { ...medicaoPlano(k, s, valor, dados.data), bloqueios };
  },

  // ---------------------------------------------------------------- rollover R1–R6
  async rollover({ D, dados, email }) {
    const N = namer(D);
    const n = Number(dados.sprint);
    const cur = D.sprints.find((s) => s.n === n);
    if (!cur) throw new PlanError(`Sprint #${n} não encontrada.`, 404);
    const linhas = []; const ops = []; const avisos = []; const bloqueios = [];
    const passo = (p, l) => linhas.push({ ...l, passo: p });

    // R1 — próxima sprint existe
    const tmp = [];
    const { ref, nxt } = proximaSprint(D, n, tmp, ops);
    tmp.forEach((l) => passo('R1', l));
    if (nxt) passo('R1', { base: BASES.sprints.titulo, pagina: pag(nxt, `Sprint P&D #${n + 1}`), campo: 'já existe', atual: nxt.status, novo: nxt.status });

    // R2 — metas não concluídas
    for (const id of (dados.metas || []).map(ID)) {
      const m = N.metaObj(id);
      if (!m) { bloqueios.push(`Meta ${id.slice(0, 8)} não está no snapshot da sprint #${n}.`); continue; }
      if (m.sprints.includes(n + 1)) continue;
      ops.push({ op: 'relAdd', base: 'metas', pageId: id, key: 'sprint', ids: [ref] });
      passo('R2', { base: BASES.metas.titulo, pagina: { id, titulo: m.titulo, url: m.url }, campo: `${BASES.metas.props.sprint.name} (adicionar)`, atual: m.sprints.map((x) => `#${x}`).join(' → '), novo: `+ #${n + 1}` });
      const h = historicoOuOrigem({ meta: { page: { id, url: m.url }, titulo: m.titulo }, cur, nxtN: n + 1, motivo: `rollover (${m.status} ao fim da #${n})`, email });
      ops.push(...h.ops); h.linhas.forEach((l) => passo('R2', l));
    }

    // R3 — tarefas não concluídas
    for (const id of (dados.tarefas || []).map(ID)) {
      const t = D.tarefas.find((x) => x.id === id);
      if (!t) { bloqueios.push(`Tarefa ${id.slice(0, 8)} não está no snapshot.`); continue; }
      if (t.sprints.includes(n + 1)) continue;
      ops.push({ op: 'relAdd', base: 'tarefas', pageId: id, key: 'sprint', ids: [ref] });
      passo('R3', { base: BASES.tarefas.titulo, pagina: { id, titulo: t.titulo, url: t.url }, campo: `${BASES.tarefas.props.sprint.name} (adicionar)`, atual: t.sprints.map((x) => `#${x}`).join(' → ') || '—', novo: `+ #${n + 1}` });
    }

    // R4 — medições informadas pelo responsável pelo OKR
    for (const md of dados.medicoes || []) {
      if (md.valor === '' || md.valor == null) continue;
      const k = D.kpis.find((x) => x.id === ID(md.kpi));
      const valor = Number(String(md.valor).replace(',', '.'));
      if (!k || !Number.isFinite(valor)) { bloqueios.push(`Medição inválida para ${md.kpi}`); continue; }
      const p = medicaoPlano(k, cur, valor, cur.fim);
      ops.push(...p.ops);
      p.linhas.forEach((l) => passo('R4', l));
    }
    const semMedicao = D.kpis.filter((k) => k.alvo != null && k.serie[String(n)] == null && !(dados.medicoes || []).some((md) => ID(md.kpi) === k.id && md.valor !== '' && md.valor != null));
    if (semMedicao.length) avisos.push(`${semMedicao.length} KPI(s) com alvo continuam sem medição na #${n} (o responsável pelo OKR registra depois).`);

    // Fechamento: só no fim, depois de tudo gravado
    if (dados.fechar) {
      if (cur.status !== 'Concluído') {
        ops.push({ op: 'set', base: 'sprints', pageId: cur.id, key: 'status', value: 'Concluído', expect: cur.status });
        passo('R6', { base: BASES.sprints.titulo, pagina: pag(cur, `Sprint P&D #${n}`), campo: BASES.sprints.props.status.name, atual: cur.status, novo: 'Concluído' });
      }
      if (!nxt || nxt.status !== 'Em andamento') {
        ops.push({ op: 'set', base: 'sprints', pageId: ref, key: 'status', value: 'Em andamento', expect: nxt ? nxt.status : 'Não iniciada' });
        passo('R6', { base: BASES.sprints.titulo, pagina: pag(nxt, `Sprint P&D #${n + 1}`), campo: BASES.sprints.props.status.name, atual: nxt ? nxt.status : 'Não iniciada', novo: 'Em andamento' });
      }
    }
    avisos.push('R5 (manual): apontar as views do Notion com filtro fixo para a nova sprint — template "Sprint P&D #N" (Trimestre) e view "Sprint Atual" de Tarefas.');
    if (!ops.length) bloqueios.push('Nada a gravar: nenhuma meta, tarefa ou medição selecionada.');
    return { titulo: `Rollover #${n} → #${n + 1}`, linhas, ops, avisos, bloqueios };
  },
};

function medicaoPlano(k, s, valor, data) {
  const linhas = []; const ops = [];
  if (!s) return { titulo: 'Medição', linhas, ops, avisos: [] };
  const existente = k.medicoes?.[String(s.n)];
  const titulo = `${k.titulo} — Sprint #${s.n}`;
  if (existente) {
    const atual = k.serie[String(s.n)];
    ops.push({ op: 'set', base: 'medicoes', pageId: existente, key: 'valor', value: valor, expect: atual ?? null });
    linhas.push({ base: BASES.medicoes.titulo, pagina: { id: existente, titulo, url: null }, campo: BASES.medicoes.props.valor.name, atual: atual ?? '—', novo: valor });
  } else {
    ops.push({
      op: 'create', base: 'medicoes', ref: `med:${k.id}`,
      props: { titulo, kpi: [k.id], sprint: [s.id], valor, data: data || s.fim || new Date().toISOString().slice(0, 10) },
      dedupe: { key: 'kpi', value: k.id, sprint: s.id },
    });
    linhas.push({ base: BASES.medicoes.titulo, pagina: pag(null, titulo), campo: 'criar linha', atual: 'sem medição', novo: `${valor}${k.unidade ? ` ${k.unidade}` : ''} (alvo ${k.dir || ''} ${k.alvo ?? '—'})` });
  }
  return { titulo: `Medição: ${k.titulo.slice(0, 60)} — #${s.n}`, linhas, ops, avisos: [] };
}

export async function buildPlan(acao, ctx) {
  const f = ACOES[acao];
  if (!f) throw new PlanError(`Ação desconhecida: ${acao}`, 404);
  const plan = await f(ctx);
  return { acao, ...plan, avisos: plan.avisos || [], bloqueios: plan.bloqueios || [] };
}
