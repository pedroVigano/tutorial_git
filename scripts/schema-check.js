// Confere o schema do Notion contra server/notion/schema.js ("verificar antes de afirmar").
// Uso: npm run schema:check            (lê NOTION_TOKEN do .env ou do ambiente)
//      npm run schema:check -- --ids   (também imprime os IDs das propriedades, para fixar em schema.js)
// Sai com código 1 se houver ERRO.
import { createSdkClient, createApi } from '../server/notion/client.js';
import { createFakeNotion } from '../server/notion/fake.js';
import { noLimiter } from '../server/notion/limiter.js';
import { checkSchema, formatReport } from '../server/notion/schema-check.js';

const fixture = process.env.NOTION_MODE === 'fixture';
if (!fixture && !process.env.NOTION_TOKEN) {
  console.error('Defina NOTION_TOKEN (no .env ou no ambiente) — ou NOTION_MODE=fixture para conferir o Notion falso.');
  process.exit(2);
}
const client = fixture ? createFakeNotion().client : createSdkClient(process.env.NOTION_TOKEN);
const api = createApi(client, fixture ? { limiter: noLimiter } : {});
const r = await checkSchema(api);
console.log(formatReport(r));
if (process.argv.includes('--ids')) {
  console.log('\nIDs das propriedades (para o campo `id` em server/notion/schema.js):');
  for (const [base, props] of Object.entries(r.resolution)) {
    for (const [key, v] of Object.entries(props)) if (v.id) console.log(`  ${base}.${key}: '${v.id}'  // ${v.name}`);
  }
}
process.exit(r.ok ? 0 : 1);
