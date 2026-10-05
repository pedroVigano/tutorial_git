// Rascunho único de alterações (núcleo puro, testado em Node — test/changeset.test.js).
// Nada é gravado na hora: cada ação do dashboard vira um item do rascunho; a Revisão mostra o diff (atual →
// novo, lido do Notion) e "Gravar no Notion" grava tudo num plano único (ação `lote` no servidor).
//
// Item: { id, acao, dados, titulo, autor, origem: 'manual'|'ia', incluir, comentarios: [], criado }
// stage() consolida as ações sobre a mesma coisa, como um "squash":
//   - editar, mover, mudar status ou abortar uma meta AINDA NÃO criada mexe no próprio item de criação
//     (abortar remove a criação e o que dependia dela);
//   - várias edições da mesma meta viram uma; mover A→B→C vira A→C (voltar para A anula);
//   - criar e depois remover a mesma dependência se anulam (e vice-versa);
//   - medição do mesmo KPI × sprint e status da mesma tarefa: vale a última.
// overlay() aplica o rascunho sobre o snapshot para a tela mostrar o estado pendente.

export const TMP = 'tmp:';
export const isTmp = (id) => typeof id === 'string' && id.startsWith(TMP);
export const novoId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const sem = (lista, ...ids) => lista.filter((x) => !ids.includes(x.id));
const achar = (lista, f) => lista.find((x) => f(x));
const mesmaDep = (a, b) => a.bloqueada === b.bloqueada && a.bloqueadora === b.bloqueadora;

export class StageError extends Error {}

function item(base, acao, dados, extra = {}) {
  return { id: base.id || novoId(), acao, dados, titulo: base.titulo || acao, autor: base.autor || null, origem: base.origem || 'manual', incluir: base.incluir ?? true, comentarios: base.comentarios || [], criado: base.criado || new Date().toISOString(), ...extra };
}

// Devolve a nova lista (não muta a de entrada).
export function stage(lista0, novo) {
  let lista = lista0.map((x) => ({ ...x, dados: { ...x.dados } }));
  const { acao } = novo; const d = { ...novo.dados };
  const criacao = (tmp) => achar(lista, (x) => x.acao === 'meta.criar' && x.dados.tmp === tmp);
  const tocar = (x, titulo) => { if (titulo) x.titulo = titulo; x.atualizado = new Date().toISOString(); };

  switch (acao) {
    case 'meta.criar': {
      const it = item(novo, acao, d);
      it.dados.tmp = it.dados.tmp || `${TMP}${it.id}`;
      it.dados.bloqueadoPor = it.dados.bloqueadoPor || [];
      return [...lista, it];
    }
    case 'meta.editar': {
      if (isTmp(d.meta)) {
        const c = criacao(d.meta); if (!c) throw new StageError('Meta do rascunho não encontrada.');
        const { meta, ...campos } = d;
        Object.assign(c.dados, campos);
        tocar(c, campos.titulo ? `Criar meta "${campos.titulo}"` : null);
        return lista;
      }
      // a edição com subsistemas/status substitui um "mover"/"status" pendente da mesma meta
      if (d.subs) lista = lista.filter((x) => !(x.acao === 'meta.mover' && x.dados.meta === d.meta));
      if (d.status) lista = lista.filter((x) => !(x.acao === 'meta.status' && x.dados.meta === d.meta));
      const e = achar(lista, (x) => x.acao === 'meta.editar' && x.dados.meta === d.meta);
      if (e) { Object.assign(e.dados, d); tocar(e, novo.titulo); return lista; }
      return [...lista, item(novo, acao, d)];
    }
    case 'meta.mover': {
      if (isTmp(d.meta)) {
        const c = criacao(d.meta); if (!c) throw new StageError('Meta do rascunho não encontrada.');
        const subs = (c.dados.subs || []).filter((s) => s !== d.de && s !== d.para);
        c.dados.subs = [...subs, d.para]; tocar(c);
        return lista;
      }
      const e = achar(lista, (x) => x.acao === 'meta.editar' && x.dados.meta === d.meta && x.dados.subs);
      if (e) { e.dados.subs = [...e.dados.subs.filter((s) => s !== d.de && s !== d.para), d.para]; tocar(e); return lista; }
      const m = achar(lista, (x) => x.acao === 'meta.mover' && x.dados.meta === d.meta);
      if (m) {
        if (m.dados.de === d.para) return sem(lista, m.id); // voltou para a lane de origem
        m.dados.para = d.para; tocar(m, novo.titulo); return lista;
      }
      return [...lista, item(novo, acao, d)];
    }
    case 'meta.status': {
      if (isTmp(d.meta)) {
        const c = criacao(d.meta); if (!c) throw new StageError('Meta do rascunho não encontrada.');
        if (d.status === 'Abortado') { // abortar uma meta que nem foi criada = tirar do rascunho
          return lista.filter((x) => x.id !== c.id && !(x.acao === 'dependencia.criar' && (x.dados.bloqueada === d.meta || x.dados.bloqueadora === d.meta))
            && !(x.dados?.meta === d.meta));
        }
        c.dados.status = d.status; tocar(c); return lista;
      }
      const e = achar(lista, (x) => x.acao === 'meta.editar' && x.dados.meta === d.meta);
      if (e) { e.dados.status = d.status; tocar(e); return lista; }
      const s = achar(lista, (x) => x.acao === 'meta.status' && x.dados.meta === d.meta);
      if (s) { s.dados.status = d.status; tocar(s, novo.titulo); return lista; }
      return [...lista, item(novo, acao, d)];
    }
    case 'dependencia.criar': {
      if (d.bloqueada === d.bloqueadora) throw new StageError('Uma meta não pode bloquear a si mesma.');
      const rem = achar(lista, (x) => x.acao === 'dependencia.remover' && mesmaDep(x.dados, d));
      if (rem) return sem(lista, rem.id);
      if (achar(lista, (x) => x.acao === 'dependencia.criar' && mesmaDep(x.dados, d))) return lista;
      return [...lista, item(novo, acao, d)];
    }
    case 'dependencia.remover': {
      const cri = achar(lista, (x) => x.acao === 'dependencia.criar' && mesmaDep(x.dados, d));
      if (cri) return sem(lista, cri.id);
      if (achar(lista, (x) => x.acao === 'dependencia.remover' && mesmaDep(x.dados, d))) return lista;
      return [...lista, item(novo, acao, d)];
    }
    case 'meta.proximaSprint': {
      if (isTmp(d.meta)) throw new StageError('Grave a meta nova antes de levá-la para a próxima sprint.');
      const p = achar(lista, (x) => x.acao === acao && x.dados.meta === d.meta);
      if (p) { Object.assign(p.dados, d); tocar(p, novo.titulo); return lista; }
      return [...lista, item(novo, acao, d)];
    }
    case 'kpi.medir': {
      const p = achar(lista, (x) => x.acao === acao && x.dados.kpi === d.kpi && Number(x.dados.sprint) === Number(d.sprint));
      if (p) { Object.assign(p.dados, d); tocar(p, novo.titulo); return lista; }
      return [...lista, item(novo, acao, d)];
    }
    case 'tarefa.status': {
      const p = achar(lista, (x) => x.acao === acao && x.dados.tarefa === d.tarefa);
      if (p) {
        if (p.dados.de === d.status) return sem(lista, p.id); // voltou ao status de origem
        p.dados.status = d.status; tocar(p, novo.titulo); return lista;
      }
      if (isTmp(d.tarefa)) {
        const c = achar(lista, (x) => x.acao === 'tarefa.criar' && x.dados.tmp === d.tarefa);
        if (c) { c.dados.status = d.status; tocar(c); }
        return lista;
      }
      return [...lista, item(novo, acao, d)];
    }
    case 'tarefa.criar': {
      const it = item(novo, acao, d);
      it.dados.tmp = it.dados.tmp || `${TMP}${it.id}`;
      return [...lista, it];
    }
    case 'tarefa.editar': {
      if (isTmp(d.tarefa)) {
        const c = achar(lista, (x) => x.acao === 'tarefa.criar' && x.dados.tmp === d.tarefa);
        if (c) { const { tarefa, ...campos } = d; Object.assign(c.dados, campos); tocar(c); }
        return lista;
      }
      const e = achar(lista, (x) => x.acao === acao && x.dados.tarefa === d.tarefa);
      if (e) { Object.assign(e.dados, d); tocar(e, novo.titulo); return lista; }
      return [...lista, item(novo, acao, d)];
    }
    case 'rollover':
      return [...lista.filter((x) => x.acao !== 'rollover'), item(novo, acao, d)];
    default:
      return [...lista, item(novo, acao, d)];
  }
}

// Itens que vão para o servidor (ação `lote`): só os incluídos; criações antes do resto (dependências e tarefas
// de metas novas usam a referência da criação), rollover sempre sozinho.
export function paraLote(lista) {
  const inc = lista.filter((x) => x.incluir !== false);
  const ordem = (x) => (x.acao === 'meta.criar' ? 0 : x.acao === 'tarefa.criar' ? 1 : 2);
  return inc.slice().sort((a, b) => ordem(a) - ordem(b)).map(({ id, acao, dados, tri }) => ({ id, acao, dados, ...(tri ? { tri } : {}) }));
}

// ---------- overlay: o snapshot com o rascunho aplicado (só para a tela) ----------
export function overlay(D, lista) {
  if (!D || !lista?.length) return D;
  const metas = D.metas.map((m) => ({ ...m, bloq: [...(m.bloq || [])], subs: [...(m.subs || [])], sprints: [...(m.sprints || [])] }));
  const kpis = D.kpis.map((k) => ({ ...k, serie: { ...k.serie } }));
  const tarefas = (D.tarefas || []).map((t) => ({ ...t }));
  const byId = new Map(metas.map((m) => [m.id, m]));
  const marca = (m, txt) => { if (m) m.pend = [...(m.pend || []), txt]; };
  const pendEdges = []; const remEdges = [];
  for (const x of lista) {
    if (x.incluir === false) continue;
    const d = x.dados || {};
    switch (x.acao) {
      case 'meta.criar': {
        const nova = {
          id: d.tmp, url: null, titulo: d.titulo, status: d.status || 'Não iniciada', area: d.area || 'pd', areas: d.area ? [d.area] : [],
          sprints: [Number(d.sprint ?? D.sprint)], n_sprints: 1, subs: [...(d.subs || [])], subs_unknown: [], okrs: d.objetivo ? [d.objetivo] : [],
          okrs_extra: [], bloq: [...(d.bloqueadoPor || [])], tarefas: null, nova: true, pend: ['nova'],
        };
        metas.push(nova); byId.set(nova.id, nova);
        (d.bloqueadoPor || []).forEach((b) => pendEdges.push(`${b}>${nova.id}`));
        break;
      }
      case 'meta.editar': {
        const m = byId.get(d.meta); if (!m) break;
        if (d.titulo) m.titulo = d.titulo;
        if (d.status) m.status = d.status;
        if (d.area) { m.area = d.area; m.areas = [d.area]; }
        if (d.objetivo !== undefined) m.okrs = d.objetivo ? [d.objetivo, ...m.okrs.slice(1).filter((o) => o !== d.objetivo)] : m.okrs.slice(1);
        if (d.subs) m.subs = [...d.subs];
        marca(m, 'editada');
        break;
      }
      case 'meta.mover': {
        const m = byId.get(d.meta); if (!m) break;
        m.subs = [...m.subs.filter((s) => s !== d.de && s !== d.para), d.para];
        marca(m, 'movida');
        break;
      }
      case 'meta.status': { const m = byId.get(d.meta); if (m) { m.status = d.status; marca(m, d.status === 'Abortado' ? 'abortada' : 'status'); } break; }
      case 'meta.proximaSprint': { const m = byId.get(d.meta); if (m) { m.sprints = [...new Set([...m.sprints, Number(d.sprint) + 1])]; m.n_sprints = m.sprints.length; marca(m, `→ #${Number(d.sprint) + 1}`); } break; }
      case 'dependencia.criar': {
        const m = byId.get(d.bloqueada); if (!m) break;
        if (!m.bloq.includes(d.bloqueadora)) m.bloq.push(d.bloqueadora);
        pendEdges.push(`${d.bloqueadora}>${d.bloqueada}`);
        break;
      }
      case 'dependencia.remover': remEdges.push(`${d.bloqueadora}>${d.bloqueada}`); break;
      case 'kpi.medir': {
        const k = kpis.find((y) => y.id === d.kpi); if (!k) break;
        const v = Number(String(d.valor).replace(',', '.'));
        if (Number.isFinite(v)) { k.serie[String(d.sprint)] = v; k.pendSerie = { ...(k.pendSerie || {}), [String(d.sprint)]: true }; }
        break;
      }
      case 'tarefa.criar':
        tarefas.push({ id: d.tmp, url: null, titulo: d.titulo, status: d.status || 'A Fazer', metas: d.meta ? [d.meta] : [], sprints: [Number(d.sprint ?? D.sprint)], resp: d.respNomes || null, resp_ids: d.resp || [], subs: d.subs || [], prazo: d.prazo || null, prioridade: d.prioridade || null, area: d.area || null, nova: true, pend: ['nova'] });
        break;
      case 'tarefa.status': { const t = tarefas.find((y) => y.id === d.tarefa); if (t) { t.status = d.status; t.pend = [...(t.pend || []), 'status']; } break; }
      case 'tarefa.editar': {
        const t = tarefas.find((y) => y.id === d.tarefa); if (!t) break;
        if (d.titulo) t.titulo = d.titulo;
        if (d.resp) { t.resp_ids = d.resp; if (d.respNomes) t.resp = d.respNomes; }
        if (d.prazo !== undefined) t.prazo = d.prazo;
        if (d.prioridade !== undefined) t.prioridade = d.prioridade;
        t.pend = [...(t.pend || []), 'editada'];
        break;
      }
      default: break;
    }
  }
  return { ...D, metas, kpis, tarefas, pendEdges, remEdges };
}
