// Executor dos planos de escrita.
// - Uma gravação por vez (fila serial no processo).
// - Antes de cada passo a página é relida do Notion (sem cache): relação acrescentada = união com o
//   valor atual; campo de valor único que mudou desde o plano = conflito (para tudo e pede reconfirmação).
// - Cada plano só pode ser executado uma vez (planId de uso único) e expira em 15 min.
// - Criação confere antes se a página já existe (idempotente: rodar de novo não duplica).
import { randomUUID } from 'node:crypto';
import { read, toProperties, blocks, blockText, normId, sameId } from '../notion/props.js';
import { propRef } from '../notion/client.js';
import { BASES, spec } from '../notion/schema.js';

const TTL_MS = 15 * 60_000;

export class ConflictError extends Error {}

const eq = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b)) {
    const A = (a || []).map(normId).sort(); const B = (b || []).map(normId).sort();
    return A.length === B.length && A.every((x, i) => x === B[i]);
  }
  return (a ?? null) === (b ?? null) || (typeof a === 'number' && Number(b) === a);
};

const normHeading = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\p{L}\p{N}\s]/gu, '').trim().toLowerCase();

const toBlocks = (children, urlOf) => (children || []).map((c) => {
  if (c.h2) return blocks.h2(c.h2);
  if (c.link) return blocks.link(c.link, c.url);
  return blocks.p(urlOf(c.p));
});

export function createExecutor({ api, audit = () => {} }) {
  const plans = new Map();
  let chain = Promise.resolve();

  const gc = () => { const now = Date.now(); for (const [id, p] of plans) if (now - p.at > TTL_MS) plans.delete(id); };

  function store(plan, email) {
    gc();
    const planId = randomUUID();
    plans.set(planId, { plan, email, at: Date.now(), used: false });
    return planId;
  }

  async function runOp(op, refs) {
    const resolve = (v) => (v && typeof v === 'object' && v.ref ? (refs[v.ref]?.id ?? (() => { throw new Error(`referência ${v.ref} não criada`); })()) : v);
    const urlOf = (text) => String(text).replace(/\{url:([\w:.-]+)\}/g, (_, r) => refs[r]?.url || '');
    const pageId = resolve(op.pageId);

    switch (op.op) {
      case 'create': {
        const props = Object.fromEntries(Object.entries(op.props).map(([k, v]) => [k, Array.isArray(v) ? v.map(resolve) : resolve(v)]));
        if (op.dedupe) {
          const s = spec(op.base, op.dedupe.key);
          const cond = s.type === 'title' ? { title: { equals: op.dedupe.value } }
            : s.type === 'number' ? { number: { equals: op.dedupe.value } }
              : { relation: { contains: op.dedupe.value } };
          const and = [{ property: propRef(op.base, op.dedupe.key), ...cond }];
          if (op.dedupe.sprint) and.push({ property: propRef(op.base, 'sprint'), relation: { contains: op.dedupe.sprint } });
          const found = await api.queryAll(op.base, { filter: and.length > 1 ? { and } : and[0] });
          if (found.length) {
            refs[op.ref] = { id: found[0].id, url: found[0].url };
            return { skip: true, texto: 'já existia — reaproveitada', url: found[0].url };
          }
        }
        const page = await api.createPage(op.base, toProperties(op.base, props), toBlocks(op.children, urlOf));
        refs[op.ref] = { id: page.id, url: page.url };
        return { texto: 'criada', url: page.url };
      }
      case 'set':
      case 'setIfEmpty': {
        const page = await api.retrievePage(pageId);
        const s = spec(op.base, op.key);
        const cur = s.type === 'relation' ? await api.relationIds(page, op.base, op.key) : read(page, op.base, op.key);
        if (eq(cur, op.value)) return { skip: true, texto: 'já estava assim', url: page.url };
        if (op.op === 'setIfEmpty') {
          if (Array.isArray(cur) ? cur.length : cur != null) return { skip: true, texto: 'já preenchido — mantido', url: page.url };
        } else if (op.expect !== undefined && !eq(cur, op.expect)) {
          throw new ConflictError(`"${s.name}" mudou no Notion desde o plano (agora: ${Array.isArray(cur) ? cur.length + ' item(ns)' : JSON.stringify(cur)}). Atualize e confira de novo.`);
        }
        await api.updatePage(page.id, toProperties(op.base, { [op.key]: op.value }));
        return { texto: 'atualizado', url: page.url };
      }
      case 'relAdd':
      case 'relRemove': {
        const page = await api.retrievePage(pageId);
        const cur = await api.relationIds(page, op.base, op.key);
        const ids = op.ids.map(resolve);
        let next;
        if (op.op === 'relAdd') {
          const add = ids.filter((id) => !cur.some((c) => sameId(c, id)));
          if (!add.length) return { skip: true, texto: 'já estava ligada', url: page.url };
          next = [...cur, ...add];
        } else {
          next = cur.filter((c) => !ids.some((id) => sameId(c, id)));
          if (next.length === cur.length) return { skip: true, texto: 'já não estava ligada', url: page.url };
        }
        if (next.length > 100) throw new Error(`"${spec(op.base, op.key).name}" passaria de 100 itens — o Notion não aceita numa gravação.`);
        await api.updatePage(page.id, toProperties(op.base, { [op.key]: next }));
        return { texto: op.op === 'relAdd' ? 'ligada' : 'desligada', url: page.url };
      }
      case 'section': {
        const page = await api.retrievePage(pageId);
        const children = await api.listChildren(page.id);
        const alvo = normHeading(op.heading);
        const isHeading = (b) => /^heading_[123]$/.test(b.type);
        const level = (b) => Number(b.type.slice(-1));
        const idx = children.findIndex((b) => isHeading(b) && normHeading(blockText(b)).endsWith(alvo));
        const novos = op.lines.map((l) => blocks.bullet(urlOf(l)));
        if (idx < 0) {
          await api.appendChildren(page.id, [blocks.h2(op.heading), ...novos]);
          return { texto: `seção "${op.heading}" criada no fim da página`, url: page.url };
        }
        let last = idx;
        for (let i = idx + 1; i < children.length; i += 1) {
          if (isHeading(children[i]) && level(children[i]) <= level(children[idx])) break;
          last = i;
        }
        await api.appendChildren(page.id, novos, children[last].id);
        return { texto: `linha acrescentada em "${op.heading}"`, url: page.url };
      }
      default:
        throw new Error(`operação desconhecida: ${op.op}`);
    }
  }

  // Executa um plano; `onEvent` recebe {tipo:'passo'|'fim', ...} para o NDJSON.
  function exec(planId, email, onEvent = () => {}) {
    const entry = plans.get(planId);
    if (!entry) { const e = new Error('Plano não encontrado ou expirado — gere o plano de novo.'); e.statusCode = 404; throw e; }
    if (entry.email !== email) { const e = new Error('Este plano foi gerado por outra pessoa.'); e.statusCode = 403; throw e; }
    if (entry.used) { const e = new Error('Este plano já foi executado.'); e.statusCode = 409; throw e; }
    entry.used = true;
    const { plan } = entry;

    const run = async () => {
      const refs = {};
      const feitos = []; let erro = null;
      for (let i = 0; i < plan.ops.length; i += 1) {
        const op = plan.ops[i];
        try {
          const r = await runOp(op, refs);
          feitos.push({ i, ...r });
          onEvent({ tipo: 'passo', i, n: plan.ops.length, ok: true, ...r, base: BASES[op.base]?.titulo || op.base });
        } catch (e) {
          erro = { i, mensagem: e.message, conflito: e instanceof ConflictError };
          onEvent({ tipo: 'passo', i, n: plan.ops.length, ok: false, erro: e.message });
          break;
        }
      }
      const links = [...new Set(feitos.map((f) => f.url).filter(Boolean))];
      const result = { tipo: 'fim', ok: !erro, feitos: feitos.length, total: plan.ops.length, erro, links };
      audit({
        message: 'notion.write', email, planId, acao: plan.acao, titulo: plan.titulo,
        ok: !erro, feitos: feitos.length, total: plan.ops.length, erro: erro?.mensagem || null, paginas: links,
      });
      onEvent(result);
      return result;
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }

  return { store, exec, get size() { return plans.size; } };
}
