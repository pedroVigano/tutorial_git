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
import { BASES, SECOES, DIRETORIA, has } from '../notion/schema.js';
import { read, normId, withDashes, titleOf } from '../notion/props.js';
import { queryByRelationAny } from '../notion/client.js';

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
  // itens fora do modelo (Entregável-Chave), exibidos no ancestral `pai`
  const oculto = new Map((D.ocultos || []).map((o) => [o.id, o]));
  const sub = (id) => {
    if (byId.has(id)) return pathOf(id).join(' › ');
    const o = oculto.get(id);
    return o ? [...(byId.has(o.pai) ? pathOf(o.pai) : []), `${o.nome} (${o.tipo})`].join(' › ') : `(item ${id.slice(0, 8)})`;
  };
  return {
    sub,
    exib: (id) => oculto.get(id)?.pai || id,
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

// ---------- reunião trimestral ----------
const GRAUS = ['Objetivo', 'Resultado-Chave', 'KPI'];
const TRI_RE = /^(\d{4}) - ([1-4])$/;
const fimTri = (t) => { const m = TRI_RE.exec(t); return new Date(Date.UTC(+m[1], +m[2] * 3, 0)).toISOString().slice(0, 10); };
const numOuNulo = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));
const okrResumo = (it) => [it.grau, it.alvo != null ? `alvo ${it.direcao || ''} ${String(it.alvo).replace('.', ',')} ${it.unidade || ''}`.trim() : null].filter(Boolean).join(' · ');

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
      // o formulário trabalha com os itens exibidos: um Entregável-Chave conta como o item pai, então
      // manter a lane do pai mantém o vínculo atual e tirá-la remove também o Entregável-Chave
      const novos = dados.subs.map(ID);
      const exibidos = meta.subs.map(N.exib);
      const add = novos.filter((id) => !exibidos.includes(id));
      const rem = meta.subs.filter((id) => !novos.includes(N.exib(id)));
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
    // `de` é a lane de origem; se a meta aparece nela por um Entregável-Chave, é ele que sai da relação
    const sair = de && de !== para ? meta.subs.filter((id) => id !== para && N.exib(id) === de) : [];
    for (const id of sair) {
      ops.push({ op: 'relRemove', base: 'metas', pageId: meta.page.id, key: 'subsistema', ids: [id] });
      linhas.push({ base: BASES.metas.titulo, pagina: P, campo: `${campo} (remover)`, atual: N.sub(id), novo: `− ${N.sub(id)}`, remocao: true });
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
  // ---------------------------------------------------------------- reunião trimestral (rascunho em lote)
  // itens: coluna do trimestre planejado, em ordem de árvore. Cada item: {key, grau, pai (key|null), id (página
  // existente) | origem (item do trimestre revisado a duplicar), titulo, alvo, unidade, direcao, ordem, abortar}.
  // statusFinal: [{id, status}] do trimestre revisado.
  async 'okr.trimestre'({ api, D, dados }) {
    const plan = String(dados.plan || ''); const rev = String(dados.rev || '');
    if (!TRI_RE.test(plan) || !TRI_RE.test(rev)) throw new PlanError('Trimestre inválido.');
    const linhas = []; const ops = []; const avisos = []; const bloqueios = [];
    const okrB = BASES.okrs.titulo; const P = BASES.okrs.props;
    const itens = (dados.itens || []).map((it) => ({ ...it, id: it.id ? ID(it.id) : null, origem: it.origem ? ID(it.origem) : null }));
    const byKey = new Map(itens.map((it) => [it.key, it]));
    const limite = fimTri(plan);

    // páginas lidas do Notion (existentes, origens e pais existentes)
    const ids = [...new Set(itens.flatMap((it) => [it.id, it.origem]).filter(Boolean))];
    const pages = new Map((await Promise.all(ids.map((id) => api.retrievePage(id).catch(() => null)))).filter(Boolean).map((p) => [ID(p.id), p]));
    const relOf = async (page, key) => (await api.relationIds(page, 'okrs', key)).map(ID);
    const pdArea = Object.values(D.areas || {}).find((a) => a.nome === DIRETORIA)?.id || null;

    // medições dos KPIs de origem (religadas à cópia)
    const origensKpi = itens.filter((it) => !it.id && !it.abortar && it.grau === 'KPI' && it.origem).map((it) => it.origem);
    const meds = origensKpi.length ? await queryByRelationAny(api, 'medicoes', 'kpi', origensKpi) : [];
    const medsDe = (kpiId) => meds.filter((m) => read(m, 'medicoes', 'kpi').some((k) => ID(k) === kpiId));

    const herdado = new Map(); // key → {area, projetos} para filhos novos
    const ordenados = [...itens].sort((a, b) => GRAUS.indexOf(a.grau) - GRAUS.indexOf(b.grau));
    for (const it of ordenados) {
      if (!GRAUS.includes(it.grau)) { bloqueios.push(`Grau inválido: ${it.grau}`); continue; }
      const titulo = String(it.titulo || '').trim();
      const alvo = numOuNulo(it.alvo);
      if (it.alvo != null && it.alvo !== '' && !Number.isFinite(alvo)) { bloqueios.push(`Alvo inválido em "${titulo}".`); continue; }
      const pai = it.pai ? byKey.get(it.pai) : null;
      if (it.grau !== 'Objetivo' && !pai) { bloqueios.push(`"${titulo || it.key}" sem item principal no rascunho.`); continue; }
      const paiRef = pai ? (pai.id || { ref: pai.key }) : null;

      if (it.id) { // ---------- página existente no trimestre planejado
        const page = pages.get(it.id);
        if (!page) { bloqueios.push(`Página ${it.id.slice(0, 8)} não encontrada no Notion.`); continue; }
        const atual = { titulo: titleOf(page), alvo: read(page, 'okrs', 'alvo'), unidade: read(page, 'okrs', 'unidade'), direcao: read(page, 'okrs', 'direcao'), status: read(page, 'okrs', 'status') };
        herdado.set(it.key, { area: await relOf(page, 'area'), projetos: await relOf(page, 'projetos') });
        const pg = pag(page, atual.titulo);
        if (it.abortar) {
          if (atual.status !== 'Abortado') {
            ops.push({ op: 'set', base: 'okrs', pageId: it.id, key: 'status', value: 'Abortado', expect: atual.status });
            linhas.push({ base: okrB, pagina: pg, campo: P.status.name, atual: atual.status || '—', novo: 'Abortado' });
          }
          continue;
        }
        const muda = (key, novo) => {
          if (novo === undefined || (novo ?? null) === (atual[key] ?? null)) return;
          ops.push({ op: 'set', base: 'okrs', pageId: it.id, key, value: novo, expect: atual[key] ?? null });
          linhas.push({ base: okrB, pagina: pg, campo: P[key].name, atual: atual[key] ?? '—', novo: novo ?? '(vazio)' });
        };
        if (titulo) muda('titulo', titulo); else bloqueios.push(`Descrição vazia em ${it.grau}.`);
        if (it.grau === 'KPI') { muda('alvo', it.alvo === undefined ? undefined : alvo); muda('unidade', it.unidade === undefined ? undefined : (it.unidade || null)); muda('direcao', it.direcao === undefined ? undefined : (it.direcao || null)); }
        continue;
      }

      if (it.abortar) continue; // rascunho descartado: nada a criar
      if (!titulo) { bloqueios.push(`Descrição vazia num ${it.grau} novo.`); continue; }
      // ---------- página nova (cópia ou item novo)
      const orig = it.origem ? pages.get(it.origem) : null;
      if (it.origem && !orig) { bloqueios.push(`Origem ${it.origem.slice(0, 8)} não encontrada no Notion.`); continue; }
      const base = orig ? { area: await relOf(orig, 'area'), projetos: await relOf(orig, 'projetos') }
        : herdado.get(it.pai) || { area: pdArea ? [pdArea] : [], projetos: [] };
      herdado.set(it.key, base);
      const props = {
        titulo, grau: it.grau, trimestre: [plan], status: 'Não iniciado', limite,
        area: base.area, projetos: base.projetos,
        ...(paiRef ? { pai: [paiRef] } : {}),
        ...(it.origem ? { origem: [it.origem] } : {}),
        ...(it.ordem != null && Number.isFinite(Number(it.ordem)) ? { ordem: Number(it.ordem) } : {}),
        ...(it.grau === 'KPI' ? { alvo, unidade: it.unidade || null, direcao: it.direcao || null } : {}),
      };
      const where = it.origem
        ? [{ key: 'origem', value: it.origem }, { key: 'trimestre', value: plan }]
        : [{ key: 'titulo', value: titulo }, { key: 'trimestre', value: plan }, ...(paiRef ? [{ key: 'pai', value: paiRef }] : [])];
      ops.push({ op: 'create', base: 'okrs', ref: it.key, props, dedupe: { where } });
      const nomePai = pai ? `${pai.titulo || pai.key}`.slice(0, 50) : '—';
      linhas.push({ base: okrB, pagina: pag(null, titulo), campo: 'criar página', atual: it.origem ? `cópia de "${titleOf(orig).slice(0, 60)}"` : 'novo', novo: `${okrResumo({ ...it, alvo })} · ${plan} · em "${nomePai}" · limite ${limite.split('-').reverse().join('/')}` });
      if (it.grau === 'KPI' && !base.area.length) avisos.push(`"${titulo}" sem Área.`);
      if (it.grau === 'KPI' && (alvo == null || !it.direcao)) avisos.push(`KPI "${titulo.slice(0, 60)}" sem alvo ou direção.`);
      if (it.grau === 'KPI' && orig && (it.unidade || null) !== (read(orig, 'okrs', 'unidade') || null)) avisos.push(`KPI "${titulo.slice(0, 60)}": unidade mudou (${read(orig, 'okrs', 'unidade') || '—'} → ${it.unidade || '—'}); as medições religadas estão na unidade antiga.`);
      if (it.grau === 'KPI' && orig) {
        const ms = medsDe(it.origem);
        for (const m of ms) ops.push({ op: 'relAdd', base: 'medicoes', pageId: m.id, key: 'kpi', ids: [{ ref: it.key }] });
        if (ms.length) linhas.push({ base: BASES.medicoes.titulo, pagina: pag(null, `${ms.length} medição(ões) de "${titleOf(orig).slice(0, 50)}"`), campo: `${BASES.medicoes.props.kpi.name} (adicionar)`, atual: 'KPI original', novo: '+ cópia (a série continua)' });
      }
    }

    // status final do trimestre revisado
    const revOkr = new Map([...(D.objetivos || []), ...(D.krs || []), ...(D.kpis || [])].map((x) => [x.id, x]));
    for (const sf of dados.statusFinal || []) {
      const id = ID(sf.id); const x = revOkr.get(id);
      if (!P.status.options.includes(sf.status)) { bloqueios.push(`Status inválido: ${sf.status}`); continue; }
      if (!x) { bloqueios.push(`Item ${id.slice(0, 8)} não está em ${rev}.`); continue; }
      if (x.status === sf.status) continue;
      ops.push({ op: 'set', base: 'okrs', pageId: id, key: 'status', value: sf.status, expect: x.status ?? null });
      linhas.push({ base: okrB, pagina: { id, titulo: `${x.label} · ${x.titulo}`, url: x.url }, campo: P.status.name, atual: x.status || '—', novo: sf.status });
    }
    if (!ops.length && !bloqueios.length) bloqueios.push('Nada a gravar: o rascunho não muda nada no Notion.');
    return { titulo: `Reunião trimestral: ${rev} → ${plan}`, linhas, ops, avisos: [...new Set(avisos)], bloqueios };
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

// ---------------------------------------------------------------- tarefas (abas Operacional e Eu)
const STATUS_T = ['A Fazer', 'Em Andamento', 'Em Revisão', 'Concluída', 'Bloqueada', 'Abortada'];
const nomePessoa = (D, id) => (D.pessoas || []).find((p) => p.id === id)?.nome || `pessoa ${String(id).slice(0, 4)}`;
async function lerTarefa(api, id) {
  const page = await api.retrievePage(id);
  const rel = async (key) => (await api.relationIds(page, 'tarefas', key)).map(ID);
  return {
    page, titulo: read(page, 'tarefas', 'titulo'), status: read(page, 'tarefas', 'status'),
    resp: read(page, 'tarefas', 'responsavel').map((u) => u.id), prazo: read(page, 'tarefas', 'prazo')?.start || null,
    prioridade: read(page, 'tarefas', 'prioridade'), subs: await rel('subsistema'), metas: await rel('meta'),
  };
}
// Gate de conclusão (Lucid pág. 6): Em Revisão → Concluída pelo responsável do subsistema, com resultados
// verificados, documentação do subsistema e requisito atualizados. Vira aviso no plano (não bloqueia).
function avisosGate(D, t, novo, email) {
  if (novo !== 'Concluída' || t.status === 'Concluída') return [];
  const av = [];
  if (t.status !== 'Em Revisão') av.push(`"${t.titulo}" vai para Concluída sem passar por Em Revisão.`);
  av.push('Gate de conclusão: resultados verificados + documentação do subsistema atualizada + requisito atualizado (→ Aprovado), quando houver.');
  const nodes = new Map(D.tree.map((n) => [n.id, n]));
  const resps = [...new Set(t.subs.map((s) => nodes.get(s)?.resp_id).filter(Boolean))];
  const meu = (D.pessoas || []).find((p) => p.email && p.email.toLowerCase() === String(email).toLowerCase());
  if (resps.length && !(meu && resps.includes(meu.id))) av.push(`Quem conclui a revisão é o responsável do subsistema (${resps.map((id) => nomePessoa(D, id)).join(', ')}).`);
  return av;
}

Object.assign(ACOES, {
  async 'tarefa.criar'({ D, dados }) {
    const N = namer(D);
    const titulo = String(dados.titulo || '').trim();
    const sprint = N.sprintN(dados.sprint ?? D.sprint);
    const status = dados.status || 'A Fazer';
    const meta = dados.meta || null; // id ou referência de meta nova do mesmo lote
    const subs = (dados.subs || []).map(ID);
    const resp = (dados.resp || []).map(ID);
    const area = dados.area ? N.areaKey(dados.area) : null;
    const bloqueios = []; const avisos = [];
    if (!titulo) bloqueios.push('A tarefa precisa de um título.');
    if (!sprint) bloqueios.push(`Sprint #${dados.sprint} não encontrada.`);
    if (!STATUS_T.includes(status)) bloqueios.push(`Status inválido: ${status}`);
    if (dados.prioridade && !BASES.tarefas.props.prioridade.options.includes(dados.prioridade)) bloqueios.push(`Prioridade inválida: ${dados.prioridade}`);
    if (!meta) avisos.push('Regra do modelo: a tarefa liga a uma Meta da Sprint.');
    if (!subs.length) avisos.push('A tarefa liga ao subsistema dela (é quem revisa).');
    if (!resp.length) avisos.push('Tarefa sem responsável.');
    const props = {
      titulo, status, sprint: sprint ? [sprint.id] : [], ...(meta ? { meta: [typeof meta === 'string' ? ID(meta) : meta] } : {}),
      subsistema: subs, responsavel: resp, ...(area ? { area: [area.id] } : {}),
      ...(dados.prazo ? { prazo: dados.prazo } : {}), ...(dados.prioridade ? { prioridade: dados.prioridade } : {}),
    };
    const nova = pag(null, titulo); const B = BASES.tarefas.props; const T = BASES.tarefas.titulo;
    const nomeMeta = typeof meta === 'string' ? N.meta(ID(meta)) : meta ? '(meta nova deste rascunho)' : '—';
    const linhas = [
      { base: T, pagina: nova, campo: B.titulo.name, atual: '', novo: titulo },
      { base: T, pagina: nova, campo: B.status.name, atual: '', novo: status },
      { base: T, pagina: nova, campo: B.meta.name, atual: '', novo: nomeMeta },
      { base: T, pagina: nova, campo: B.subsistema.name, atual: '', novo: lista(subs, N.sub) },
      { base: T, pagina: nova, campo: B.responsavel.name, atual: '', novo: resp.map((id) => nomePessoa(D, id)).join(', ') || '—' },
      { base: T, pagina: nova, campo: B.sprint.name, atual: '', novo: sprint ? `#${sprint.n}` : '—' },
      ...(area ? [{ base: T, pagina: nova, campo: B.area.name, atual: '', novo: area.nome }] : []),
      ...(dados.prazo ? [{ base: T, pagina: nova, campo: B.prazo.name, atual: '', novo: dados.prazo.split('-').reverse().join('/') }] : []),
      ...(dados.prioridade ? [{ base: T, pagina: nova, campo: B.prioridade.name, atual: '', novo: dados.prioridade }] : []),
    ];
    const ops = [{ op: 'create', base: 'tarefas', ref: 'tarefa', props, dedupe: { key: 'titulo', value: titulo, sprint: sprint?.id } }];
    return { titulo: `Criar tarefa "${titulo}"`, linhas, ops, avisos, bloqueios };
  },

  async 'tarefa.status'({ api, D, dados, email }) {
    const t = await lerTarefa(api, ID(dados.tarefa));
    const status = dados.status; const bloqueios = [];
    if (!STATUS_T.includes(status)) bloqueios.push(`Status inválido: ${status}`);
    if (status === t.status) bloqueios.push(`A tarefa já está "${status}".`);
    return {
      titulo: `Tarefa "${t.titulo}" → ${status}`,
      linhas: [{ base: BASES.tarefas.titulo, pagina: pag(t.page, t.titulo), campo: BASES.tarefas.props.status.name, atual: t.status, novo: status }],
      ops: [{ op: 'set', base: 'tarefas', pageId: t.page.id, key: 'status', value: status, expect: t.status }],
      avisos: avisosGate(D, t, status, email), bloqueios,
    };
  },

  async 'tarefa.editar'({ api, D, dados }) {
    const N = namer(D);
    const t = await lerTarefa(api, ID(dados.tarefa));
    const P = pag(t.page, t.titulo); const B = BASES.tarefas.props; const T = BASES.tarefas.titulo;
    const linhas = []; const ops = []; const bloqueios = [];
    if (dados.titulo != null && dados.titulo.trim() && dados.titulo.trim() !== t.titulo) {
      ops.push({ op: 'set', base: 'tarefas', pageId: t.page.id, key: 'titulo', value: dados.titulo.trim(), expect: t.titulo });
      linhas.push({ base: T, pagina: P, campo: B.titulo.name, atual: t.titulo, novo: dados.titulo.trim() });
    }
    if (dados.resp) {
      const novos = dados.resp.map(ID);
      if (JSON.stringify([...novos].sort()) !== JSON.stringify([...t.resp].map(ID).sort())) {
        ops.push({ op: 'set', base: 'tarefas', pageId: t.page.id, key: 'responsavel', value: novos });
        linhas.push({ base: T, pagina: P, campo: B.responsavel.name, atual: t.resp.map((id) => nomePessoa(D, id)).join(', ') || '—', novo: novos.map((id) => nomePessoa(D, id)).join(', ') || '(ninguém)' });
      }
    }
    if (dados.prazo !== undefined && (dados.prazo || null) !== t.prazo) {
      ops.push({ op: 'set', base: 'tarefas', pageId: t.page.id, key: 'prazo', value: dados.prazo || null });
      linhas.push({ base: T, pagina: P, campo: B.prazo.name, atual: t.prazo ? t.prazo.split('-').reverse().join('/') : '—', novo: dados.prazo ? dados.prazo.split('-').reverse().join('/') : '(vazio)' });
    }
    if (dados.prioridade !== undefined && (dados.prioridade || null) !== (t.prioridade || null)) {
      if (dados.prioridade && !B.prioridade.options.includes(dados.prioridade)) bloqueios.push(`Prioridade inválida: ${dados.prioridade}`);
      ops.push({ op: 'set', base: 'tarefas', pageId: t.page.id, key: 'prioridade', value: dados.prioridade || null, expect: t.prioridade || null });
      linhas.push({ base: T, pagina: P, campo: B.prioridade.name, atual: t.prioridade || '—', novo: dados.prioridade || '(vazio)' });
    }
    if (dados.subs) {
      const novos = dados.subs.map(ID);
      const add = novos.filter((id) => !t.subs.includes(id)); const rem = t.subs.filter((id) => !novos.includes(N.exib(id)));
      if (add.length) { ops.push({ op: 'relAdd', base: 'tarefas', pageId: t.page.id, key: 'subsistema', ids: add }); linhas.push({ base: T, pagina: P, campo: `${B.subsistema.name} (adicionar)`, atual: lista(t.subs, N.sub), novo: add.map((id) => `+ ${N.sub(id)}`).join(' · ') }); }
      if (rem.length) { ops.push({ op: 'relRemove', base: 'tarefas', pageId: t.page.id, key: 'subsistema', ids: rem }); linhas.push({ base: T, pagina: P, campo: `${B.subsistema.name} (remover)`, atual: lista(rem, N.sub), novo: rem.map((id) => `− ${N.sub(id)}`).join(' · '), remocao: true }); }
    }
    if (!ops.length) bloqueios.push('Nada mudou.');
    return { titulo: `Editar tarefa "${t.titulo}"`, linhas, ops, avisos: [], bloqueios };
  },

  // ---------------------------------------------------------------- registro de reunião na página do item
  // Formato da skill gestao-sprint-notion: seção "🗣️ Registro de reuniões" → "### DD/MM/AAAA · Tipo · ⬜ Conferido por —"
  // com Participantes / Discussão / Decisões / Sugestões da IA. Nada é apagado: a entrada é acrescentada.
  async 'pagina.registro'({ api, dados }) {
    const pageId = typeof dados.pagina === 'string' ? ID(dados.pagina) : dados.pagina;
    const tipo = String(dados.tipo || 'Tática').trim();
    const data = String(dados.data || new Date().toISOString().slice(0, 10));
    const bloqueios = [];
    const itens = [
      ['Participantes', (dados.participantes || []).join(', ')],
      ['Discussão', String(dados.discussao || '').trim()],
      ['Decisões', String(dados.decisoes || '').trim() || 'nenhuma'],
      ...(dados.sugestoes ? [['Sugestões da IA', `${String(dados.sugestoes).trim()} (aguardam conferência)`]] : []),
      ...(dados.reuniao ? [['Reunião', `{url:${dados.reuniao}}`]] : []),
    ].filter(([, t]) => t);
    if (!String(dados.discussao || '').trim()) bloqueios.push('Escreva a discussão.');
    let titulo = dados.titulo || '(página)'; let url = null;
    if (typeof pageId === 'string') {
      const page = await api.retrievePage(pageId).catch(() => null);
      if (!page) bloqueios.push('Página não encontrada no Notion.');
      else { titulo = titleOf(page) || titulo; url = page.url; }
    }
    const cab = `${data.split('-').reverse().join('/')} · ${tipo} · ⬜ Conferido por —`;
    return {
      titulo: `Registrar discussão em "${titulo}"`,
      linhas: [{ base: dados.base && BASES[dados.base] ? BASES[dados.base].titulo : 'Página', pagina: { id: typeof pageId === 'string' ? pageId : null, titulo, url }, campo: `## ${SECOES.registro}`, atual: '(entradas anteriores mantidas)', novo: `+ ### ${cab} · ${itens.map(([r, t]) => `${r}: ${t.replace(/\{url:[^}]+\}/g, '(link)')}`).join(' · ')}` }],
      ops: [{ op: 'registro', pageId, heading: SECOES.registro, titulo: cab, itens }],
      avisos: [], bloqueios,
    };
  },
});

// ---------------------------------------------------------------- rascunho do dashboard (lote)
// itens: [{id, acao, dados, tri?}] na ordem em que entram (criações primeiro). Cada item vira o seu plano;
// as referências de criação ganham o prefixo do item ("<item>/meta") para não colidirem, e uma meta ainda não
// criada ("tmp:<item>") é referenciada pela criação dela. Bloqueio de um item não impede os outros de aparecerem
// na revisão, mas impede gravar até o item sair do lote.
const TMP = 'tmp:';
const isTmp = (id) => typeof id === 'string' && id.startsWith(TMP);
function prefixar(v, pre) {
  if (Array.isArray(v)) return v.map((x) => prefixar(x, pre));
  if (typeof v === 'string') return v.replace(/\{url:([\w:.-]+)\}/g, (_, r) => `{url:${pre}/${r}}`); // com "/" já é de outro item
  if (v && typeof v === 'object') {
    if (typeof v.ref === 'string' && v.g) return v; // referência a outro item do lote (já completa)
    if (typeof v.ref === 'string' && Object.keys(v).length === 1) return { ref: `${pre}/${v.ref}` };
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'ref' && typeof x === 'string' ? `${pre}/${x}` : prefixar(x, pre)]));
  }
  return v;
}

ACOES.lote = async function lote(ctx) {
  const { D, dados } = ctx;
  const itens = Array.isArray(dados.itens) ? dados.itens : [];
  const linhas = []; const ops = []; const avisos = []; const bloqueios = []; const resumo = []; const opItens = [];
  if (!itens.length) bloqueios.push('Nada a gravar: o rascunho está vazio (ou nenhum item está incluído).');
  if (itens.some((x) => x.acao === 'rollover') && itens.length > 1) bloqueios.push('O rollover é gravado sozinho: desmarque os outros itens ou grave-os antes.');
  // meta/tarefa ainda não criada → referência da criação
  const ref = new Map(itens.filter((x) => ['meta.criar', 'tarefa.criar'].includes(x.acao) && x.dados?.tmp).map((x) => [x.dados.tmp, { ref: `${x.id}/${x.acao === 'meta.criar' ? 'meta' : 'tarefa'}`, g: 1 }]));
  const titulos = new Map(itens.filter((x) => x.acao === 'meta.criar').map((x) => [x.dados.tmp, String(x.dados.titulo || '(meta nova)')]));
  const N = namer(D);
  for (const it of itens) {
    const info = { id: it.id, acao: it.acao, titulo: it.acao, avisos: [], bloqueios: [], n_ops: 0 };
    try {
      if (!ACOES[it.acao] || it.acao === 'lote') throw new PlanError(`Ação desconhecida: ${it.acao}`, 404);
      let p;
      const d = it.dados || {};
      if (it.acao === 'dependencia.criar' && (isTmp(d.bloqueada) || isTmp(d.bloqueadora))) {
        // dependência com meta nova do próprio rascunho: relação direta, pela referência da criação
        const alvo = isTmp(d.bloqueada) ? ref.get(d.bloqueada) : ID(d.bloqueada);
        const fonte = isTmp(d.bloqueadora) ? ref.get(d.bloqueadora) : ID(d.bloqueadora);
        const nome = (id) => (isTmp(id) ? `${titulos.get(id) || '(meta nova)'} (nova)` : N.meta(ID(id)));
        if (!alvo || !fonte) throw new PlanError('A meta nova desta dependência não está no lote — inclua a criação dela.');
        p = {
          titulo: `"${nome(d.bloqueada)}" bloqueada por "${nome(d.bloqueadora)}"`,
          linhas: [{ base: BASES.metas.titulo, pagina: pag(isTmp(d.bloqueada) ? null : { id: alvo, url: N.metaObj(alvo)?.url }, nome(d.bloqueada)), campo: `${BASES.metas.props.bloqueadoPor.name} (adicionar)`, atual: isTmp(d.bloqueada) ? '' : lista(N.metaObj(alvo)?.bloq || [], N.meta), novo: `+ ${nome(d.bloqueadora)}` }],
          ops: [{ op: 'relAdd', base: 'metas', pageId: alvo, key: 'bloqueadoPor', ids: [fonte] }],
          avisos: [], bloqueios: [], global: true,
        };
      } else {
        const Di = it.tri && ctx.snapshotDe ? await ctx.snapshotDe(it.tri) : D;
        const troca = (v) => (isTmp(v) ? ref.get(v) || v : v);
        const dadosRef = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Array.isArray(v) ? v.map(troca) : troca(v)]));
        p = await ACOES[it.acao]({ ...ctx, D: Di, dados: dadosRef });
      }
      const pOps = p.global ? p.ops : prefixar(p.ops, it.id);
      info.titulo = p.titulo; info.avisos = p.avisos || []; info.bloqueios = p.bloqueios || []; info.n_ops = pOps.length;
      linhas.push(...p.linhas.map((l) => ({ ...l, item: it.id })));
      ops.push(...pOps); opItens.push(...pOps.map(() => it.id));
      avisos.push(...info.avisos);
      bloqueios.push(...info.bloqueios.map((b) => `${p.titulo}: ${b}`));
    } catch (e) {
      if (!(e instanceof PlanError) && !e.statusCode) throw e;
      info.bloqueios = [e.message];
      bloqueios.push(`${it.acao}: ${e.message}`);
    }
    resumo.push(info);
  }
  return { titulo: `Rascunho: ${itens.length} alteraç${itens.length === 1 ? 'ão' : 'ões'}`, linhas, ops, avisos: [...new Set(avisos)], bloqueios, itens: resumo, opItens };
};

export async function buildPlan(acao, ctx) {
  const f = ACOES[acao];
  if (!f) throw new PlanError(`Ação desconhecida: ${acao}`, 404);
  const plan = await f(ctx);
  return { acao, ...plan, avisos: plan.avisos || [], bloqueios: plan.bloqueios || [] };
}
