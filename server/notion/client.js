// Camada fina sobre o SDK do Notion (ou sobre o Notion falso dos testes/modo fixture):
// limitador, paginação e relação completa (> 25 itens).
import { Client } from '@notionhq/client';
import { BASES, spec, has } from './schema.js';
import { rawProp, readValue } from './props.js';
import { createLimiter } from './limiter.js';

export const NOTION_VERSION = '2025-09-03';

export function createSdkClient(token) {
  if (!token) throw new Error('NOTION_TOKEN não definido');
  return new Client({
    auth: token,
    notionVersion: NOTION_VERSION,
    timeoutMs: 30_000,
    retry: { maxRetries: 5, initialRetryDelayMs: 1000, maxRetryDelayMs: 30_000 },
  });
}

// `client` expõe a mesma superfície do SDK: dataSources, pages, blocks, users.
export function createApi(client, { limiter = createLimiter() } = {}) {
  const call = (fn) => limiter.run(fn);
  let requests = 0;
  const count = (fn) => () => { requests += 1; return fn(); };

  async function paginate(fn) {
    const out = [];
    let cursor;
    do {
      const res = await call(count(() => fn(cursor)));
      out.push(...res.results);
      cursor = res.has_more ? res.next_cursor : null;
    } while (cursor);
    return out;
  }

  const api = {
    get requests() { return requests; },
    resetCount() { requests = 0; },

    queryAll(base, { filter, sorts } = {}) {
      const data_source_id = BASES[base].ds;
      return paginate((start_cursor) => client.dataSources.query({
        data_source_id, filter, sorts, page_size: 100, ...(start_cursor ? { start_cursor } : {}),
      }));
    },

    retrieveDataSource(base) {
      return call(count(() => client.dataSources.retrieve({ data_source_id: BASES[base].ds })));
    },

    retrievePage(page_id) {
      return call(count(() => client.pages.retrieve({ page_id })));
    },

    // IDs completos de uma relação, mesmo acima de 25 itens.
    async relationIds(page, base, key) {
      const v = rawProp(page, base, key);
      if (!v) return [];
      if (!v.has_more) return readValue(v, 'relation');
      const items = await paginate((start_cursor) => client.pages.properties.retrieve({
        page_id: page.id, property_id: v.id, page_size: 100, ...(start_cursor ? { start_cursor } : {}),
      }));
      return items.map((it) => it.relation?.id).filter(Boolean);
    },

    updatePage(page_id, properties) {
      return call(count(() => client.pages.update({ page_id, properties })));
    },

    createPage(base, properties, children = []) {
      return call(count(() => client.pages.create({
        parent: { type: 'data_source_id', data_source_id: BASES[base].ds },
        properties,
        ...(children.length ? { children } : {}),
      })));
    },

    listChildren(block_id) {
      return paginate((start_cursor) => client.blocks.children.list({
        block_id, page_size: 100, ...(start_cursor ? { start_cursor } : {}),
      }));
    },

    appendChildren(block_id, children, after) {
      return call(count(() => client.blocks.children.append({ block_id, children, ...(after ? { after } : {}) })));
    },

    retrieveUser(user_id) {
      return call(count(() => client.users.retrieve({ user_id })));
    },
  };
  return api;
}

// Consulta por "relação contém qualquer um destes IDs", em lotes (o Notion aceita até 100 condições num `or`).
export async function queryByRelationAny(api, base, key, ids, { extra, batch = 50 } = {}) {
  const s = spec(base, key);
  if (!has(base, key) || !ids.length) return [];
  const prop = s.id || s.name;
  const out = new Map();
  for (let i = 0; i < ids.length; i += batch) {
    const chunk = ids.slice(i, i + batch);
    const or = chunk.map((id) => ({ property: prop, relation: { contains: id } }));
    const filter = extra ? { and: [extra, { or }] } : { or };
    for (const p of await api.queryAll(base, { filter })) out.set(p.id, p);
  }
  return [...out.values()];
}

export const propRef = (base, key) => { const s = spec(base, key); return s.id || s.name; };
