# Contexto — Reestruturação da Gestão da Sprint (BSV Robótica)
 
Documento de contexto para dar sequência ao trabalho iniciado em ago/2026. Versão de 09/09/2026 (noite), com adendo de 11/09 — substitui a anterior. Resume a lógica geral, as fontes de dados e como se conectam, os princípios de trabalho e o estado atual. Não detalha cada alteração — os detalhes vivem nos artefatos listados abaixo.
 
## 1. O objetivo e o encadeamento das ferramentas
 
A BSV está reestruturando seu processo de gestão da sprint de P&D. O trabalho segue um pipeline deliberado, em que cada ferramenta tem um papel:
 
**Miro → Lucid → Notion → Dashboards HTML**
 
- **Miro** foi o rascunho: o board https://miro.com/app/board/uXjVH5oMpUM=/ contém o desenho original (processo macro, subprocessos, objetivos e dores das reuniões). É material histórico — não é mais editado.
- **Lucid** é a formalização e a fonte da verdade do desenho-alvo: documento **"Gestão da Sprint — BSV Robótica"** (`documentId c0d89424-e782-4fd6-a2b6-07a3bbdcf52d`), 11 páginas: 1 Visão Geral (`pg1`) · 2 Processo macro (`pg2`, BPMN, ciclo fechado: Início → Planejamento Tático → Planejamento Operacional → Acompanhamento Operacional → Fim da Sprint → gateway paralelo [Rollover · Atualizar OKRs e KPIs · Atualizar Projetos e Subsistemas] → Preencher Slides da Retrospectiva (líder) → Reunião de Retrospectiva da Sprint) · 3 Planejamento Tático (`pg4`) · 4 Planejamento Operacional (`pg5`) · 5 Acompanhamento Operacional (`ffzoSF8sRgDP`) · 6 Subprocesso Revisão de Tarefa (`5izo4uyb~ITc`) · 7 Atualização de OKRs e KPIs (`pg3`) · 8 Atualização de Projetos e Subsistemas (`zdzoljX4EgCw`) · 9 Rollover da Sprint (`WrzoCz1cbRe.`) · 10 Modelo Relacional (ERD, `pg6`) · 11 Visualizações (`qcRsHIuUwOlW`, criada pelo usuário na UI em 09/09 e preenchida via API).
- **Notion** é a ferramenta operacional onde o modelo está sendo implementado (Fase 4, parcialmente executada — ver §6).
- **Dashboards HTML** virão por último (Fase 5), quando o modelo estiver estável — foco nº 1: série temporal de KPIs por sprint, a maior dor registrada no Miro.
Artefatos complementares:
- **Plano de ação** (artifact https://claude.ai/code/artifact/700af035-54e4-4ffa-8cff-468d42389eea): fases, decisões registradas e adendo de 31/08, que prevalece sobre o corpo do texto.
- **Comentários do Lucid** (`claude/comentarios-lucid-2026-09-09.md`): as 14 threads do usuário, o mapeamento página → thread e o que cada uma gerou no desenho. Todas foram aplicadas em 09/09 e respondidas na própria thread ("Aplicado (09/09): …"); o fechamento das threads é feito na UI.
- **Plano de alterações de 09/09** (`claude/plano-alteracoes-lucid-2026-09-09.md`): o plano revisado pelo usuário antes da execução, com as decisões D1–D5.
- **Slides da retrospectiva de 11/09** (`claude/plano-slides-retrospectiva-2026-09-11.md`): estrutura do deck apresentado à empresa, as 9 dores na formulação do usuário, decisões da rodada e as pendências que a apresentação gerou para o desenho.
## 2. As fontes de dados no Notion (verificadas via MCP em 08–09/09)
 
O modelo relacional real foi levantado lendo os schemas de cada data source, nunca de memória. Nomes abaixo são os títulos atuais das bases (vários mudaram desde agosto). Em 09/09 as colunas "Bases do Notion manipuladas" de todas as páginas do Lucid passaram a usar estes nomes.
 
| Base | Página | Collection ID |
|---|---|---|
| 🎯 OKRs Táticos (Objetivo/RC/KPI na mesma tabela, campo `Grau`, auto-relação; **sem campo de responsável** — a criar) | app.notion.com/p/25a8b1dc5324800f9d06e45505ba8890 | `25a8b1dc-5324-81cb-bf8d-000b8c9e6ea5` |
| 📈 Evolução de KPIs (série temporal KPI × Sprint × Valor; antes "Medições de KPI") | app.notion.com/p/8072693ce8c840e5b87d2815590bd484 | `0c88f68c-70f5-4a57-b269-07ec6e0e559d` |
| Itens de KR — Estruturação dos experimentos (checklist; relação de ida para OKRs; fora do ERD) | app.notion.com/p/edcbcd729b98478fa5f7efa22fa52037 | `377167cb-a560-4bdb-9428-115b8f98bfed` |
| 🤖 Projetos, Sistemas e Subsistemas (árvore via `Tipo` + auto-relação; antes "Projetos e Entregáveis") | app.notion.com/p/2528b1dc5324808b9e12f4bc1b2757f0 | `2528b1dc-5324-8050-bb07-000b7303b183` |
| 🏁 Metas da Sprint (**já tem** `Bloqueado por` / `Bloqueando`, relação self) | app.notion.com/p/3268b1dc532480ce8f27e3dbd2b3f678 | `3268b1dc-5324-8023-a438-000bb62661ed` |
| 🏃 Sprints (guarda a retrospectiva — campo `Retrospectiva`) | app.notion.com/p/2548b1dc5324800598dfd70c13cf9cba | `2548b1dc-5324-80de-815c-000be663dd8a` |
| ✅ Lista de Tarefas | app.notion.com/p/1ae8b1dc532480ca86beeeed189781df | `1ae8b1dc-5324-8175-a5fc-000b520efe30` |
| 🔼 Diretorias e Áreas Funcionais (auto-relação, campo `Nível`) | app.notion.com/p/1748b1dc5324804391fbebf7f4a368b4 | `962cc779-a04d-44a6-9a7f-6e2d0a8d415a` |
| 📋 Requisitos (TRL 3–7, status de aprovação; antes "Requisitos de projeto") | app.notion.com/p/3598b1dc532480d287adfd4495291a7a | `3598b1dc-5324-80e3-b877-000b8149b1c5` |
| 📜 Desejos e Expectativas (criada na Fase 4) | app.notion.com/p/3068b1dc5324802fb9f1faa68cb023e4 | `3068b1dc-5324-8044-aa2b-000b2191b4b6` |
 
Contagens de agosto (47/229 metas com KR, 40 metas multi-área, 83/84 requisitos ligados a entregáveis, Medições com 1 registro) são anteriores à migração e não foram remedidas — não usar como estado atual.
 
## 3. O modelo-alvo (estado após o adendo de 31/08, a Fase 4 parcial e os comentários de 09/09)
 
- **Árvore de projetos**: Projeto → Sistema → Subsistema (o nível Entregável-Chave FOI REMOVIDO do modelo; o tipo `Processo` permanece para trabalho não-produto). Itens hoje com Tipo = Entregável-Chave precisam de triagem: absorvidos pelo subsistema pai ou promovidos a Subsistema.
- **Responsável do projeto/subsistema**: campo `Responsável` (person, máx 1) da base Projetos, em qualquer nível da árvore. No subsistema, é quem executa a Revisão de Tarefa; no projeto, é quem associa um Desejo aos subsistemas.
- **Responsável pelo OKR** (papel novo, 09/09): quem registra o valor dos KPIs na sprint — não o líder de equipe. Campo `Responsável pelo OKR` (person) a criar na base OKRs Táticos.
- **Meta da Sprint** liga a: um ou mais Objetivos (campo `OKR`), um ou mais Subsistemas, **uma única** Área Funcional (meta que tange duas equipes vira duas metas) e a outras metas por `Bloqueado por / Bloqueando` (substitui a numeração de dependências; campos já existem).
- **Tarefa**: status A Fazer → Em Andamento → Em Revisão → Concluído (+ Bloqueado lateral); liga a uma Meta (relação nova) e ao seu Subsistema; opcionalmente ao Requisito que satisfaz. "Atualizar uma tarefa" = status novo **e** discussão registrada na página da tarefa. **Não existe backlog de tarefas** (11/09): A Fazer é o backlog; o que era "backlog" vive em Desejos e Expectativas.
- **Gate de conclusão**: tarefa Em Revisão só vai a Concluído com resultados verificados + documentação do subsistema atualizada + requisito atualizado (→ Aprovado) quando houver.
- **Status por regra, não por opinião**: Subsistema com ≥1 tarefa concluída → Em andamento; todos os requisitos Aprovados → Concluído; Sistema/Projeto concluem por rollup dos filhos. Cascata análoga para KPI → KR → Objetivo. No Notion, viram rollups/fórmulas — o fechamento é conferência, não digitação. Nas páginas 7 e 8 do Lucid tudo isso é ciano; o único passo humano é a medição do KPI.
- **OKRs**: `Grau` = Objetivo / Resultado-Chave / KPI; KPI carrega `Alvo` (number), `Unidade` (select) e `Direção` (= / ≥ / ≤). Medições vão para Evolução de KPIs, uma linha por KPI × Sprint.
- **Desejos e Expectativas → Requisitos** (fluxo desenhado na página 3 em 09/09): qualquer pessoa cadastra o desejo ligado ao Projeto (Em aberto) → responsável do projeto associa a um ou mais subsistemas (Em análise) → responsável do subsistema sugere requisito(s) ou Descarte/Arquivamento → na reunião tática os líderes aprovam ou não, checam impacto em outros requisitos e sugerem complementares → desejo sem requisito sugerido (ou requisito a revisar) vira Meta da Sprint de elaboração do requisito; os demais saem Encaminhado (requisito Aprovado) | Descartado | Arquivado. Campos da base: `Stakeholder` multi-select (Usuário / Decisor / Desenvolvedor / Externo), `Evidência` (Suposição / Inferência / Relato / Observação), `Motivação`.
- **IA na documentação das reuniões** (09/09): humanos criam metas e tarefas na reunião; a IA, a partir da transcrição, sugere criação/alteração de metas, tarefas e medições e escreve a discussão dentro da página de cada item citado no Notion — a ata deixa de ser um arquivo separado. Sempre com uma etapa explícita de conferência humana antes de efetivar (caixa azul "líder confere" depois de cada caixa ciano nas páginas 3, 4 e 5). O amarelo (discussão) continua humano. Intenção (11/09): skills padrão da empresa no Claude para esse procedimento.
- **Rollover mecânico** no fim da sprint: metas e tarefas não concluídas revinculadas à próxima sprint e páginas de visualização apontadas para ela; candidato a automação; o líder da equipe confere.
- **Páginas de visualização** (página 11): dashboard de planejamento tático [HTML] (reunião tática), páginas operacionais das equipes [Notion] (reuniões operacionais) e página "Eu" [Notion] (uso individual). O conteúdo de cada uma está no Lucid como **proposta, marcada A DEFINIR** — validar com os líderes; tecnologia e fonte de dados do dashboard também em aberto.
- **Retrospectiva da Sprint**: já está no macro (página 2): "Preencher Slides da Retrospectiva" (líder, azul) → "Reunião de Retrospectiva da Sprint" (amarelo), depois das três frentes de fechamento; a base Sprints guarda a retrospectiva. **Decisão anunciada em 11/09: passa a ser por projeto, não por equipe** (evita o vai e vem de assuntos). Em aberto quem prepara (cada líder de subsistema faz sua parte × participante do projeto sorteado apresenta o projeto inteiro). O recorte por projeto e o responsável pelo preenchimento ainda não estão refletidos no desenho.
- **Ciclo NASA (SE Handbook Fig. 4.0-1)** — necessidades → requisitos → desenvolvimento → verificação — é conduzido pelos **templates** de página no Notion (Subsistema), não por uma base ou página extra.
- **Responsável por atividade nos fluxos**, por cor de caixa: azul `#CFE2FF` líder da equipe · roxo `#E4D5F5` responsável do projeto/subsistema · rosa `#F9D5E5` responsável pelo OKR · amarelo `#FBEFC8` discussão na reunião · ciano `#C9EEF2` IA / automação Notion (com conferência humana) · cinza `#F2F4F8` qualquer pessoa / estado neutro. **Regra decidida em 09/09: a legenda de cada página mostra só os papéis citados naquela página** (página 6 só roxo; 7 rosa + ciano; 8 ciano; 9 azul + ciano; 2 azul + amarelo + ciano; 3 os cinco).
- **Código de cores de migração no ERD** (página 10): verde = criar · vermelho = deletar · laranja = alterar. As faixas são retângulos sobrepostos/anexados às tabelas, não linhas reais. A nota "MIGRAÇÃO EM CURSO" foi reescrita em 09/09 com a lista numerada do que falta (mesma lista de §6).
- Comunicação de meta criada fora do tático: **chat P&D – Liderança**.
## 4. Princípios de trabalho que valem para a sequência
 
1. **Verificar antes de afirmar.** Todo schema, URL e regra citada foi conferido na fonte. Episódios exemplares: a base Requisitos já existia e quase foi recriada; um revisor apontou `KPI >= X` como "lixo" no ERD, mas era o nome literal da opção no Notion; o ERD listava `Fonte_evidência` e `Responsável` em Medições como existentes, e nunca existiram; em 09/09, antes de propor "criar Bloqueado por", o schema mostrou que os campos já existiam — só faltava a aresta; em 11/09 este contexto afirmava que a página 2 não desenhava a retrospectiva, e o slide do ciclo saiu sem ela — a página 2 desenhava; conferir o Lucid antes de resumir o macro.
2. **Reusar antes de criar.** Bases, campos e status existentes têm precedência; não migrar vocabulário que funciona (ex.: status de aprovação de Requisitos).
3. **Nada é apagado antes do backfill conferido.** A ordem da Fase 4 no plano existe por isso.
4. **Revisão independente.** Depois de qualquer rodada grande de edição visual, um revisor com olhos frescos exporta página por página e reporta defeitos (linhas atravessando shapes, rótulos ilegíveis, textos truncados); depois se corrige e se re-verifica com exports 1:1. Em 09/09 a revisão trouxe ~40 apontamentos; os introduzidos na rodada foram corrigidos, os pré-existentes estão listados em §6.
5. **Assunções explícitas.** O que não está definido é marcado "A DEFINIR" em vermelho — nunca inventado silenciosamente. Decisões do usuário são registradas no plano (seção "Decisões" + adendo) e, para 09/09, no plano de alterações.
6. **Fidelidade com formalização.** O Lucid reproduz o que foi desenhado, mas formaliza (linhas paralelas do Miro → gateways BPMN; marcadores de laço → containers nomeados).
7. **Plano antes de editar.** Para rodadas grandes no Lucid — e para deliverables como os slides — o usuário quer um plano revisável (por página/slide, com decisões em aberto) antes de qualquer edição; em 11/09 ele preferiu revisar o plano como arquivo `.md` com coluna "Ajustes" para devolver comentado.
8. **Nunca apagar um shape que ancora uma thread de comentário** — reescrever ou mover em vez de deletar (a thread se perderia).
## 5. Limitações técnicas aprendidas (APIs via MCP)
 
- **Miro**: shapes do tipo *stencil* não expõem texto pela API — a leitura fiel do board exigiu export em PDF pelo usuário.
- **Lucid — estrutura**: a API **não cria páginas** (só a UI; página 11 foi criada pelo usuário e preenchida via API); **não cria "links para Página"** nativos (só links URL, que abrem em outra aba — conversão manual na UI); **não pinta células** de tabela; **não adiciona linhas** a uma tabela existente (chaves `Cell_N,M` inexistentes são ignoradas) — campos excedentes viram faixa-retângulo anexada; `lucid_edit_item` em células existentes (`text_areas` com key `Cell_N,M`) funciona; URLs de página usam pageId estável (`?page=pg6`).
- **Lucid — conectores**: edições de endpoint em conectores existentes são **silenciosamente ignoradas** (confirmado de novo em 09/09) — deletar e recriar com `lucid_add_line`; recolorir e relabelar funciona. `line_shape` aceita `curve | cyclical | diagonal | elbow` (não `curved`). Estilos de ponta `CFN ERD Many Arrow` / `CFN ERD One Arrow` / `Arrow` funcionam. Laço self numa tabela: com `curve` e as duas pontas na mesma borda sai um arco pequeno; rótulo de laço cai sobre a tabela — deixar sem rótulo e explicar na linha da tabela. `endpoint_auto_link` pode rotear a linha por cima de outros shapes — preferir posições explícitas (0–1). Rótulo em linha vertical curta empilha uma palavra por linha — usar rótulos de 2–3 palavras. Conectores ligados a blocos seguem quando o bloco é movido/redimensionado pela API.
- **Lucid — blocos**: `ProcessBlock` criado pela API **redimensiona ao texto em torno do centro** (cresce e encolhe) — dimensionar já com folga e checar por export; a ponta de uma seta em `(0.5, 0)` pode ficar alguns px acima da borda visível — usar `position_y ≈ 0.06`. `NoteBlock` também cresce em torno do centro. `TextBlock` tem altura mínima ~120 e centraliza verticalmente — não serve de rótulo fino entre caixas; nasce com borda preta (`line_width 0`). `RectangleBlock` ignora `font_size`. `RectangleContainerBlock` aceita `text_areas [{key: "FloatingTitle"}]`; mover o container pela API não move os filhos. `lucid_export_document_as_PNG` com `bounding_box` é o jeito barato de conferir um trecho. `lucid_search_document` + `fetch` por região é o jeito barato de conferir o conteúdo de uma página.
- **Lucid — comentários**: `list_document_threads` não informa a página; `fetch` de uma página traz as threads ancoradas em itens daquela página (com `itemId`) e as threads sem item aparecem em todas as páginas. `post_document_thread_comment` responde; não há resolução via API.
- **Notion**: leitura de schema via `fetch` do data source funciona sempre. A consulta SQL **por base única** não está disponível nesta conta via MCP — contagens e triagens de dados têm de ser feitas na UI do Notion. Rollups/fórmulas não carregam dado próprio, então deletá-las só exige conferir visualizações dependentes.
## 6. Estado atual e próximos passos
 
**Feito**: Fases 1–3. Fase 4 executada em parte (ago–set/2026). ERD (página 10) reescrito em 08/09 com o schema real das 10 bases. **09/09**: todos os 14 comentários do Lucid aplicados (papel Responsável pelo OKR; IA documentando reuniões com conferência humana; fluxo Desejos → Requisitos; dependência entre metas; página 11 de Visualizações; legendas por página; nomes atuais das bases em todas as páginas; arestas pendentes e nota do ERD), revisão independente feita e corrigida, threads respondidas. **11/09**: reestruturação apresentada à empresa na retrospectiva (deck `reestruturacao-gestao-sprint.pptx`; estrutura e decisões em `claude/plano-slides-retrospectiva-2026-09-11.md`). O usuário pretende fechar a reestruturação no fim de semana de 13–14/09, antes da próxima sprint, incluindo a revisão dos subsistemas; os responsáveis por OKRs e por projetos/subsistemas serão revistos na semana seguinte.
 
**Fase 4 — o que ainda falta no Notion** (é a lista da nota "MIGRAÇÃO EM CURSO" da página 10):
1. Relação Tarefa → Meta da Sprint (era a "lacuna" central do modelo antigo).
2. Relação Tarefa → Requisito que satisfaz.
3. Retirar a opção `Entregável-Chave` de `Tipo` e o template "Entregável-chave" da base Projetos, após a triagem dos itens; criar o template de Subsistema (ciclo NASA).
4. Renomear status de Tarefa `Fazendo` → `Em Andamento`.
5. Apagar a fórmula `Idade` em Tarefas.
6. Em Requisitos: `Categoria`, `Requisito_pai` (auto-relação de alocação) e relação com Tarefas.
7. Em Metas: `Sprint_de_origem` (para o rollover).
8. Em OKRs Táticos: `Responsável pelo OKR` (person) — novo em 09/09.
9. Em Evolução de KPIs: decidir se `Fonte_evidência` e `Responsável` entram ou saem do modelo (hoje "A DEFINIR" no ERD).
10. A relação Projetos ↔ Sprints deixou de existir. Confirmar se foi intencional.
11. Relações `Tarefa → Subsistema` e `Tarefa → Área` são só de ida (sem coluna espelho). Os rollups de status por regra vão precisar do lado inverso.
12. Backfills ainda não conferidos por falta de SQL: Meta KR → Objetivo, Meta → Subsistema, migração do Sprint Backlog para Desejos.
**Lucid — pendências novas de 11/09**: na página 2, refletir a retrospectiva **por projeto** (hoje o rótulo é genérico "Reunião de Retrospectiva da Sprint") e o responsável por "Preencher Slides da Retrospectiva" (hoje azul = líder da equipe; muda conforme a decisão A/B da discussão de 11/09).
 
**Lucid — defeitos pré-existentes na página 10 não corrigidos em 09/09** (relatados pela revisão; exigem redesenho na UI ou reposicionar tabelas): células truncadas em OKRs Táticos (`Grau`, `Status`) e Metas (`Status`); faixas de Desejos e Expectativas com texto sobreposto; arestas antigas ancoradas em linhas erradas (Projetos → Diretorias termina em `Líder`; Metas `Área` → Diretorias termina em `item principal`; linha "contribui para" no topo passa sobre Metas); rótulos "alocada na sprint" (aresta antiga Tarefa → Sprint) e "sistema / subsistema" colidindo; rótulo "subtarefas" sobre a borda da tabela. Fora do ERD: rótulos "Sim"/"Não" colados nas setas e alguns textos encostados nas bordas de caixas antigas.
 
**Decisões em aberto registradas no Lucid como A DEFINIR**: conteúdo de cada página de visualização; tecnologia e fonte de dados do dashboard tático; se o apontamento das visualizações para a nova sprint é manual, automação ou script; `Fonte_evidência` / `Responsável` em Evolução de KPIs.
 
**Alimentar Evolução de KPIs** (praticamente vazia) — sem isso o dashboard da Fase 5 não tem dado.
 
**Fase 5 — Dashboards HTML**: KPIs com série temporal por sprint; board metas × tarefas por subsistema para projetar em reunião; requisitos por subsistema. Tela grande, sem transições (dores do Miro). A página 11 do Lucid é o ponto de partida do escopo.