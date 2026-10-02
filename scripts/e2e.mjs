// Teste de ponta a ponta no navegador (modo fixture: Notion falso em memória).
// Sobe o app numa porta livre, percorre os fluxos de gravação e confere o resultado na tela.
// Uso: npm run test:e2e
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { buildApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  const dir = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  const p = dir && join(root, dir, 'chrome-linux', 'chrome');
  return p && existsSync(p) ? p : undefined;
}

async function start(env) {
  const app = await buildApp({ config: loadConfig({ NOTION_MODE: 'fixture', AUTH_MODE: 'dev', ...env }), logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, url: `http://127.0.0.1:${app.server.address().port}` };
}

const browser = await chromium.launch({ executablePath: chromiumPath() });
const erros = [];
const passos = [];
const ok = (m) => { passos.push(m); console.log(`  ✓ ${m}`); };

async function gravar(page) {
  await page.waitForSelector('.plan-t, .plan-bloq');
  const bloq = await page.$('.plan-bloq');
  if (bloq) throw new Error(`plano bloqueado: ${await bloq.innerText()}`);
  await page.click('#modal-form button[type=submit]');
  await page.waitForSelector('.plan-ok, .plan-err', { timeout: 15000 });
  const err = await page.$('.plan-err');
  if (err) throw new Error(`gravação falhou: ${await err.innerText()}`);
  await page.click('#p-done');
  await page.waitForFunction(() => !document.getElementById('modal-bg').classList.contains('open'));
  await page.waitForTimeout(400);
}

try {
  // ---------------- editor ----------------
  const { app, url } = await start({});
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, ignoreHTTPSErrors: true });
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && (m.location()?.url || url).startsWith(url)) erros.push(m.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.card');

  // 1. nova meta pelo "+" de uma lane
  const lane = page.locator('.lane[data-lane]:has(.card)').nth(2);
  await lane.locator('[data-add]').click();
  await page.fill('#f-t', 'Testar fluxo de ponta a ponta do dashboard');
  await page.click('#modal-form button[type=submit]');
  await page.waitForSelector('.plan-t');
  const linhas = await page.locator('.plan-t tr').count();
  assert.ok(linhas >= 7, 'plano da nova meta tem uma linha por campo');
  await gravar(page);
  await page.waitForSelector('.card:has-text("Testar fluxo de ponta a ponta do dashboard")');
  ok('nova meta: plano → gravar → card aparece');

  // 2. dependência por clique (drawer → ligar → clicar na bloqueada)
  const cards = page.locator('#lanes .card');
  const titulo0 = (await cards.nth(0).locator('.tt').innerText()).trim();
  await cards.nth(0).click();
  await page.click('#d-link');
  await cards.nth(3).click();
  await page.waitForSelector('.plan-t');
  assert.match(await page.locator('.plan-t').innerText(), /Bloqueado por/);
  await gravar(page);
  const setas = await page.locator('#arrows path[data-edge]').count();
  assert.ok(setas >= 1, 'seta de dependência desenhada');
  ok(`dependência: "${titulo0.slice(0, 30)}…" bloqueia outra meta, seta desenhada`);

  // 3. arrastar card para outra lane → plano com remoção explícita
  const origem = page.locator('.lane[data-lane]:has(.card) .card').first();
  const tituloMov = (await origem.locator('.tt').innerText()).trim();
  const destino = page.locator('.lane[data-lane]:not(:has(.card)) .cards.drop').first();
  await origem.dragTo(destino);
  await page.waitForSelector('.plan-t');
  assert.equal(await page.locator('.plan-t tr.rem').count(), 1, 'remoção do subsistema antigo aparece como linha própria');
  await gravar(page);
  ok(`mover de subsistema: "${tituloMov.slice(0, 30)}…" com remoção explícita no plano`);

  // 4. medição de KPI pela coluna OKR
  await page.click('.chip:nth-of-type(2)');
  await page.locator('[data-kpi]').first().click();
  await page.fill('#k-v', '1');
  await page.click('#modal-form button[type=submit]');
  await gravar(page);
  ok('medição de KPI gravada');

  // 5. abortar (nada é apagado)
  await page.click('.chip:nth-of-type(1)');
  await page.locator('#lanes .card').nth(1).click();
  await page.click('#d-abort');
  await page.waitForSelector('.plan-t');
  assert.match(await page.locator('.plan-avisos').innerText(), /Nada é apagado/);
  await gravar(page);
  ok('abortar meta (status Abortado)');

  // 6. rollover
  await page.click('[data-page="rollover"]');
  await page.waitForSelector('#r-go');
  await page.locator('.r-k').first().fill('2');
  await page.click('#r-go');
  await page.waitForSelector('.plan-t');
  const passosRoll = await page.locator('.plan-t td.mono').allInnerTexts();
  for (const p of ['R1', 'R2', 'R4', 'R6']) assert.ok(passosRoll.some((t) => t.trim() === p), `plano do rollover tem ${p}`);
  await gravar(page);
  await page.waitForFunction(() => [...document.querySelectorAll('#sel-sprint option')].some((o) => o.value === '28'));
  assert.equal(await page.inputValue('#sel-sprint'), '28', 'a #28 vira a sprint em andamento');
  ok('rollover #27 → #28: sprint criada, metas revinculadas, #28 em andamento');
  await page.close();
  await app.close();

  // ---------------- leitor ----------------
  const leitor = await start({ EDITOR_EMAILS: 'outra.pessoa@bsvrobotics.com.br' });
  const p2 = await browser.newPage({ viewport: { width: 1600, height: 1000 }, ignoreHTTPSErrors: true });
  p2.on('pageerror', (e) => erros.push(e.message));
  await p2.goto(leitor.url, { waitUntil: 'networkidle' });
  await p2.waitForSelector('.card');
  assert.equal(await p2.locator('[data-add], .hd, [data-kpi]').count(), 0, 'leitor não vê botões de edição');
  assert.match(await p2.innerText('#user-chip'), /leitura/);
  ok('leitor: sem botões de edição');

  // Trimestral: só leitura — marca um KPI para duplicar e o pedido traz o id; nenhuma chamada de gravação.
  const gravacoes = [];
  p2.on('request', (r) => { if (/\/api\/(plan|exec)/.test(r.url())) gravacoes.push(r.url()); });
  await p2.click('[data-page="trimestral"]');
  await p2.waitForSelector('.tq-obj', { timeout: 15000 });
  assert.equal(await p2.locator('.tq-obj').count(), 5, 'os 5 objetivos de 2026-3 do demo');
  const kpiId = await p2.locator('input[data-dup][data-nivel="kpi"]:not([disabled])').first().getAttribute('data-dup');
  await p2.locator(`input[data-dup="${kpiId}"]`).check();
  const krMarcado = await p2.locator('input[data-dup][data-nivel="kr"]:checked').count();
  assert.ok(krMarcado >= 1, 'marcar o KPI marca o KR dele');
  const pedido = await p2.locator('#tq-pedido').textContent();
  assert.ok(pedido.includes(kpiId), 'o pedido traz o id do KPI marcado');
  assert.match(pedido, /objetivo NOVO \(cópia\)/);
  assert.match(new URL(p2.url()).search, /pagina=trimestral/);
  assert.equal(gravacoes.length, 0, 'a página Trimestral não grava no Notion');
  ok('trimestral: revisão de 2026-3, marcar para duplicar gera pedido, sem gravação');
  await p2.close();
  await leitor.app.close();

  if (erros.length) throw new Error(`erros no navegador:\n${erros.join('\n')}`);
  console.log(`\ne2e ok (${passos.length} fluxos)`);
} catch (e) {
  console.error(`\ne2e FALHOU: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
