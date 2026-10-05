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

// microfone falso (tom de teste) para a gravação da reunião, sem pedir permissão
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const erros = [];
const passos = [];
const ok = (m) => { passos.push(m); console.log(`  ✓ ${m}`); };

// Abre a revisão do rascunho (se ainda não está aberta) e espera o plano lido do Notion.
async function revisar(page) {
  if (await page.locator('#review').isHidden()) await page.click('#rascunho-btn');
  await page.waitForSelector('#review .rv-plan .plan-t, #review .plan-bloq', { timeout: 30000 });
}
// Revisão → Gravar no Notion → fechar e atualizar.
async function gravar(page) {
  await revisar(page);
  const bloq = await page.$('#review .plan-bloq');
  if (bloq) throw new Error(`plano bloqueado: ${await bloq.innerText()}`);
  await page.click('#rv-gravar');
  await page.waitForSelector('#review .plan-ok, #review .plan-err', { timeout: 30000 });
  const err = await page.$('#review .plan-err');
  if (err) throw new Error(`gravação falhou: ${await err.innerText()}`);
  await page.click('#rv-fim');
  await page.waitForFunction(() => document.getElementById('review').hidden);
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
  await page.waitForSelector('.card.pend:has-text("Testar fluxo de ponta a ponta do dashboard")');
  assert.match(await page.innerText('#rascunho-btn'), /1/, 'rascunho com 1 alteração');
  await revisar(page);
  const linhas = await page.locator('#review .plan-t tr').count();
  assert.ok(linhas >= 7, 'revisão da nova meta tem uma linha por campo');
  await gravar(page);
  await page.waitForSelector('.card:not(.pend):has-text("Testar fluxo de ponta a ponta do dashboard")');
  ok('nova meta: rascunho → revisão → gravar → card aparece');

  // 2. dependência por clique (drawer → ligar → clicar na bloqueada)
  const cards = page.locator('#lanes .card');
  const titulo0 = (await cards.nth(0).locator('.tt').innerText()).trim();
  await cards.nth(0).click();
  await page.click('#d-link');
  await cards.nth(3).click();
  await page.waitForSelector('#arrows path.pend');
  await revisar(page);
  assert.match(await page.locator('#review .plan-t').first().innerText(), /Bloqueado por/);
  await gravar(page);
  const setas = await page.locator('#arrows path[data-edge]').count();
  assert.ok(setas >= 1, 'seta de dependência desenhada');
  ok(`dependência: "${titulo0.slice(0, 30)}…" bloqueia outra meta, seta desenhada`);

  // 3. arrastar card para outra lane → plano com remoção explícita
  const origem = page.locator('.lane[data-lane]:has(.card) .card').first();
  const tituloMov = (await origem.locator('.tt').innerText()).trim();
  const destino = page.locator('.lane[data-lane]:not(:has(.card)) .cards.drop').first();
  await origem.dragTo(destino);
  await page.waitForSelector('.card.pend');
  await revisar(page);
  assert.equal(await page.locator('#review .plan-t tr.rem').count(), 1, 'remoção do subsistema antigo aparece como linha própria');
  await gravar(page);
  ok(`mover de subsistema: "${tituloMov.slice(0, 30)}…" com remoção explícita no plano`);

  // 4. medição de KPI pela coluna OKR
  await page.click('.chip:nth-of-type(2)');
  await page.locator('[data-kpi]').first().click();
  await page.fill('#k-v', '1');
  await page.click('#modal-form button[type=submit]');
  await gravar(page);
  ok('medição de KPI gravada');

  // gráfico de KR: legenda liga/desliga o KPI (fica no navegador) e o tooltip mostra o valor real por sprint
  const kc = () => page.locator('.kc:has(svg.kchart)').first();
  await kc().locator('.kl-t').first().click();
  assert.equal(await kc().locator('.kl.off').count(), 1, 'KPI desligado na legenda');
  await kc().locator('.kl-t').first().click();
  assert.equal(await kc().locator('.kl.off').count(), 0, 'KPI religado');
  const graf = await kc().locator('svg.kchart').boundingBox();
  await page.mouse.move(graf.x + graf.width * 0.9, graf.y + graf.height / 2);
  await page.waitForSelector('.kc-tip:not([hidden])');
  assert.match(await page.innerText('.kc-tip:not([hidden])'), /Sprint #\d+/);
  ok('gráfico de KR: legenda liga/desliga KPI, tooltip com valores');

  // árvore: lane própria para sistemas; recolher um sistema leva as setas para o cabeçalho dele
  await page.click('.chip:nth-of-type(1)');
  assert.ok(await page.locator('.lane.pai:not(.raiz)').count() > 0, 'sistemas com filhos têm lane própria');
  await page.locator('.lane.pai:not(.raiz) .tcar').first().click();
  await page.waitForSelector('.lane.fechada');
  await page.waitForSelector('#arrows path[data-grupo]');
  await page.locator('#arrows path[data-grupo]').first().dispatchEvent('click');
  await page.waitForFunction(() => !document.querySelector('.lane.fechada'));
  await page.click('#org-setas');
  assert.ok(await page.locator('#arrows path[data-de]').count() >= 1, 'setas redesenhadas depois de organizar');
  ok('árvore: sistema recolhido recebe a seta (×N) e expande no clique; organizar setas');

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
  await revisar(page);
  assert.match(await page.locator('#review .rv-plan').innerText(), /criar página/);
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
  await revisar(page);
  const abortos = await page.locator('#review .plan-t tr:has-text("Abortado")').count();
  assert.ok(abortos >= 3, `abortar objetivo existente aborta KRs e KPIs (${abortos} linhas)`);
  await page.click('#rv-fechar');
  await page.click('#tq-descartar', { force: true }).catch(() => {});
  page.once('dialog', (d) => d.accept());
  await page.click('#tq-descartar');
  ok('trimestral: texto de item existente habilita Gravar; abortar objetivo existente leva os filhos');
  await page.click('[data-page="board"]');
  await page.waitForSelector('.card');

  // Operacional: arrastar tarefa de coluna, tarefa nova numa meta, registrar discussão na página da meta
  await page.click('[data-page="operacional"]');
  await page.waitForSelector('#page-operacional .kanban');
  const tcard = page.locator('#page-operacional .kcol[data-status="A Fazer"] .tcard').first();
  const tTitulo = (await tcard.locator('.tt').innerText()).trim();
  await tcard.dragTo(tcard.locator('xpath=ancestor::div[contains(@class,"kanban")]').locator('.kcol[data-status="Em Andamento"]'));
  await page.waitForSelector(`#page-operacional .kcol[data-status="Em Andamento"] .tcard.pend:has-text("${tTitulo.slice(0, 30)}")`);
  const secMeta = page.locator('#page-operacional .op-meta:has(.kcol[data-status="A Fazer"] .add)').first();
  await secMeta.locator('[data-t-novo]').click();
  await page.fill('#tf-t', 'Medir consumo do protótipo em bancada');
  await page.click('#modal-form button[type=submit]');
  await page.waitForSelector('#page-operacional .tcard.pend:has-text("Medir consumo do protótipo")');
  await page.locator('#page-operacional [data-reg-meta]').first().click();
  await page.fill('#rg-d', 'Discutimos o atraso do fornecedor e o plano B.');
  await page.click('#modal-form button[type=submit]');
  await revisar(page);
  const txtRev = await page.locator('#review .rv-plan').innerText();
  assert.match(txtRev, /Em Andamento/, 'mudança de status da tarefa na revisão');
  assert.match(txtRev, /Medir consumo do protótipo/, 'tarefa nova na revisão');
  assert.match(txtRev, /Registro de reuniões/, 'registro na página da meta');
  await gravar(page);
  await page.waitForSelector(`#page-operacional .kcol[data-status="Em Andamento"] .tcard:not(.pend):has-text("${tTitulo.slice(0, 30)}")`);
  await page.waitForSelector('#page-operacional .tcard:not(.pend):has-text("Medir consumo do protótipo")');
  ok('operacional: tarefa arrastada de coluna, tarefa nova e discussão registrada — revisão e gravação');

  // Eu: a pessoa do Notion com o e-mail do login (demo: dev@) e as tarefas dela
  await page.click('[data-page="eu"]');
  await page.waitForSelector('#page-eu .kanban');
  assert.match(await page.innerText('#page-eu .page-h'), /\(você\)/);
  assert.ok(await page.locator('#page-eu .eu-sec').first().locator('.tcard').count() > 0, 'minhas tarefas');
  assert.ok(await page.locator('#page-eu .eu-no').count() > 0, 'itens da árvore de que sou responsável');
  ok('eu: login casado com a pessoa do Notion, minhas tarefas e meus itens da árvore');
  await page.click('[data-page="board"]');
  await page.waitForSelector('.card');

  // rascunho: meta nova + dependência + mover a meta nova = 2 itens (o mover entra na criação); excluir um
  // item replaneja; o rascunho sobrevive ao recarregar; descartar limpa
  await page.click('.chip:nth-of-type(1)');
  await page.locator('.lane[data-lane]:has(.card)').nth(1).locator('[data-add]').click();
  await page.fill('#f-t', 'Validar consolidação do rascunho');
  await page.click('#modal-form button[type=submit]');
  const nova = page.locator('.card.pend:has-text("Validar consolidação do rascunho")');
  await nova.click();
  await page.click('#d-link');
  await page.locator('#lanes .card:not(.pend)').first().click();
  await page.waitForSelector('#arrows path.pend');
  await page.locator('.card.pend:has-text("Validar consolidação do rascunho")').dragTo(page.locator('.lane[data-lane]:not(:has(.card)) .cards.drop').first());
  await page.waitForTimeout(300);
  assert.match(await page.innerText('#rascunho-btn'), /\b2\b/, 'criação + dependência; o mover entrou na criação');
  await revisar(page);
  assert.equal(await page.locator('#review .rv-item').count(), 2);
  await page.locator('#review [data-inc]').nth(1).uncheck();
  await page.waitForSelector('#review .rv-item.fora');
  await page.waitForSelector('#review .rv-plan .plan-t');
  assert.ok(!(await page.locator('#review .rv-plan').innerText()).includes('Bloqueado por'), 'item excluído sai do plano');
  await page.locator('#review .rv-com summary').first().click();
  await page.locator('#review textarea[data-com]').first().fill('Conferir com a equipe antes');
  await page.locator('#review [data-com-add]').first().click();
  await page.click('#rv-fechar');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.card.pend:has-text("Validar consolidação do rascunho")');
  assert.match(await page.innerText('#rascunho-btn'), /\b2\b/, 'rascunho sobrevive ao recarregar');
  await revisar(page);
  assert.match(await page.locator('#review .rv-lista').innerText(), /Conferir com a equipe antes/);
  page.once('dialog', (d) => d.accept());
  await page.click('#rv-descartar');
  await page.waitForFunction(() => !document.querySelector('#review .rv-item'));
  await page.click('#rv-fechar');
  assert.equal(await page.locator('.card.pend').count(), 0, 'descartar limpa o rascunho');
  ok('rascunho: consolida ações, exclui item, comenta, sobrevive ao recarregar, descarta');

  // IA (modo demonstração): gravar → transcrição → ata + registros + sugestões no rascunho → aprimorar → gravar
  await page.click('#reuniao-btn');
  await page.waitForSelector('#reuniao-panel.open #gv-rec');
  await page.click('#mt-limpar');
  await page.click('#gv-rec');
  await page.waitForSelector('#gv-stop');
  await page.waitForTimeout(2500);
  assert.match(await page.innerText('#reuniao-btn'), /00:00:0\d/, 'tempo de gravação no cabeçalho');
  await page.click('#gv-stop');
  await page.waitForFunction(() => /demonstração/.test(document.getElementById('mt-txt').value), null, { timeout: 15000 });
  await page.fill('#mt-txt', `${await page.inputValue('#mt-txt')}\nDecidimos testar a bancada amanhã e medir o consumo.`);
  await page.click('#mt-ata');
  await page.waitForSelector('#review:not([hidden])', { timeout: 30000 }); // a revisão abre sozinha depois da ata
  await revisar(page);
  const nItens = await page.locator('#review .rv-item').count();
  assert.ok(nItens >= 3, `ata + registro(s) + sugestão(ões) (${nItens})`);
  assert.ok(await page.locator('#review .rv-item.fora').count() >= 1, 'sugestões da IA entram desmarcadas');
  assert.match(await page.locator('#review .rv-plan').innerText(), /Reuniões/);
  await page.click('#rv-ia');
  await page.waitForSelector('#review .rv-com summary:has-text("1 comentário")', { timeout: 15000 });
  await gravar(page);
  ok('IA: gravar → transcrição → ata, registros e sugestões no rascunho → aprimorar → gravar');

  // documentar com IA (lane de subsistema da Tática)
  await page.locator('#lanes [data-doc]').first().click();
  await page.waitForSelector('#review:not([hidden])', { timeout: 30000 });
  await revisar(page);
  assert.match(await page.locator('#review .rv-plan').innerText(), /Desenvolvimento/);
  await gravar(page);
  ok('IA: documentar subsistema → acréscimo em "6. Desenvolvimento" pela revisão');

  // 5. abortar (nada é apagado)
  await page.click('.chip:nth-of-type(1)');
  await page.locator('#lanes .card').nth(1).click();
  await page.click('#d-abort');
  await revisar(page);
  assert.match(await page.locator('#review .plan-avisos').innerText(), /Nada é apagado/);
  await gravar(page);
  ok('abortar meta (status Abortado)');

  // 6. rollover
  await page.click('[data-page="rollover"]');
  await page.waitForSelector('#r-go');
  await page.locator('.r-k').first().fill('2');
  await page.click('#r-go');
  await revisar(page);
  const passosRoll = await page.locator('#review .plan-t td.mono').allInnerTexts();
  for (const p of ['R1', 'R2', 'R4', 'R6']) assert.ok(passosRoll.some((t) => t.trim() === p), `plano do rollover tem ${p}`);
  await gravar(page);
  await page.waitForFunction(() => [...document.querySelectorAll('#sel-sprint option')].some((o) => o.value === '28'));
  assert.equal(await page.inputValue('#sel-sprint'), '28', 'a #28 vira a sprint em andamento');
  ok('rollover #27 → #28: sprint criada, metas revinculadas, #28 em andamento');
  await page.close();
  await app.close();

  // ---------------- modo TV: cabeçalho recolhido, edição continua ----------------
  const tv = await start({});
  const p3 = await browser.newPage({ viewport: { width: 1600, height: 1000 }, ignoreHTTPSErrors: true });
  p3.on('pageerror', (e) => erros.push(e.message));
  await p3.goto(`${tv.url}/?modo=tv`, { waitUntil: 'networkidle' });
  await p3.waitForSelector('.card');
  assert.ok((await p3.locator('header.top').boundingBox()).height < 30, 'cabeçalho recolhido no modo TV');
  assert.ok(await p3.locator('[data-add]').count() > 0, 'modo TV mantém a edição');
  assert.match(await p3.textContent('#user-chip'), /edição/);
  await p3.hover('header.top');
  assert.ok((await p3.locator('header.top').boundingBox()).height > 40, 'cabeçalho abre ao passar o mouse');
  // painel Reunião em qualquer aba
  await p3.click('#reuniao-btn');
  await p3.waitForSelector('#reuniao-panel.open');
  await p3.fill('#mt-txt', 'Decidimos priorizar o O2 nesta sprint.');
  assert.match(await p3.textContent('#mt-prev'), /priorizar o O2/);
  await p3.keyboard.press('Escape');
  await p3.waitForFunction(() => !document.getElementById('reuniao-panel').classList.contains('open'));
  // largura da coluna de desejos: arrastar a alça
  const alca = p3.locator('.col-rs[data-col="wish"]').first();
  const bx = await alca.boundingBox();
  await p3.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2);
  await p3.mouse.down();
  await p3.mouse.move(bx.x + 120, bx.y + bx.height / 2, { steps: 4 });
  await p3.mouse.up();
  assert.ok(await p3.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wish-w').trim() !== ''), 'largura da coluna de desejos ajustada');
  ok('modo TV: cabeçalho recolhido com edição; painel Reunião; largura de coluna ajustável');
  await p3.close();
  await tv.app.close();

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
