// Utilitários do mock v2.2 (mesmo comportamento).
export const fmt = (v) => (v == null ? '—' : Math.abs(v) >= 1000 ? v.toLocaleString('pt-BR') : String(v).replace('.', ','));
export const dm = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// '2026 - 3' ± d trimestres
export function quarterShift(tri, d) {
  const m = /^(\d{4}) - (\d)$/.exec(tri || ''); if (!m) return tri;
  let y = Number(m[1]); let q = Number(m[2]) + d;
  while (q > 4) { q -= 4; y += 1; } while (q < 1) { q += 4; y -= 1; }
  return `${y} - ${q}`;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(m, ms = 2400) {
  const t = document.getElementById('toast');
  t.textContent = m;
  t.classList.add('on');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('on'), ms);
}

function fallbackCopy(t) {
  const ta = document.createElement('textarea');
  ta.value = t; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('Copiado'); } catch { toast('Não foi possível copiar'); }
  ta.remove();
}
export function copy(t, msg = 'Prompt copiado — cole numa conversa com o Claude') {
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(t).then(() => toast(msg), () => fallbackCopy(t));
  else fallbackCopy(t);
}

export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// localStorage pode falhar (janela privada, bloqueio): nunca quebra a página.
export const store = {
  get(k, def = null) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignora */ } },
};
