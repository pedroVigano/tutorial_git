// Chamadas à API do servidor.
const etags = new Map();
const last = new Map();

async function asJson(r) {
  let body = null;
  try { body = await r.json(); } catch { /* sem corpo */ }
  if (!r.ok) {
    const e = new Error(body?.erro || `HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return body;
}

// Snapshot com ETag: se nada mudou no servidor, devolve o mesmo objeto (changed=false).
export async function getSnapshot({ sprint = null, tri = null, force = false } = {}) {
  const q = new URLSearchParams();
  if (sprint != null) q.set('sprint', sprint);
  if (tri) q.set('tri', tri);
  if (force) q.set('force', '1');
  const key = `${sprint}|${tri}`;
  const headers = {};
  if (!force && etags.has(key)) headers['If-None-Match'] = etags.get(key);
  const r = await fetch(`/api/snapshot?${q}`, { headers });
  if (r.status === 304 && last.has(key)) return { ...last.get(key), changed: false };
  const body = await asJson(r);
  etags.set(key, r.headers.get('ETag'));
  last.set(key, body);
  return { ...body, changed: true };
}

export const me = () => fetch('/api/me').then(asJson);
export const health = () => fetch('/api/health').then(asJson);
export const refresh = () => fetch('/api/refresh', { method: 'POST' }).then(asJson);

// sprint/tri: os mesmos da tela (null = sprint em andamento), para o plano usar o snapshot em cache
export const plan = (acao, dados, { sprint = null, tri = null } = {}) => fetch('/api/plan', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao, dados, sprint, tri }),
}).then(asJson);

// Executa o plano e repassa cada evento NDJSON (passo a passo) para onEvent.
export async function exec(planId, onEvent) {
  const r = await fetch('/api/exec', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId }),
  });
  if (!r.ok) await asJson(r);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = ''; let fim = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.tipo === 'fim') fim = ev;
      onEvent(ev);
    }
  }
  return fim || { tipo: 'fim', ok: false, erro: { mensagem: 'A conexão caiu antes do fim — atualize e confira no Notion.' } };
}
