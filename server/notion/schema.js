// Único lugar do código com nomes do Notion. Conferido via MCP em 28/09/2026.
//
// Cada campo tem:
//   name      nome atual no Notion
//   id        (opcional) ID da propriedade — quando preenchido, o schema check casa por ID
//             e reporta "renomeado" se só o nome mudou. `npm run schema:check -- --ids` imprime os IDs.
//   type      tipo esperado
//   target    (relação) chave da base de destino
//   options   (status/select) opções que o app lê ou grava — o check confere se existem
//   aliases   nomes/opções antigos ou futuros aceitos (ex.: renomeação da Fase 4)
//   optional  campo ainda não criado no Notion (Fase 4) — o app usa se existir
//   grava     o app grava opções deste campo — opção ausente vira ERRO no schema check

export const BASES = {
  metas: {
    titulo: '🏁 Metas da Sprint',
    ds: '3268b1dc-5324-8023-a438-000bb62661ed',
    props: {
      titulo: { name: 'Meta', type: 'title' },
      status: { name: 'Status', type: 'status', options: ['Não iniciada', 'Em andamento', 'Concluído', 'Abortado'], grava: true },
      okr: { name: 'OKR', type: 'relation', target: 'okrs' },
      subsistema: { name: 'Subsistema', type: 'relation', target: 'projetos' },
      sprint: { name: '🏃 Sprint', type: 'relation', target: 'sprints' },
      area: { name: '🔼 Área', type: 'relation', target: 'areas' },
      bloqueadoPor: { name: 'Bloqueado por', type: 'relation', target: 'metas' },
      bloqueando: { name: 'Bloqueando', type: 'relation', target: 'metas' },
      // Fase 4, item 7 — ainda não existe
      sprintOrigem: { name: 'Sprint_de_origem', type: 'relation', target: 'sprints', optional: true },
    },
  },
  okrs: {
    titulo: '🎯 OKRs Táticos',
    ds: '25a8b1dc-5324-81cb-bf8d-000b8c9e6ea5',
    props: {
      titulo: { name: 'Descrição', type: 'title' },
      grau: { name: 'Grau', type: 'select', options: ['Objetivo', 'Resultado-Chave', 'KPI'] },
      pai: { name: 'item principal', type: 'relation', target: 'okrs' },
      filhos: { name: 'Subitem', type: 'relation', target: 'okrs' },
      alvo: { name: 'Alvo', type: 'number' },
      unidade: { name: 'Unidade', type: 'select' },
      direcao: { name: 'Direção', type: 'select', options: ['=', '≥', '≤'] },
      limite: { name: 'Data Limite', type: 'date' },
      trimestre: { name: 'Trimestre', type: 'multi_select' },
      status: { name: 'Status', type: 'status', options: ['Não iniciado', 'Em andamento', 'Abortado', 'Atingido', 'Atingido Parcialmente', 'Não atingido'], grava: true },
      area: { name: '🔼 Área', type: 'relation', target: 'areas' },
      projetos: { name: '🤖 Projetos', type: 'relation', target: 'projetos' },
      ordem: { name: 'Ordem', type: 'number' },
      // item do trimestre anterior do qual este foi duplicado (criado em 02/10/2026)
      origem: { name: 'Origem', type: 'relation', target: 'okrs' },
      // Fase 4, item 8 — ainda não existe
      responsavel: { name: 'Responsável pelo OKR', type: 'people', optional: true },
    },
  },
  medicoes: {
    titulo: '📈 Evolução de KPIs',
    ds: '0c88f68c-70f5-4a57-b269-07ec6e0e559d',
    props: {
      titulo: { name: 'ID (KPI + Sprint)', type: 'title' },
      kpi: { name: 'KPI', type: 'relation', target: 'okrs' },
      sprint: { name: 'Sprint', type: 'relation', target: 'sprints' },
      valor: { name: 'Valor', type: 'number' },
      data: { name: 'Data da medição', type: 'date' },
    },
  },
  projetos: {
    titulo: '🤖 Projetos, Sistemas e Subsistemas',
    ds: '2528b1dc-5324-8050-bb07-000b7303b183',
    props: {
      titulo: { name: 'Nome', type: 'title' },
      tipo: { name: 'Tipo', type: 'select', options: ['Projeto', 'Sistema', 'Subsistema', 'Processo'] },
      pai: { name: 'item principal', type: 'relation', target: 'projetos' },
      filhos: { name: 'Subitem', type: 'relation', target: 'projetos' },
      responsavel: { name: 'Responsável', type: 'people' },
      status: { name: 'Status', type: 'status' },
      area: { name: '🔼 Área', type: 'relation', target: 'areas' },
      // código do item (ex.: "2.1.3"), ordena projetos, sistemas e subsistemas no board
      codigo: { name: 'ID', type: 'rich_text' },
    },
  },
  sprints: {
    titulo: '🏃 Sprints',
    ds: '2548b1dc-5324-80de-815c-000be663dd8a',
    props: {
      titulo: { name: 'Nome', type: 'title' },
      numero: { name: 'Número', type: 'number' },
      data: { name: 'Data', type: 'date' },
      status: { name: 'Status', type: 'status', options: ['Não iniciada', 'Em andamento', 'Concluído'], grava: true },
    },
  },
  tarefas: {
    titulo: '✅ Lista de Tarefas',
    ds: '1ae8b1dc-5324-8175-a5fc-000b520efe30',
    props: {
      titulo: { name: 'Tarefa', type: 'title' },
      // Fase 4, item 4: "Fazendo" será renomeado para "Em Andamento"
      status: {
        name: 'Status', type: 'status',
        options: ['A Fazer', 'Fazendo', 'Em Revisão', 'Concluída', 'Bloqueada', 'Abortada'],
        aliases: { Fazendo: 'Em Andamento' },
      },
      sprint: { name: 'Sprint', type: 'relation', target: 'sprints' },
      meta: { name: '🏁 Metas da Sprint', type: 'relation', target: 'metas' },
      subsistema: { name: 'Subsistema', type: 'relation', target: 'projetos' },
      responsavel: { name: 'Responsável', type: 'people' },
    },
  },
  areas: {
    titulo: '🔼 Diretorias e Áreas Funcionais',
    ds: '962cc779-a04d-44a6-9a7f-6e2d0a8d415a',
    props: {
      titulo: { name: 'Área', type: 'title' },
      nivel: { name: 'Nível', type: 'select' },
      diretoria: { name: 'Diretoria', type: 'select' },
      pai: { name: 'item principal', type: 'relation', target: 'areas' },
      lider: { name: 'Líder', type: 'people' },
    },
  },
  desejos: {
    titulo: '📜 Desejos e Expectativas',
    ds: '3068b1dc-5324-8044-aa2b-000b2191b4b6',
    props: {
      titulo: { name: 'Desejo', type: 'title' },
      status: { name: 'Status', type: 'status', options: ['Em aberto', 'Em análise', 'Descartado', 'Arquivado', 'Encaminhado'] },
      projetos: { name: 'Projetos', type: 'relation', target: 'projetos' },
      stakeholder: { name: 'Stakeholder', type: 'multi_select' },
      evidencia: { name: 'Evidência', type: 'select' },
      motivacao: { name: 'Motivação', type: 'rich_text' },
    },
  },
  requisitos: {
    titulo: '📋 Requisitos',
    ds: '3598b1dc-5324-80e3-b877-000b8149b1c5',
    props: {
      titulo: { name: 'Requisito + critério', type: 'title' },
      status: { name: 'Status de aprovação', type: 'status' },
      subsistemas: { name: 'Sistemas e Subsistemas', type: 'relation', target: 'projetos' },
    },
  },
};

// Diretoria cujos objetivos, projetos e equipes o dashboard mostra.
export const DIRETORIA = 'P&D';

// Tipos da árvore que saíram do modelo (contexto §3) mas ainda existem no Notion até a documentação migrar:
// não viram lane; metas e desejos ligados a eles aparecem no item pai (a relação no Notion não muda).
export const TIPOS_OCULTOS = ['Entregável-Chave'];

// Seções das páginas usadas pela skill gestao-sprint-notion (mesmos títulos).
export const SECOES = {
  criterio: 'Critério de conclusão',
  origem: 'Origem',
  historico: 'Histórico de sprints',
  decisaoTatica: 'Decisão da reunião tática',
};

export const spec = (base, key) => {
  const b = BASES[base];
  if (!b) throw new Error(`base desconhecida: ${base}`);
  const p = b.props[key];
  if (!p) throw new Error(`campo desconhecido: ${base}.${key}`);
  return p;
};

// Resultado do schema check aplicado em tempo de execução: nomes atualizados (casados por ID),
// campos opcionais ausentes marcados como indisponíveis.
export function applyResolution(resolution) {
  for (const [base, props] of Object.entries(resolution || {})) {
    for (const [key, r] of Object.entries(props)) {
      const p = BASES[base]?.props[key];
      if (!p) continue;
      if (r.name) p.name = r.name;
      if (r.id) p.id = r.id;
      p.missing = !!r.missing;
      p.present = !r.missing;
    }
  }
}

// Campo utilizável? Os opcionais (Fase 4) só contam depois que o schema check confirmou que existem.
export const has = (base, key) => {
  const s = spec(base, key);
  return s.optional ? !!s.present : !s.missing;
};
