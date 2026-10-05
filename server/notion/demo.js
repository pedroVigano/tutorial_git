// Estado do Notion falso para o modo demo (NOTION_MODE=fixture), montado a partir da foto de dados
// do mock v2.2 (docs/mock/Reuniao_Tatica_PD_S27_v2_2.html, Notion lido em 14/09/2026).
// Para exercitar a interface, acrescenta alguns itens de exemplo (tarefas, desejos e duas dependências),
// todos com "(exemplo)" no título quando o campo permite.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { makePage } from './fake.js';
import { BASES } from './schema.js';

export const MOCK_PATH = new URL('../../docs/mock/Reuniao_Tatica_PD_S27_v2_2.html', import.meta.url);

export function readMockData(path = MOCK_PATH) {
  const html = readFileSync(path, 'utf8');
  const line = html.split('\n').find((l) => l.startsWith('const D = '));
  if (!line) throw new Error('objeto D não encontrado no mock');
  return JSON.parse(line.slice('const D = '.length).trim().replace(/;$/, ''));
}

const uid = (key) => {
  const h = createHash('md5').update(`demo:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

const DIRETORIA_DE = {
  sw: 'P&D', el: 'P&D', me: 'P&D', ag: 'P&D', pr: 'P&D', si: 'P&D', pd: 'P&D',
  fin: 'Administrativo', rh: 'Administrativo', jur: 'Administrativo', ti: 'Administrativo', est: 'Administrativo',
  inst: 'Operações', prod: 'Operações', cap: 'Comercial e Captação', ven: 'Comercial e Captação', mkt: 'Comercial e Captação',
};

export function demoState(D = readMockData()) {
  const pages = {};
  const users = {};
  let t = Date.parse('2026-06-01T12:00:00Z');
  const created = () => new Date((t += 60_000)).toISOString();
  const add = (base, key, props, extra = {}) => {
    const p = makePage({ base, id: uid(`${base}:${key}`), props, created_time: extra.created_time || created(), icon: extra.icon, url: extra.url });
    pages[p.id] = p;
    return p.id;
  };
  const person = (short) => {
    const id = uid(`user:${short}`);
    users[id] = { object: 'user', id, type: 'person', name: `Responsável ${short}` };
    return id;
  };

  // sprints
  const sprintId = {};
  for (const s of D.sprints) {
    sprintId[s.n] = add('sprints', s.n, { titulo: `Sprint P&D #${s.n}`, numero: s.n, data: { start: s.ini, end: s.fim }, status: s.status }, { url: s.url });
  }
  // áreas
  const areaId = {};
  for (const k of Object.keys(D.areas)) areaId[k] = uid(`areas:${k}`);
  for (const [k, a] of Object.entries(D.areas)) {
    add('areas', k, {
      titulo: k === 'pd' ? 'P&D' : a.nome, diretoria: DIRETORIA_DE[k] || 'Administrativo',
      nivel: k === 'pd' ? 'Diretoria' : 'Equipe', pai: DIRETORIA_DE[k] === 'P&D' && k !== 'pd' ? [areaId.pd] : [],
    }, { url: a.url });
  }
  const areas = (keys) => (keys || []).map((k) => areaId[k]).filter(Boolean);

  // árvore de projetos (o nó sintético "outros" do mock não existe no Notion)
  const nodeId = (id) => uid(`projetos:${id}`);
  const codigo = {}; const filhos = {};
  for (const n of D.tree) {
    if (n.id === 'outros') continue;
    const pai = n.pai && n.pai !== 'outros' ? n.pai : '';
    filhos[pai] = (filhos[pai] || 0) + 1;
    codigo[n.id] = `${pai && codigo[pai] ? `${codigo[pai]}.` : ''}${filhos[pai]}`;
  }
  for (const n of D.tree) {
    if (n.id === 'outros') continue;
    add('projetos', n.id, {
      titulo: n.nome, tipo: n.tipo, status: n.status === '—' ? 'Não iniciado' : n.status, codigo: codigo[n.id],
      pai: n.pai && n.pai !== 'outros' ? [nodeId(n.pai)] : [],
      // no mock, itens fora dos 4 projetos vinham com área "pd" por padrão; aqui ficam fora de P&D
      responsavel: n.resp ? [person(n.resp)] : [], area: areas(n.pai === 'outros' ? ['est'] : n.areas),
    }, { url: n.url });
  }

  // OKRs
  const objId = (id) => uid(`okrs:${id}`);
  for (const o of D.objetivos) {
    const proj = o.projetos.map(nodeId);
    if (o.alerta && D.tree.some((n) => n.id === 'x-mvp1')) proj.push(nodeId('x-mvp1'));
    add('okrs', o.id, {
      titulo: o.titulo, grau: 'Objetivo', trimestre: [D.trimestre.id], area: areas(o.areas.length ? o.areas : ['pd']),
      projetos: proj, limite: o.limite, status: 'Em andamento',
    }, { icon: o.icone, url: o.url });
  }
  const ordemKr = {};
  for (const k of D.krs) {
    ordemKr[k.obj] = (ordemKr[k.obj] || 0) + 1;
    add('okrs', k.id, { titulo: k.titulo, grau: 'Resultado-Chave', pai: [objId(k.obj)], trimestre: [D.trimestre.id], limite: k.limite, ordem: ordemKr[k.obj], status: 'Em andamento' }, { url: k.url });
  }
  for (const k of D.kpis) {
    add('okrs', k.id, { titulo: k.titulo, grau: 'KPI', pai: [objId(k.kr)], alvo: k.alvo, unidade: k.unidade, direcao: k.dir, limite: k.limite, trimestre: [D.trimestre.id], status: 'Em andamento' });
    for (const [n, v] of Object.entries(k.serie)) {
      const s = D.sprints.find((x) => x.n === Number(n));
      add('medicoes', `${k.id}:${n}`, { titulo: `${k.titulo} — Sprint #${n}`, kpi: [objId(k.id)], sprint: [sprintId[n]], valor: v, data: s?.fim });
    }
  }
  // OKRs de outras diretorias/trimestres citados pelas metas
  const extraId = {};
  for (const m of D.metas) {
    for (const titulo of m.okrs_extra || []) {
      if (!extraId[titulo]) extraId[titulo] = add('okrs', `extra:${titulo}`, { titulo, grau: 'Objetivo', trimestre: ['2026 - 3'], area: areas(['rh']), status: 'Em andamento' });
    }
  }

  // metas (+ duas dependências de exemplo entre metas da mesma sprint com subsistema)
  const metaId = (id) => uid(`metas:${id}`);
  const comSub = D.metas.filter((m) => m.subs.length && m.okrs.length);
  const deps = {};
  if (comSub.length >= 4) {
    deps[comSub[1].id] = [comSub[0].id];
    deps[comSub[3].id] = [comSub[2].id];
  }
  for (const m of D.metas) {
    add('metas', m.id, {
      titulo: m.titulo, status: m.status, area: areas(m.areas.length ? m.areas : [m.area]),
      subsistema: m.subs.map(nodeId), sprint: m.sprints.map((n) => sprintId[n]).filter(Boolean),
      okr: [...m.okrs.map(objId), ...(m.okrs_extra || []).map((x) => extraId[x])],
      bloqueadoPor: [...(m.bloq || []), ...(deps[m.id] || [])].map(metaId),
    }, { url: m.url });
  }
  // espelho "Bloqueando"
  for (const [bloqueada, bloqueadoras] of Object.entries(deps)) {
    for (const b of bloqueadoras) {
      pages[metaId(b)].properties[BASES.metas.props.bloqueando.name].relation.push({ id: metaId(bloqueada) });
    }
  }

  // tarefas de exemplo (as do mock, penduradas nas primeiras metas com subsistema da sprint atual)
  const atual = D.sprints.find((s) => s.status === 'Em andamento')?.n;
  const alvo = comSub.filter((m) => m.sprints.includes(atual)).slice(0, 4);
  const statusNotion = { 'Em Andamento': 'Fazendo' };
  (D.tarefas26 || []).forEach((tk, i) => {
    const m = alvo[i % Math.max(1, alvo.length)];
    if (!m) return;
    add('tarefas', tk.id, {
      titulo: `(exemplo) ${tk.titulo}`, status: statusNotion[tk.status] || tk.status,
      meta: [metaId(m.id)], sprint: [sprintId[atual]], subsistema: m.subs.slice(0, 1).map(nodeId),
      responsavel: tk.resp ? [person(tk.resp)] : [],
    });
  });

  // desejos de exemplo em análise, ligados a subsistemas do primeiro projeto
  const subsDoPrimeiro = D.tree.filter((n) => n.tipo === 'Subsistema' && n.pai && D.tree.find((p) => p.id === n.pai)?.pai === Object.keys(D.projetos)[0]).slice(0, 2);
  subsDoPrimeiro.forEach((n, i) => {
    add('desejos', `ex-${i}`, {
      titulo: i === 0
        ? '(exemplo) Como operador, gostaria que o robô avisasse a bateria baixa com antecedência, porque perdemos janelas de campo'
        : '(exemplo) Como agrônomo, gostaria de exportar as capturas por talhão, porque o relatório semanal é manual',
      status: 'Em análise', projetos: [nodeId(n.id)], stakeholder: [i === 0 ? 'Usuário' : 'Decisor'], evidencia: i === 0 ? 'Relato' : 'Observação',
    }, { created_time: i === 0 ? '2026-08-05T12:00:00.000Z' : '2026-09-02T12:00:00.000Z' });
  });

  return { now: '2026-09-28T12:00:00Z', pages, blocks: {}, users };
}
