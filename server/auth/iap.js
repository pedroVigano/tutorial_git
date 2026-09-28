// Identidade do usuário.
// Produção (AUTH_MODE=iap): o IAP do Cloud Run coloca o JWT assinado em X-Goog-IAP-JWT-Assertion.
// Validamos assinatura (chaves públicas do Google, com cache), emissor, audiência e usamos a claim
// `email` — nunca o header em texto puro. Local (AUTH_MODE=dev): usuário fixo, recusado no Cloud Run.
import { createRemoteJWKSet, jwtVerify, decodeJwt } from 'jose';

const IAP_ISSUER = 'https://cloud.google.com/iap';
const IAP_JWKS_URL = 'https://www.gstatic.com/iap/verify/public_key-jwk';
const METADATA = 'http://metadata.google.internal/computeMetadata/v1';

export class AuthError extends Error {
  constructor(message, statusCode = 401) { super(message); this.statusCode = statusCode; }
}

async function metadata(path, fetchImpl) {
  const r = await fetchImpl(`${METADATA}/${path}`, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!r.ok) throw new Error(`metadata ${path}: HTTP ${r.status}`);
  return (await r.text()).trim();
}

// Audiência do IAP direto no Cloud Run: /projects/NUM/locations/REGIÃO/services/SERVIÇO
export async function discoverAudience({ env = process.env, fetchImpl = fetch } = {}) {
  if (env.IAP_AUDIENCE) return env.IAP_AUDIENCE;
  const service = env.K_SERVICE;
  if (!service) throw new Error('IAP_AUDIENCE não definido e K_SERVICE ausente (fora do Cloud Run)');
  const num = await metadata('project/numeric-project-id', fetchImpl);
  const region = (await metadata('instance/region', fetchImpl)).split('/').pop();
  return `/projects/${num}/locations/${region}/services/${service}`;
}

export function createAuth({ config, jwks, audience: fixedAudience, fetchImpl = fetch, log = () => {} }) {
  const mode = config.authMode;
  if (mode === 'dev' && config.onCloudRun) {
    throw new Error('AUTH_MODE=dev não é permitido no Cloud Run (K_SERVICE definido). Use AUTH_MODE=iap.');
  }
  if (!['dev', 'iap'].includes(mode)) throw new Error(`AUTH_MODE inválido: ${mode}`);

  const keySet = jwks || (mode === 'iap' ? createRemoteJWKSet(new URL(IAP_JWKS_URL), { cacheMaxAge: 60 * 60_000 }) : null);
  let audiencePromise = fixedAudience ? Promise.resolve(fixedAudience) : null;
  const audience = () => {
    if (!audiencePromise) audiencePromise = discoverAudience({ fetchImpl }).catch((e) => { audiencePromise = null; throw e; });
    return audiencePromise;
  };
  const editors = new Set(config.editorEmails.map((e) => e.toLowerCase()));
  const domain = config.allowedDomain.toLowerCase();

  const withRole = (email) => {
    const e = email.toLowerCase();
    if (domain && !e.endsWith(`@${domain}`)) throw new AuthError(`Conta ${email} fora do domínio ${domain}.`, 403);
    return { email: e, podeGravar: editors.has(e) || editors.has('*') };
  };

  return {
    mode,
    async identify(headers) {
      if (mode === 'dev') return { ...withRole(config.devUserEmail), dev: true };
      const token = headers['x-goog-iap-jwt-assertion'];
      if (!token) throw new AuthError('Requisição sem o JWT do IAP.');
      let payload;
      const aud = await audience();
      try {
        ({ payload } = await jwtVerify(token, keySet, { issuer: IAP_ISSUER, audience: aud, algorithms: ['ES256'] }));
      } catch (e) {
        if (e.claim === 'aud') {
          // Diagnóstico de implantação: mostra a audiência que o IAP está mandando (o token não é aceito).
          let recebida = '?';
          try { recebida = JSON.stringify(decodeJwt(token).aud); } catch { /* token ilegível */ }
          log({ message: 'iap.audiencia_divergente', esperada: aud, recebida, dica: 'confira o serviço/região ou defina IAP_AUDIENCE com o valor recebido' });
        }
        throw new AuthError(`JWT do IAP inválido: ${e.code || e.message}`);
      }
      if (!payload.email) throw new AuthError('JWT do IAP sem e-mail.');
      return withRole(payload.email);
    },
  };
}
