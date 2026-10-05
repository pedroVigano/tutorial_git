// Estado da interface. Preferências de cada pessoa (objetivo ativo, modo, equipe, grupos recolhidos,
// largura da coluna, ordem dos cards, tema) ficam no localStorage deste navegador.
import { store } from './util.js';

const params = new URLSearchParams(location.search);
const saved = store.get('gt-state', {});

export const state = {
  page: params.get('pagina') || 'board',
  tv: params.get('modo') === 'tv',
  sprint: params.get('sprint') ? Number(params.get('sprint')) : null, // null = sprint em andamento
  tri: params.get('tri') || null,
  obj: saved.obj || 'all',
  modo: saved.modo || 'destacar',
  equipe: saved.equipe || 'todas',
  closed: new Set(saved.closed || []),
  left: saved.left || null,
  theme: saved.theme || 'auto',
  cols: saved.cols || {}, // larguras das colunas Árvore | Desejos das lanes (px)
  tvPin: !!saved.tvPin,
  equipeOp: saved.equipeOp || 'todas', // aba Operacional
  verComo: saved.verComo || null, // aba Eu: pessoa escolhida quando o login não casa com o Notion
  krFechados: new Set(), // KRs recolhidos na coluna OKR (só nesta sessão)
  linking: null,
  connect: null,
  drag: null,
  busy: false, // modal/plano aberto: não re-renderiza sozinho
};

export function persist() {
  const left = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--left'), 10) || null;
  store.set('gt-state', { obj: state.obj, modo: state.modo, equipe: state.equipe, closed: [...state.closed], left, theme: state.theme, cols: state.cols, tvPin: state.tvPin, equipeOp: state.equipeOp, verComo: state.verComo });
}

// Ordem dos cards por lane: preferência local (não vai para o Notion).
const orderKey = () => `gt-order-s${state.sprint}`;
export const order = {
  get: (lane) => (store.get(orderKey(), {})[lane] || []),
  set: (lane, ids) => { const o = store.get(orderKey(), {}); o[lane] = ids; store.set(orderKey(), o); },
  clear: () => store.set(orderKey(), {}),
};
