// Notion falso em memória, com a mesma superfície do SDK usada pelo app
// (dataSources.query/retrieve, pages.*, blocks.children.*, users.retrieve).
// Usado nos testes e no modo NOTION_MODE=fixture (demo sem token), para que leitura
// e escrita passem exatamente pelo mesmo código do modo real.
import { randomUUID, createHash } from 'node:crypto';
import { BASES } from './schema.js';

const REL_PAGE_LIMIT = 25; // a API real corta relações em 25 itens por página

export const fakePropId = (base, key) => createHash('md5').update(`${base}.${key}`).digest('base64url').slice(0, 6);

// Schema dos data sources a partir de schema.js (campos opcionais ficam de fora, como no Notion de hoje).
export function fakeDataSources() {
  const out = {};
  for (const [base, b] of Object.entries(BASES)) {
    const properties = {};
    for (const [key, p] of Object.entries(b.props)) {
      if (p.optional) continue;
      const cfg = { id: fakePropId(base, key), name: p.name, type: p.type };
      if (p.type === 'status' || p.type === 'select' || p.type === 'multi_select') {
        const opts = (p.options || []).map((name) => ({ id: fakePropId(base, `${key}:${name}`), name }));
        cfg[p.type] = p.type === 'status' ? { options: opts, groups: [] } : { options: opts };
      } else if (p.type === 'relation') {
        cfg.relation = { data_source_id: BASES[p.target].ds, database_id: BASES[p.target].ds, type: 'single_property', single_property: {} };
      } else {
        cfg[p.type] = {};
      }
      properties[p.name] = cfg;
    }
    out[b.ds] = { object: 'data_source', id: b.ds, title: [{ plain_text: b.titulo }], properties };
  }
  // pares de relação sincronizados (o Notion atualiza o espelho sozinho)
  const dual = (base, a, b) => {
    const props = out[BASES[base].ds].properties;
    const pa = props[BASES[base].props[a].name];
    const pb = props[BASES[base].props[b].name];
    pa.relation = { ...pa.relation, type: 'dual_property', dual_property: { synced_property_id: pb.id, synced_property_name: pb.name } };
    pb.relation = { ...pb.relation, type: 'dual_property', dual_property: { synced_property_id: pa.id, synced_property_name: pa.name } };
  };
  dual('metas', 'bloqueadoPor', 'bloqueando');
  dual('okrs', 'pai', 'filhos');
  dual('projetos', 'pai', 'filhos');
  return out;
}

const emptyValue = (cfg) => {
  switch (cfg.type) {
    case 'title': return { title: [] };
    case 'rich_text': return { rich_text: [] };
    case 'number': return { number: null };
    case 'select': return { select: null };
    case 'status': return { status: null };
    case 'multi_select': return { multi_select: [] };
    case 'relation': return { relation: [], has_more: false };
    case 'date': return { date: null };
    case 'people': return { people: [] };
    default: return {};
  }
};

const plain = (arr) => (arr || []).map((t) => t.plain_text ?? t.text?.content ?? '').join('');
const norm = (id) => String(id || '').replace(/-/g, '').toLowerCase();

class NotionError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function createFakeNotion(state = {}) {
  const ds = state.dataSources || fakeDataSources();
  const pages = new Map(Object.entries(state.pages || {}));
  const blocks = new Map(Object.entries(state.blocks || {}));
  const users = new Map(Object.entries(state.users || {}));
  const log = [];
  let clock = Date.parse(state.now || '2026-09-28T12:00:00Z');
  const tick = () => new Date((clock += 1000)).toISOString();

  const findPage = (id) => {
    const p = pages.get(id) || [...pages.values()].find((x) => norm(x.id) === norm(id));
    if (!p || p.in_trash) throw new NotionError(404, 'object_not_found', `Could not find page with ID: ${id}`);
    return p;
  };
  const dsOf = (page) => ds[page.parent.data_source_id];
  const propCfg = (dsObj, ref) => dsObj.properties[ref] || Object.values(dsObj.properties).find((c) => c.id === ref);

  const pageUrl = (id) => `https://www.notion.so/${norm(id)}`;

  // Visão "como a API devolve": relações cortadas em 25 com has_more.
  const view = (page) => {
    const props = {};
    for (const [name, v] of Object.entries(page.properties)) {
      if (v.type === 'relation' && v.relation.length > REL_PAGE_LIMIT) {
        props[name] = { ...v, relation: v.relation.slice(0, REL_PAGE_LIMIT), has_more: true };
      } else if (v.type === 'title' || v.type === 'rich_text') {
        props[name] = { ...v, [v.type]: v[v.type].map((t) => ({ ...t, plain_text: t.plain_text ?? t.text?.content ?? '' })) };
      } else {
        props[name] = { ...v };
      }
    }
    return structuredClone({ ...page, properties: props });
  };

  function matches(page, filter) {
    if (!filter) return true;
    if (filter.and) return filter.and.every((f) => matches(page, f));
    if (filter.or) return filter.or.some((f) => matches(page, f));
    const cfg = propCfg(dsOf(page), filter.property);
    if (!cfg) throw new NotionError(400, 'validation_error', `Could not find property with name or id: ${filter.property}`);
    const v = page.properties[cfg.name] || emptyValue(cfg);
    const type = Object.keys(filter).find((k) => k !== 'property');
    const cond = filter[type];
    const [op, arg] = Object.entries(cond)[0];
    let val;
    switch (cfg.type) {
      case 'title': case 'rich_text': val = plain(v[cfg.type]); break;
      case 'number': val = v.number; break;
      case 'select': val = v.select?.name ?? null; break;
      case 'status': val = v.status?.name ?? null; break;
      case 'multi_select': val = (v.multi_select || []).map((o) => o.name); break;
      case 'relation': val = (v.relation || []).map((r) => norm(r.id)); break;
      case 'date': val = v.date?.start ?? null; break;
      case 'people': val = (v.people || []).map((u) => u.id); break;
      default: val = null;
    }
    switch (op) {
      case 'equals': return cfg.type === 'number' ? val === Number(arg) : val === arg;
      case 'does_not_equal': return val !== arg;
      case 'contains':
        if (Array.isArray(val)) return cfg.type === 'relation' ? val.includes(norm(arg)) : val.includes(arg);
        return String(val || '').toLowerCase().includes(String(arg).toLowerCase());
      case 'does_not_contain':
        if (Array.isArray(val)) return cfg.type === 'relation' ? !val.includes(norm(arg)) : !val.includes(arg);
        return !String(val || '').toLowerCase().includes(String(arg).toLowerCase());
      case 'is_empty': return Array.isArray(val) ? val.length === 0 : val == null || val === '';
      case 'is_not_empty': return Array.isArray(val) ? val.length > 0 : !(val == null || val === '');
      case 'greater_than': return val != null && val > arg;
      case 'less_than': return val != null && val < arg;
      case 'on_or_after': return val != null && val >= arg;
      case 'on_or_before': return val != null && val <= arg;
      default: throw new NotionError(400, 'validation_error', `fake: filtro não suportado ${type}.${op}`);
    }
  }

  function setProps(page, properties) {
    const dsObj = dsOf(page);
    for (const [ref, value] of Object.entries(properties || {})) {
      const cfg = propCfg(dsObj, ref);
      if (!cfg) throw new NotionError(400, 'validation_error', `${ref} is not a property that exists.`);
      const type = cfg.type;
      const prev = page.properties[cfg.name];
      let next;
      if (type === 'status' || type === 'select') {
        const name = value[type]?.name ?? null;
        if (name && type === 'status' && !cfg.status.options.some((o) => o.name === name)) {
          throw new NotionError(400, 'validation_error', `Invalid status option: "${name}"`);
        }
        next = { id: cfg.id, type, [type]: name ? { name } : null };
      } else if (type === 'relation') {
        const ids = (value.relation || []).map((r) => r.id);
        next = { id: cfg.id, type, relation: ids.map((id) => ({ id })), has_more: false };
        // espelho automático em relações sincronizadas
        if (cfg.relation?.type === 'dual_property') {
          const before = new Set((prev?.relation || []).map((r) => norm(r.id)));
          const after = new Set(ids.map(norm));
          const mirror = cfg.relation.dual_property.synced_property_name;
          for (const id of ids) if (!before.has(norm(id))) mirrorEdit(id, mirror, page.id, true);
          for (const r of prev?.relation || []) if (!after.has(norm(r.id))) mirrorEdit(r.id, mirror, page.id, false);
        }
      } else {
        next = { id: cfg.id, type, [type]: value[type] ?? null };
        if (type === 'title' || type === 'rich_text') {
          next[type] = (value[type] || []).map((t) => ({ ...t, plain_text: t.text?.content ?? t.plain_text ?? '' }));
        }
      }
      page.properties[cfg.name] = next;
    }
    page.last_edited_time = tick();
  }

  function mirrorEdit(targetId, propName, sourceId, add) {
    const t = [...pages.values()].find((p) => norm(p.id) === norm(targetId));
    if (!t) return;
    const cur = t.properties[propName] || { type: 'relation', relation: [] };
    const ids = cur.relation.map((r) => r.id).filter((id) => norm(id) !== norm(sourceId));
    if (add) ids.push(sourceId);
    t.properties[propName] = { ...cur, relation: ids.map((id) => ({ id })), has_more: false };
  }

  const paginateArr = (arr, start_cursor, page_size = 100) => {
    const start = start_cursor ? Number(start_cursor) : 0;
    const results = arr.slice(start, start + page_size);
    const has_more = start + page_size < arr.length;
    return { object: 'list', results, has_more, next_cursor: has_more ? String(start + page_size) : null };
  };

  const client = {
    dataSources: {
      async retrieve({ data_source_id }) {
        log.push(['dataSources.retrieve', data_source_id]);
        const d = ds[data_source_id];
        if (!d) throw new NotionError(404, 'object_not_found', `Could not find data_source with ID: ${data_source_id}`);
        return structuredClone(d);
      },
      async query({ data_source_id, filter, start_cursor, page_size }) {
        log.push(['dataSources.query', data_source_id]);
        if (!ds[data_source_id]) throw new NotionError(404, 'object_not_found', `Could not find data_source with ID: ${data_source_id}`);
        const all = [...pages.values()]
          .filter((p) => !p.in_trash && p.parent.data_source_id === data_source_id)
          .filter((p) => matches(p, filter))
          .sort((a, b) => a.created_time.localeCompare(b.created_time));
        const r = paginateArr(all, start_cursor, page_size);
        return { ...r, results: r.results.map(view) };
      },
    },
    pages: {
      async retrieve({ page_id }) { log.push(['pages.retrieve', page_id]); return view(findPage(page_id)); },
      async update({ page_id, properties, in_trash, archived }) {
        log.push(['pages.update', page_id, properties]);
        const p = findPage(page_id);
        setProps(p, properties);
        if (in_trash || archived) p.in_trash = true;
        return view(p);
      },
      async create({ parent, properties, children }) {
        log.push(['pages.create', parent.data_source_id, properties]);
        const dsObj = ds[parent.data_source_id];
        if (!dsObj) throw new NotionError(404, 'object_not_found', 'data source não encontrado');
        const id = randomUUID();
        const now = tick();
        const page = {
          object: 'page', id, url: pageUrl(id), icon: null, in_trash: false,
          created_time: now, last_edited_time: now,
          parent: { type: 'data_source_id', data_source_id: parent.data_source_id },
          properties: Object.fromEntries(Object.values(dsObj.properties).map((c) => [c.name, { id: c.id, type: c.type, ...emptyValue(c) }])),
        };
        pages.set(id, page);
        setProps(page, properties);
        blocks.set(id, (children || []).map((b) => ({ ...structuredClone(b), id: randomUUID() })));
        return view(page);
      },
      properties: {
        async retrieve({ page_id, property_id, start_cursor, page_size }) {
          log.push(['pages.properties.retrieve', page_id, property_id]);
          const p = findPage(page_id);
          const v = Object.values(p.properties).find((x) => x.id === property_id);
          if (!v) throw new NotionError(404, 'object_not_found', 'property');
          if (v.type !== 'relation') return { object: 'property_item', id: v.id, type: v.type, [v.type]: v[v.type] };
          const items = v.relation.map((r) => ({ object: 'property_item', id: v.id, type: 'relation', relation: { id: r.id } }));
          return { ...paginateArr(items, start_cursor, page_size), type: 'property_item', property_item: { id: v.id, type: 'relation', relation: {} } };
        },
      },
    },
    blocks: {
      children: {
        async list({ block_id, start_cursor, page_size }) {
          log.push(['blocks.children.list', block_id]);
          findPage(block_id);
          return paginateArr(structuredClone(blocks.get(block_id) || []), start_cursor, page_size);
        },
        async append({ block_id, children, after }) {
          log.push(['blocks.children.append', block_id, children, after]);
          findPage(block_id);
          const list = blocks.get(block_id) || [];
          const added = children.map((b) => ({ ...structuredClone(b), id: randomUUID() }));
          const idx = after ? list.findIndex((b) => norm(b.id) === norm(after)) : -1;
          if (after && idx < 0) throw new NotionError(400, 'validation_error', 'after block not found');
          if (idx >= 0) list.splice(idx + 1, 0, ...added); else list.push(...added);
          blocks.set(block_id, list);
          return { object: 'list', results: added, has_more: false, next_cursor: null };
        },
      },
    },
    users: {
      async retrieve({ user_id }) {
        log.push(['users.retrieve', user_id]);
        const u = users.get(user_id);
        if (!u) throw new NotionError(404, 'object_not_found', 'user');
        return structuredClone(u);
      },
    },
  };

  return {
    client,
    log,
    pages,
    blocks,
    dataSources: ds,
    // helpers de teste
    page: (id) => findPage(id),
    blocksOf: (id) => blocks.get(id) || [],
    renameProperty(base, oldName, newName) {
      const d = ds[BASES[base].ds];
      const cfg = d.properties[oldName];
      delete d.properties[oldName];
      d.properties[newName] = { ...cfg, name: newName };
      for (const p of pages.values()) {
        if (p.parent.data_source_id === d.id && p.properties[oldName]) {
          p.properties[newName] = p.properties[oldName];
          delete p.properties[oldName];
        }
      }
    },
  };
}

// Constrói uma página crua (formato da API) para fixtures.
export function makePage({ base, id = randomUUID(), props = {}, icon = null, created_time = '2026-07-01T12:00:00.000Z', url }) {
  const d = fakeDataSources()[BASES[base].ds];
  const properties = {};
  for (const cfg of Object.values(d.properties)) properties[cfg.name] = { id: cfg.id, type: cfg.type, ...emptyValue(cfg) };
  for (const [key, value] of Object.entries(props)) {
    const p = BASES[base].props[key];
    const cfg = d.properties[p.name];
    if (!cfg) continue;
    const t = cfg.type;
    let v;
    switch (t) {
      case 'title': case 'rich_text': v = { [t]: [{ type: 'text', text: { content: String(value ?? '') }, plain_text: String(value ?? '') }] }; break;
      case 'number': v = { number: value ?? null }; break;
      case 'select': case 'status': v = { [t]: value ? { name: value } : null }; break;
      case 'multi_select': v = { multi_select: (value || []).map((name) => ({ name })) }; break;
      case 'relation': v = { relation: (value || []).map((rid) => ({ id: rid })), has_more: false }; break;
      case 'date': v = { date: value ? (typeof value === 'string' ? { start: value, end: null } : value) : null }; break;
      case 'people': v = { people: (value || []).map((u) => (typeof u === 'string' ? { object: 'user', id: u } : { object: 'user', ...u })) }; break;
      default: v = {};
    }
    properties[cfg.name] = { id: cfg.id, type: t, ...v };
  }
  return {
    object: 'page', id, url: url || `https://www.notion.so/${norm(id)}`, icon: icon ? { type: 'emoji', emoji: icon } : null,
    in_trash: false, created_time, last_edited_time: created_time,
    parent: { type: 'data_source_id', data_source_id: BASES[base].ds },
    properties,
  };
}
