// O que o dashboard mostra mas não existe no Notion: cores e chaves curtas das equipes
// (paleta do mock v2.2, alinhada à marca BSV). Casamento pelo nome da área, sem acento e sem caixa.

const EQUIPES = [
  { key: 'sw', nomes: ['software'], c: '#2a78d6', cd: '#3987e5' },
  { key: 'el', nomes: ['eletronica'], c: '#eb6834', cd: '#d95926' },
  { key: 'me', nomes: ['mecanica'], c: '#1baf7a', cd: '#199e70' },
  { key: 'ag', nomes: ['agronomia'], c: '#4a3aa7', cd: '#9085e9' },
  { key: 'pr', nomes: ['produtos', 'produto'], c: '#e87ba4', cd: '#d55181' },
  { key: 'si', nomes: ['sistemas'], c: '#eda100', cd: '#c98500' },
  { key: 'pd', nomes: ['p&d', 'p&d (diretoria)', 'pesquisa e desenvolvimento'], c: '#6b7280', cd: '#9aa3b5' },
];

// Equipes fora de P&D: todas na mesma cor neutra (como no mock).
const OUTRAS = { c: '#5b6b8c', cd: '#8fa0c4' };

export const normName = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\p{L}\p{N}&()\s-]/gu, '')
  .trim().toLowerCase();

const slug = (s) => normName(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'area';

export function areaDisplay(nome, usados = new Set()) {
  const n = normName(nome);
  const known = EQUIPES.find((e) => e.nomes.includes(n));
  if (known && !usados.has(known.key)) return { key: known.key, c: known.c, cd: known.cd, ext: false };
  let key = slug(nome);
  while (usados.has(key)) key += '-x';
  return { key, ...OUTRAS, ext: true };
}

export const AREA_PD_KEY = 'pd';
