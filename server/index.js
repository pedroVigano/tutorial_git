// Ponto de entrada: `npm start` (Cloud Run) ou `npm run dev` (local, modo fixture).
import { loadConfig } from './config.js';
import { buildApp } from './app.js';

const config = loadConfig();
const app = await buildApp({ config });

const shutdown = async (sig) => { app.log.info(`${sig} recebido, encerrando`); await app.close(); process.exit(0); };
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info({ modo: config.notionMode, auth: config.authMode }, `Dashboard tático em http://localhost:${config.port}`);
