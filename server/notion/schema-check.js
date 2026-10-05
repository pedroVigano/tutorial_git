// Confere schema.js contra o schema vivo de cada data source ("verificar antes de afirmar").
// Resultado por campo: OK / AVISO / ERRO. Com ERRO o servidor sobe em modo somente leitura.
import { BASES } from './schema.js';
import { normId } from './props.js';

export async function checkSchema(api) {
  const items = [];
  const resolution = {};
  const push = (base, key, nivel, msg) => items.push({ base, key, nivel, msg });

  for (const [base, b] of Object.entries(BASES)) {
    resolution[base] = {};
    const ERRO = b.opcional ? 'AVISO' : 'ERRO'; // base opcional: o problema só desliga o recurso dela
    let ds;
    try {
      ds = await api.retrieveDataSource(base);
    } catch (e) {
      const why = e.status === 404 || e.code === 'object_not_found'
        ? 'base não encontrada — a integração do Notion está conectada a ela?'
        : `erro ao ler a base: ${e.message}`;
      push(base, '*', ERRO, `${b.titulo}: ${why}${b.opcional ? ' (recurso desligado; o resto do dashboard segue)' : ''}`);
      for (const key of Object.keys(b.props)) resolution[base][key] = { missing: true };
      continue;
    }
    const props = Object.values(ds.properties || {});
    for (const [key, s] of Object.entries(b.props)) {
      let cfg = s.id ? props.find((p) => p.id === s.id) : null;
      if (cfg && cfg.name !== s.name) push(base, key, 'AVISO', `"${s.name}" foi renomeado para "${cfg.name}" no Notion — atualize schema.js`);
      if (!cfg) cfg = props.find((p) => p.name === s.name);
      if (!cfg) {
        if (s.optional) {
          push(base, key, 'AVISO', `"${s.name}" ainda não existe (Fase 4) — o dashboard segue sem ele`);
        } else {
          push(base, key, ERRO, `campo "${s.name}" não encontrado em ${b.titulo}`);
        }
        resolution[base][key] = { missing: true };
        continue;
      }
      resolution[base][key] = { name: cfg.name, id: cfg.id, missing: false };
      if (cfg.type !== s.type) {
        push(base, key, ERRO, `"${cfg.name}" é do tipo ${cfg.type}, esperado ${s.type}`);
        if (b.opcional) resolution[base][key] = { missing: true };
        continue;
      }
      if (s.type === 'relation' && s.target) {
        const alvo = cfg.relation?.data_source_id;
        if (alvo && normId(alvo) !== normId(BASES[s.target].ds)) {
          push(base, key, ERRO, `"${cfg.name}" aponta para outra base (${alvo}), esperado ${BASES[s.target].titulo}`);
          continue;
        }
      }
      if (s.options) {
        const existentes = new Set((cfg[cfg.type]?.options || []).map((o) => o.name));
        const faltando = s.options.filter((o) => !existentes.has(o) && !(s.aliases?.[o] && existentes.has(s.aliases[o])));
        if (faltando.length) {
          push(base, key, s.grava ? ERRO : 'AVISO', `"${cfg.name}" sem a(s) opção(ões): ${faltando.join(', ')}`);
          continue;
        }
      }
      push(base, key, 'OK', cfg.name);
    }
  }
  const erros = items.filter((i) => i.nivel === 'ERRO');
  const avisos = items.filter((i) => i.nivel === 'AVISO');
  return { ok: erros.length === 0, erros, avisos, items, resolution, em: new Date().toISOString() };
}

export function formatReport(r) {
  const rows = r.items.filter((i) => i.nivel !== 'OK');
  const lines = [`Schema do Notion: ${r.items.filter((i) => i.nivel === 'OK').length} OK · ${r.avisos.length} aviso(s) · ${r.erros.length} erro(s)`];
  for (const i of rows) lines.push(`  ${i.nivel.padEnd(5)} ${i.base}.${i.key} — ${i.msg}`);
  return lines.join('\n');
}
