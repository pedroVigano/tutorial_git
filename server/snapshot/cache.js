// Cache em memória dos snapshots, por sprint/trimestre.
// Sem timers: quando uma requisição encontra o cache velho, ele é refeito ali mesmo
// (no Cloud Run a CPU fica parada entre requisições). Uma única atualização por chave de cada vez.
import { createHash } from 'node:crypto';
import { loadRaw } from '../notion/queries.js';
import { buildSnapshot } from './build.js';

export function createSnapshotService({ api, ttlMs = 120_000, log = () => {} }) {
  const entries = new Map();

  async function load(key, opts) {
    const t0 = Date.now();
    api.resetCount?.();
    const raw = await loadRaw(api, opts);
    const data = buildSnapshot(raw, { sprintN: opts.sprint });
    const json = JSON.stringify(data);
    const etag = `"${createHash('sha1').update(json).digest('base64url').slice(0, 20)}"`;
    log({ message: 'snapshot.load', key, ms: Date.now() - t0, requests: api.requests });
    return { at: Date.now(), data, json, etag };
  }

  return {
    async get({ sprint = null, tri = null, force = false } = {}) {
      const key = `${sprint ?? 'atual'}|${tri ?? ''}`;
      let e = entries.get(key);
      const fresh = e && e.value && Date.now() - e.value.at < ttlMs;
      if (fresh && !force) return e.value;
      if (e?.pending) return e.pending;
      e = e || {};
      e.pending = load(key, { sprint, tri })
        .then((value) => { e.value = value; return value; })
        .finally(() => { e.pending = null; });
      entries.set(key, e);
      return e.pending;
    },
    invalidate() {
      for (const e of entries.values()) if (e.value) e.value.at = 0;
    },
  };
}
