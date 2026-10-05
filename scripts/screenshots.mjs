// Screenshots do dashboard (Tática, Trimestral, Operacional, Eu, Rollover, painel Reunião, modo TV; claro e escuro) + erros de console.
// Uso: suba o servidor (npm run dev) e rode `npm run screenshots -- [url] [pasta]`.
// Chromium: usa o do Playwright pré-instalado (PLAYWRIGHT_BROWSERS_PATH) ou CHROMIUM_PATH.
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://localhost:8080';
const out = process.argv[3] || 'screenshots';
mkdirSync(out, { recursive: true });

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  const dir = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  const p = dir && join(root, dir, 'chrome-linux', 'chrome');
  return p && existsSync(p) ? p : undefined;
}

const browser = await chromium.launch({ executablePath: chromiumPath() });
const erros = [];
async function shot(name, url, { dark = false, action } = {}) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: dark ? 'dark' : 'light', ignoreHTTPSErrors: true });
  // recursos externos (Google Fonts) podem falhar em redes com proxy — só erros do próprio app contam
  page.on('console', (m) => { if (m.type() === 'error' && (m.location()?.url || base).startsWith(base)) erros.push(`${name}: ${m.text()}`); });
  page.on('pageerror', (e) => erros.push(`${name}: ${e.message}`));
  await page.goto(`${base}${url}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.proj, .empty', { timeout: 15000 });
  if (action) await action(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: false });
  await page.close();
}

await shot('board', '/');
await shot('board-escuro', '/', { dark: true });
await shot('board-objetivo', '/', { action: async (p) => { await p.click('.chip:nth-of-type(2)'); } });
await shot('rollover', '/', { action: async (p) => { await p.click('[data-page="rollover"]'); } });
await shot('trimestral', '/', { action: async (p) => { await p.click('[data-page="trimestral"]'); await p.waitForSelector('.tq-grp', { timeout: 15000 }); } });
await shot('operacional', '/', { action: async (p) => { await p.click('[data-page="operacional"]'); await p.waitForSelector('.kanban'); } });
await shot('eu', '/', { action: async (p) => { await p.click('[data-page="eu"]'); await p.waitForSelector('#page-eu .page-h'); } });
await shot('reuniao', '/', { action: async (p) => { await p.click('#reuniao-btn'); await p.waitForSelector('#reuniao-panel.open #mt-txt'); } });
await shot('tv', '/?modo=tv', { dark: true });
await shot('drawer', '/', { action: async (p) => { await p.click('.card'); } });
await shot('revisao', '/', {
  action: async (p) => {
    await p.click('.card');
    await p.click('#d-abort');
    await p.click('#rascunho-btn');
    await p.waitForSelector('#review .rv-plan .plan-t, #review .plan-bloq');
  },
});
await browser.close();
if (erros.length) { console.error('Erros no console:\n' + erros.join('\n')); process.exit(1); }
console.log(`screenshots em ${out}/`);
