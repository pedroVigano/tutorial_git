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

  // Trimestral: duplicar objetivo → abortar um KR → editar texto → arrastar alvo → novo KR → gravar → reabrir pareado
  await page.click('[data-page="trimestral"]');
  await page.waitForSelector('.tq-grp', { timeout: 15000 });
  const grp = page.locator('.tq-grp').first();
  await grp.locator('[data-dup][data-grau="Objetivo"]').click();
  await page.waitForSelector('.tq-grp >> nth=0 >> .tq-cell.q4.copy');
  const nKr = await page.locator('.tq-grp').first().locator('.tq-row.kr').count();
  const nCopias = await page.locator('.tq-grp').first().locator('.tq-cell.q4.copy').count();
  assert.ok(nCopias > nKr, 'duplicar objetivo copia KRs e KPIs');
  // abortar o 2º KR: some do planejado, o espaço continua
  await page.locator('.tq-grp').first().locator('.tq-row.kr').nth(1).locator('.tq-pair').first().locator('[data-abortar]').click();
  await page.waitForSelector('.tq-grp >> nth=0 >> [data-restaurar]');
  // editar o texto do objetivo copiado
  const txt = page.locator('.tq-grp').first().locator('.tq-row.obj textarea.tq-txt');
  await txt.fill('Objetivo do quarto trimestre (e2e)');
  await txt.blur();
  // arrastar o alvo do 1º KPI copiado para cima
  const alvoAntes = await page.locator('.tq-grp').first().locator('input[data-campo="alvo"]').first().inputValue();
  const alvo4 = page.locator('.tq-grp').first().locator('.tq-tgt4.drag').first();
  const box = await alvo4.locator('circle.h').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 25, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const alvoNovo = await page.locator('.tq-grp').first().locator('input[data-campo="alvo"]').first().inputValue();
  assert.ok(alvoNovo !== '' && Number(alvoNovo) !== Number(alvoAntes), `arrastar muda o alvo (${alvoAntes} → ${alvoNovo})`);
  // KR novo no objetivo copiado
  await page.locator('.tq-grp').first().locator('.tq-row.obj [data-add="Resultado-Chave"]').click();
  const novoKr = page.locator('.tq-grp').first().locator('.tq-cell.q4.novo textarea').first();
  await novoKr.fill('Garantir KR novo criado na reunião');
  await novoKr.blur();
  await page.click('#tq-gravar');
  await page.waitForSelector('.plan-t, .plan-bloq', { timeout: 30000 });
  assert.match(await page.locator('.plan-t').innerText(), /criar página/);
  await gravar(page);
  await page.waitForFunction(() => document.querySelectorAll('.tq-grp .tq-cell.q4.exist').length > 0, null, { timeout: 30000 });
  const grp0 = page.locator('.tq-grp').first();
  assert.equal(await grp0.locator('.tq-cell.q4.copy').count(), 0, 'depois de gravar não sobra rascunho');
  assert.match(await grp0.locator('.tq-row.obj textarea.tq-txt').inputValue(), /quarto trimestre \(e2e\)/);
  assert.ok(await grp0.locator('[data-dup][data-grau="Resultado-Chave"]').count() >= 1, 'KR abortado continua com espaço vazio (pode duplicar depois)');
  assert.ok(await grp0.locator('textarea.tq-txt').evaluateAll((xs) => xs.some((x) => x.value === 'Garantir KR novo criado na reunião')), 'KR novo aparece no planejado');
  ok('trimestral: duplicar, abortar, editar, arrastar alvo, KR novo, gravar e reabrir pareado pela Origem');
  // editar só o texto de um item que já existe habilita "Gravar"; abortar o objetivo existente leva os filhos
  const krTxt = grp0.locator('.tq-row.kr .tq-cell.q4.exist textarea.tq-txt').first();
  await krTxt.fill('KR existente com texto revisado');
  await krTxt.blur();
  assert.ok(!(await page.locator('#tq-gravar').isDisabled()), 'Gravar habilita depois de editar texto');
  await grp0.locator('.tq-row.obj [data-abortar]').click();
  await page.waitForSelector('.tq-grp >> nth=0 >> text=abortado junto com o item principal');
  await page.click('#tq-gravar');
  await page.waitForSelector('.plan-t', { timeout: 30000 });
  const abortos = await page.locator('.plan-t tr:has-text("Abortado")').count();
  assert.ok(abortos >= 3, `abortar objetivo existente aborta KRs e KPIs (${abortos} linhas)`);
  await page.click('#p-cancel');
  await page.click('#tq-descartar', { force: true }).catch(() => {});
  page.once('dialog', (d) => d.accept());
  await page.click('#tq-descartar');
  ok('trimestral: texto de item existente habilita Gravar; abortar objetivo existente leva os filhos');
  await page.click('[data-page="board"]');
  await page.waitForSelector('.card');

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

  // Trimestral (leitor): rascunho local funciona, mas "Gravar no Notion" fica desabilitado
  await p2.click('[data-page="trimestral"]');
  await p2.waitForSelector('.tq-grp', { timeout: 15000 });
  await p2.locator('[data-dup][data-grau="Objetivo"]').first().click();
  await p2.waitForSelector('.tq-cell.q4.copy');
  assert.ok(await p2.locator('#tq-gravar').isDisabled(), 'leitor não grava');
  ok('trimestral (leitor): rascunho local, sem gravação');
  await p2.close();
  await leitor.app.close();

  if (erros.length) throw new Error(`erros no navegador:\n${erros.join('\n')}`);
  console.log(`\ne2e ok (${passos.length} fluxos)`);
} catch (e) {
  console.error(`\ne2e FALHOU: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  process.exit(process.exitCode ?? 0); // servidores abertos num teste que falhou não seguram o processo
}
