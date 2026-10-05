// Configuração por variáveis de ambiente (ver .env.example).
const list = (v) => String(v || '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

export function loadConfig(env = process.env) {
  const onCloudRun = !!env.K_SERVICE;
  return {
    port: Number(env.PORT || 8080),
    onCloudRun,
    notionMode: env.NOTION_MODE || 'live', // live | fixture
    notionToken: env.NOTION_TOKEN || '',
    authMode: env.AUTH_MODE || (onCloudRun ? 'iap' : 'dev'),
    devUserEmail: env.DEV_USER_EMAIL || 'dev@bsvrobotics.com.br',
    allowedDomain: env.ALLOWED_DOMAIN ?? 'bsvrobotics.com.br',
    // Quem grava no Notion. Em dev, sem lista, o usuário local grava.
    editorEmails: list(env.EDITOR_EMAILS).length ? list(env.EDITOR_EMAILS) : (onCloudRun ? [] : ['*']),
    cacheTtlMs: Number(env.CACHE_TTL_SECONDS || 120) * 1000,
    notionRatePerSec: Number(env.NOTION_RATE_PER_SEC || 3),
    logLevel: env.LOG_LEVEL || 'info',
    // IA (Gemini no Vertex AI): vertex | fake (respostas fixas, padrão no modo demonstração) | off
    iaMode: env.IA_MODE || ((env.NOTION_MODE || 'live') === 'fixture' ? 'fake' : 'vertex'),
    vertexProject: env.VERTEX_PROJECT || env.GOOGLE_CLOUD_PROJECT || '',
    vertexLocation: env.VERTEX_LOCATION || 'global',
    vertexModelTranscricao: env.VERTEX_MODEL_TRANSCRICAO || 'gemini-2.5-flash',
    vertexModelRevisao: env.VERTEX_MODEL_REVISAO || 'gemini-2.5-pro',
    iaLimitePor10Min: Number(env.IA_LIMITE_10MIN || 60),
  };
}
