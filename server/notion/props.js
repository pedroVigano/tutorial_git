// Leitura e escrita de valores de propriedade do Notion, sempre via schema.js.
import { spec, has } from './schema.js';

export const normId = (id) => String(id || '').replace(/-/g, '').toLowerCase();
export const sameId = (a, b) => normId(a) === normId(b);
export const withDashes = (id) => {
  const s = normId(id);
  return s.length === 32 ? `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}` : id;
};

// Valor cru da propriedade na página (casando pelo nome e, se o nome mudou, pelo ID).
export function rawProp(page, base, key) {
  const s = spec(base, key);
  const props = page?.properties || {};
  if (props[s.name]) return props[s.name];
  if (s.id) return Object.values(props).find((v) => v && v.id === s.id) || null;
  return null;
}

const plain = (arr) => (arr || []).map((t) => t.plain_text ?? t.text?.content ?? '').join('');

export function readValue(v, type) {
  if (!v) return type === 'relation' || type === 'multi_select' || type === 'people' ? [] : null;
  switch (type) {
    case 'title': return plain(v.title);
    case 'rich_text': return plain(v.rich_text);
    case 'number': return v.number ?? null;
    case 'select': return v.select?.name ?? null;
    case 'status': return v.status?.name ?? null;
    case 'multi_select': return (v.multi_select || []).map((o) => o.name);
    case 'relation': return (v.relation || []).map((r) => r.id);
    case 'date': return v.date ? { start: v.date.start, end: v.date.end ?? null } : null;
    case 'people': return (v.people || []).map((p) => ({ id: p.id, nome: p.name || null }));
    case 'created_time': return v.created_time ?? null;
    default: return null;
  }
}

export function read(page, base, key) {
  const s = spec(base, key);
  if (!has(base, key)) return readValue(null, s.type);
  let val = readValue(rawProp(page, base, key), s.type);
  if (s.type === 'status' && s.aliases && val in s.aliases) val = s.aliases[val];
  return val;
}

// Relação truncada em 25 itens pela API (has_more) — o chamador busca a lista completa.
export function relationTruncated(page, base, key) {
  const v = rawProp(page, base, key);
  return !!(v && v.type === 'relation' && v.has_more);
}

export const titleOf = (page) => {
  const t = Object.values(page?.properties || {}).find((v) => v && v.type === 'title');
  return t ? plain(t.title) : '';
};

export const iconOf = (page) => (page?.icon?.type === 'emoji' ? page.icon.emoji : null);

// ---------- escrita ----------
const text = (content) => [{ type: 'text', text: { content: String(content).slice(0, 2000) } }];

export function writeValue(type, value) {
  switch (type) {
    case 'title': return { title: text(value) };
    case 'rich_text': return { rich_text: text(value) };
    case 'number': return { number: value == null || value === '' ? null : Number(value) };
    case 'select': return { select: value ? { name: value } : null };
    case 'status': return { status: { name: value } };
    case 'multi_select': return { multi_select: (value || []).map((name) => ({ name })) };
    case 'relation': return { relation: (value || []).map((id) => ({ id })) };
    case 'date': return { date: value ? (typeof value === 'string' ? { start: value } : value) : null };
    case 'people': return { people: (value || []).map((id) => ({ id })) };
    default: throw new Error(`tipo sem escrita: ${type}`);
  }
}

// Status gravado: se o schema tem alias (ex.: "Em Andamento" ← "Fazendo"), converte de volta para o nome real.
function toNotionOption(s, value) {
  if (s.type !== 'status' || !s.aliases) return value;
  const back = Object.entries(s.aliases).find(([, shown]) => shown === value);
  return back ? back[0] : value;
}

// { key: valor } → objeto `properties` da API, pelas chaves do schema.
export function toProperties(base, values) {
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    const s = spec(base, key);
    if (!has(base, key)) continue;
    out[s.id || s.name] = writeValue(s.type, toNotionOption(s, value));
  }
  return out;
}

// Blocos simples para o corpo das páginas.
export const blocks = {
  h2: (t) => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: text(t) } }),
  p: (t) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: text(t) } }),
  bullet: (t) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: text(t) } }),
  link: (label, url) => ({
    object: 'block', type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: label, link: url ? { url } : null } }] },
  }),
};

export const blockText = (b) => plain(b?.[b?.type]?.rich_text);
