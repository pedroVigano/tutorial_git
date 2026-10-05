# Dashboard de gestão da sprint — P&D, BSV Robótica

O lugar das reuniões de gestão de P&D, uma aba por reunião:
- **Trimestral:** OKRs do trimestre passado × trimestre atual.
- **Tática:** objetivos, KRs e KPIs; metas da sprint por equipe e por projeto.
- **Operacional:** por equipe, metas da sprint com OKRs/KPIs e tarefas por status e responsável.
- **Eu:** minhas tarefas, revisões, itens da árvore e OKRs de que sou responsável.

A aba **Rollover** fecha a sprint, e o painel **🎙 Reunião** está em todas as abas.

É a versão real do mock v2.2 (`docs/mock/Reuniao_Tatica_PD_S27_v2_2.html`), feita dentro da reestruturação da gestão da sprint (`docs/contexto_reestruturacao_sprint.md`, Fase 5):
- **Lê o Notion ao vivo.** Não usa mais uma foto de dados embutida.
- **Grava direto no Notion, com plano de escrita.** Toda ação mostra `base → página → campo → atual → novo` e só grava depois de "Gravar no Notion".
- **Roda no Cloud Run com login Google (IAP).** Qualquer conta `@bsvrobotics.com.br` lê; só os líderes da lista gravam.

## Como funciona

```
Navegador ──IAP (login Google)──► Cloud Run · Node 22 / Fastify ──► API do Notion (integração própria)
             web/ (JS do mock em módulos)   server/ (snapshot + cache, planos, executor, auth)
```

- **Snapshot.** O servidor lê as 9 bases do Notion e monta um objeto no mesmo formato do `D` do mock: objetivos, KRs, KPIs com série por sprint, árvore Projeto › Sistema › Subsistema, metas da sprint, tarefas e desejos.
  - O snapshot fica em cache por 2 min.
  - O botão "Notion lido às HH:MM ↻" força uma nova leitura.
  - A tela se atualiza sozinha: a cada 2 min, ou a cada 1 min no modo TV.
- **Rascunho e revisão.** Nada é gravado na hora.
  - **Rascunho:** cada ação (meta nova, editar, mover, dependência, abortar, próxima sprint, medição, rollover, Trimestral) entra no **📝 Rascunho**. Ele fica no navegador, por sprint, e a tela mostra o pendente tracejado.
  - **Consolidação:** ações sobre a mesma coisa viram uma só (`web/js/changeset.js`):
    - mexer numa meta ainda não criada muda o próprio item de criação, e abortá-la tira do rascunho;
    - mover A→B→C vira A→C;
    - criar e remover a mesma dependência se anulam.
  - **Revisão:** funciona como um pull request (`web/js/review.js`).
    - À esquerda ficam as alterações: incluir ou excluir, autor, comentários, descartar.
    - À direita, o diff por página do Notion, com o valor atual lido agora (− atual / + novo).
    - "Gravar no Notion" grava os itens incluídos num plano único (`lote`): criações primeiro; dependência com meta nova usa a referência da criação.
    - O que foi gravado sai do rascunho; o que falhou fica.
- **Gravação.**
  1. `POST /api/plan` relê os valores atuais no Notion e devolve o plano.
  2. `POST /api/exec` grava passo a passo, com o progresso na tela.
  - Antes de cada passo a página é relida. Relação acrescentada é união com o valor atual.
  - Se alguém mudou um campo de valor único desde o plano, a gravação para com "conflito".
  - Cada plano só roda uma vez, e refazer não duplica: páginas já criadas são reaproveitadas.
- **Princípios** (os mesmos da skill `gestao-sprint-notion`):
  - Nada é apagado: "apagar" meta é status **Abortado**.
  - Relações são acumulativas. Remoção só acontece em "mover de subsistema" e "remover dependência", sempre como linha própria em vermelho no plano.
  - As regras do modelo aparecem como avisos: título com verbo, exatamente 1 equipe, ≥ 1 objetivo, ≥ 1 subsistema.

Tudo abaixo passa pelo rascunho e pela revisão antes de gravar.

| Ação no dashboard | O que grava no Notion |
|---|---|
| `+` numa lane / "+ meta de elaboração" num desejo | página nova em 🏁 Metas da Sprint com corpo `## Critério de conclusão` (e `## Origem` + linha em `## Decisão da reunião tática` do desejo) |
| ✎ Editar meta | só os campos alterados; critério novo é acrescentado na seção, sem apagar o anterior |
| Arrastar card para outra lane | `Subsistema`: + destino, − origem |
| Arrastar da bolinha até outra meta / "ligar por clique" | `Bloqueado por` (+); o Notion atualiza o espelho `Bloqueando` |
| Clicar numa seta | `Bloqueado por` (−) |
| Abortar | `Status = Abortado` |
| → Próxima sprint | `🏃 Sprint` (+ #N+1, cria a sprint se preciso) e linha em `## Histórico de sprints` com o motivo |
| ＋ registrar medição (coluna OKR ou R4 do rollover) | linha em 📈 Evolução de KPIs (`<KPI> — Sprint #NN`, KPI, Sprint, Valor, Data) ou troca do valor existente |
| + tarefa / ✎ / arrastar de coluna (Operacional, Eu) | página nova em ✅ Lista de Tarefas (Meta, Sprint, Subsistema, Responsável, Área, Prazo, Prioridade) / campos alterados / `Status` |
| 🗣 Registrar discussão | entrada nova em `## 🗣️ Registro de reuniões` da página (criada no fim se não existir) |
| Rollover R1–R6 | cria a #N+1; revincula metas e tarefas marcadas; histórico (ou `Sprint_de_origem`, quando existir); medições; no fim, #N → Concluído e #N+1 → Em andamento |
| Trimestral → Gravar no Notion | páginas novas em 🎯 OKRs Táticos (cópias com `Origem`, KRs/KPIs novos), `KPI` (+) nas medições religadas, edições e `Status` (Abortado / status final) |
| 🎙 Reunião → ✨ Gerar ata e sugestões | página nova em 👨‍👩‍👦‍👦 Reuniões (Date, Duração, Frequência = Pontual, Nível, Equipes, Área, Participantes, Material de Apoio = Dashboards; corpo com tópicos, decisões, próximos passos e transcrição) + "🗣️ Registro de reuniões" nas páginas citadas + sugestões aceitas na revisão |
| 📝 Documentar com IA | toggle "Atualização DD/MM — sugerida por IA, revisada por …" logo abaixo de `## 6. Desenvolvimento` (e de `## 5. Verificação`, se houver ensaio) |
| 🎙 Reunião → prompt para o Claude | nada: gera o prompt para a skill `gestao-sprint-notion` registrar a discussão |

Outros recursos:
- **Trimestral** (aba ou `?pagina=trimestral`): reunião trimestral de P&D. Duas colunas pareadas linha a linha: à esquerda o trimestre revisado, à direita o planejado.
  - **Esquerda:** Objetivo › KR › KPI, status pela regra × status no Notion e status final a gravar.
  - **Direita, ações:**
    - "duplicar objetivo" copia o objetivo com KRs e KPIs, que aparecem ao lado;
    - os textos são editáveis;
    - o alvo do KPI se ajusta arrastando a linha no lado direito do gráfico ou digitando;
    - "abortar" deixa o espaço vazio para manter o pareamento;
    - dá para criar KR, KPI ou objetivo novos.
  - **Gráfico:** vai da 1ª sprint do revisado à última do planejado. As sprints futuras são projetadas a cada 14 dias e marcadas com `*`.
  - **Rascunho:** fica no navegador até "Gravar no Notion", que monta um plano único (`okr.trimestre`) com:
    - páginas novas com `Trimestre` = planejado, `Origem` = item copiado e Data Limite = fim do trimestre;
    - medições do KPI original religadas à cópia;
    - edições e "abortar" (`Status = Abortado`) nos itens que já existem;
    - status final do trimestre revisado.
  - **Depois de gravar:** o pareamento é refeito pelo campo `Origem`. Refazer o mesmo rascunho não duplica páginas.
- **Ordem dos OKRs:** objetivos, KRs e KPIs seguem a coluna `Ordem` do Notion, com os vazios no fim. Vale para o Board e para a Trimestral. Os KPIs são numerados dentro de cada KR.
- **Operacional:**
  - **Por equipe:** as metas da sprint mostram o objetivo, os gráficos dos KRs e o quadro de tarefas (A Fazer · Em Andamento · Em Revisão · Concluída · Bloqueada).
  - **Ações:**
    - arrastar a tarefa de coluna muda o status;
    - "+" cria tarefa na meta, com responsável, subsistema, prazo e prioridade;
    - ✎ edita;
    - 🗣 registra a discussão na página.
  - **Ao lado:** "Em revisão" (com quem revisa: o responsável do subsistema), "Bloqueadas" e "Por pessoa".
  - **Gate de conclusão:** Em Revisão → Concluída vira aviso na revisão quando falta o gate, ou quando quem conclui não é o responsável do subsistema.
- **Eu:**
  - "Eu" é a pessoa do Notion com o e-mail do login. Se a integração não lê e-mails, escolha em "Ver como".
  - **Mostra:**
    - minhas tarefas da sprint;
    - revisões esperando por mim, nos subsistemas de que sou responsável;
    - itens da árvore de que sou responsável, com metas e desejos;
    - metas de que participo;
    - OKRs de que sou responsável. Esta parte está marcada A DEFINIR até existir `Responsável pelo OKR`.
- **🗣 Registrar discussão** (meta, tarefa, item da árvore): acrescenta uma entrada na seção "🗣️ Registro de reuniões" da página, no formato da skill `gestao-sprint-notion` (`### DD/MM/AAAA · Tipo · ⬜ Conferido por —` + Participantes / Discussão / Decisões).
- **IA (Gemini no Vertex AI):** nada é gravado sem passar pela revisão.
  - **🎙 Gravar** (painel Reunião, em qualquer aba):
    - o áudio vai em trechos de ~5 min para o Gemini e vira transcrição ao vivo;
    - o áudio não é guardado;
    - a transcrição fica no navegador;
    - também dá para colar uma transcrição.
  - **✨ Gerar ata e sugestões** põe no rascunho:
    - a ata, numa linha em 👨‍👩‍👦‍👦 Reuniões: resumo por tópicos, decisões, próximos passos e a transcrição recolhida;
    - a entrada do "🗣️ Registro de reuniões" em cada página citada, com o link da ata;
    - as mudanças sugeridas (status, tarefa nova, medição, meta, dependência), **desmarcadas**, cada uma com a justificativa e o trecho da conversa.
  - **✨ Aprimorar com IA** (na revisão): o Gemini revisa o rascunho como um revisor de PR.
    - Lê o texto atual das páginas tocadas e a transcrição.
    - Devolve três tipos de sugestão: de edição por item (com "Aplicar" e "Dispensar"), de ação que falta (entra desmarcada) e comentários.
  - **📝 Documentar com IA** (lane da Tática, aba Eu): o Gemini lê a página do subsistema e as tarefas recentes, com seus registros de reunião, e redige um toggle datado logo abaixo de "6. Desenvolvimento". Nada do que já existe é editado.
  - **Proteções:**
    - a saída do Gemini é JSON com schema;
    - ids e valores são conferidos contra o snapshot, e o resto é descartado;
    - o conteúdo do Notion vai no prompt como dado, não como instrução;
    - só editores usam, com limite por pessoa.
  - `IA_MODE=fake` (padrão no modo demonstração) dá respostas fixas, e `IA_MODE=off` desliga.
- **Tática (board):**
  - **Gráfico de KR:** um gráfico compacto por KR, com todos os KPIs em "% do alvo".
    - O alvo de todos fica na mesma linha (100%), e para cima é melhor (≤ usa alvo/valor).
    - KPI sem alvo fica em escala própria, tracejado.
    - A legenda é o placar: clicar liga ou desliga o KPI, e passar o mouse destaca a linha. O tooltip mostra o valor real de cada KPI na sprint.
    - Sprint sem medição depois de uma medição repete o último valor com bolinha aberta. É só visual: o status continua pela última medição real.
  - **Cores:** cada KR tem uma cor, pela ordem no objetivo, e os KPIs dele usam tons dessa cor com formas de marcador diferentes. A Trimestral usa as mesmas cores.
  - **Árvore:** projeto › sistema › … › subsistema, em qualquer profundidade, ordenada pela coluna `ID` dos Projetos.
    - Projeto e sistemas com filhos têm lane própria, para metas de integração. Por isso saiu o alerta "meta ligada a sistema, não a um subsistema".
    - Cada sistema com filhos tem um tom, e os subsistemas dele herdam o tom.
    - O ▾ recolhe a subárvore.
  - **Setas:**
    - Os cards se ordenam sozinhos para as setas cruzarem menos. A ordem arrastada à mão vale até "⇄ Organizar setas".
    - Várias setas no mesmo lado do card se espalham pela borda.
    - Setas longas correm pelo corredor entre Desejos e Metas, sem atravessar cards.
    - Meta escondida num grupo recolhido recebe a seta no cabeçalho do grupo (tracejada, ×N). O clique expande o grupo.
    - Passar o mouse num card destaca as setas dele.
- **Modo TV** (`?modo=tv`): tela grande. Só o cabeçalho recolhe numa faixa fina; ele abre ao passar o mouse, ou fica aberto com 📌. Quem está na lista de editores continua editando.
- **Larguras:** a coluna de OKRs (divisor) e as colunas Árvore e Desejos das lanes (alça no título da coluna) se ajustam arrastando. Duplo clique na alça volta ao padrão. Fica no navegador de cada pessoa.
- **Tema:** claro, escuro ou automático.
- **Filtro por equipe:** "Só P&D" esconde as metas de outras diretorias.
- **Ordem dos cards:** fica no navegador de cada pessoa.

## Rodar localmente

```bash
npm ci
npm run dev          # modo demonstração: Notion falso em memória com a foto de dados do mock (14/09) — sem token
                     # http://localhost:8080 · gravações vão para a memória e somem ao reiniciar
cp .env.example .env # preencha NOTION_TOKEN (integração do Notion — ver docs/deploy-gcp.md, passo 1)
npm run schema:check # confere se as bases e campos do Notion batem com o esperado
npm run dev:live     # dados reais do Notion, usuário local (AUTH_MODE=dev)
```

**Atenção:** em `dev:live` as gravações vão para o **Notion de verdade**.

O modo demonstração acrescenta alguns itens de exemplo para exercitar a interface: tarefas e desejos com "(exemplo)" no título, e duas dependências entre metas.

## Testes

```bash
npm test             # ~35 testes, ~2 s: paridade com o mock, Notion → snapshot, planos/executor, auth IAP, API, schema check
npm run test:e2e     # navegador (Chromium): nova meta, dependência, mover card, medição, abortar, rollover, leitor
npm run screenshots -- http://localhost:8080 screenshots   # capturas do Board, Rollover, Reunião, TV (claro e escuro)
```

Os testes de paridade rodam o **código original do mock** numa VM. O objetivo é conferir se as regras portadas dão os mesmos status e os mesmos alertas:
- sobre o `D` do mock;
- sobre o snapshot reconstruído do Notion (mock → páginas do Notion → snapshot).

## Estrutura

```
server/
  app.js · index.js · config.js · display.js (cores das equipes)
  auth/iap.js            JWT do IAP (jose + chaves do Google), papel leitura/edição, modo dev
  notion/schema.js       ÚNICO lugar com nomes de bases e campos do Notion (conferidos em 28/09/2026)
  notion/client.js       SDK oficial (API 2025-09-03) + limitador ~3 req/s + paginação + relação > 25 itens
  notion/queries.js      leitura das bases para o snapshot
  notion/schema-check.js compara schema.js com o Notion vivo (OK / AVISO / ERRO → somente leitura)
  notion/fake.js · demo.js  Notion falso (mesma interface do SDK) e dados de demonstração a partir do mock
  snapshot/build.js      páginas do Notion → objeto D (função pura)
  snapshot/cache.js      cache por sprint, ETag
  writes/plans.js        um plano por ação (linhas para conferir + operações)
  writes/executor.js     fila serial, releitura, conflito, planId de uso único, NDJSON, auditoria
web/                     front do mock v2.2 em ES modules (sem build); css/app.css é o CSS do mock
test/ · scripts/         testes, e2e, screenshots, schema check
docs/                    mock original, contexto da reestruturação, guia de deploy
```

## Quando o Notion mudar

Os pontos da Fase 4 ainda abertos (ver `docs/contexto_reestruturacao_sprint.md` §6) já estão previstos:
- **`Sprint_de_origem`** (Metas) e **`Responsável pelo OKR`** (OKRs): marcados como opcionais em `schema.js`.
  - Hoje aparecem como aviso no schema check.
  - Quando forem criados, o dashboard passa a usá-los sozinho. No rollover, preenche `Sprint_de_origem` em vez da linha de histórico.
- **Status de tarefa `Fazendo` → `Em Andamento`:** as duas formas são aceitas.
- **Campo renomeado:** o schema check casa pelo ID da propriedade e segue funcionando, com aviso.
  - Para fixar os IDs: `npm run schema:check -- --ids`, depois copie os IDs para `schema.js`.
- **Campo apagado ou com tipo diferente:** o dashboard entra em **somente leitura** e mostra qual campo, até alguém corrigir o Notion ou `schema.js`.
- **KPI duplicado para outro trimestre:** a medição em 📈 Evolução de KPIs pode ligar o KPI original e a cópia. O valor entra na série dos dois.
- **Entregável-Chave** (tipo que saiu do modelo; `TIPOS_OCULTOS` em `schema.js`): não vira lane.
  - Metas e desejos ligados a um Entregável-Chave aparecem no item pai, com a tag "via entregável-chave" e um alerta "reapontar". A relação no Notion não muda.
  - Reaponte as metas antes de arquivar o Entregável-Chave; senão elas ficam sem subsistema.
  - Arrastar o card para outra lane tira o Entregável-Chave da relação, numa linha explícita do plano.
  - Um Entregável-Chave sem item pai continua aparecendo em "Fora dos projetos", porque não há onde exibir as metas dele.

**Conferir no ambiente real** (este repositório só testou com o Notion falso e a IA em modo `fake`):
- `npm run schema:check`: coluna `ID` (texto) em Projetos; `Prazo`, `Prioridade` e `🔼 Área` em Tarefas; acesso à base 👨‍👩‍👦‍👦 Reuniões.
- **Integração do Notion:** precisa ler e-mail de usuários, para a aba Eu reconhecer quem está logado.
- **Vertex AI:** API habilitada, papel `roles/aiplatform.user` na conta de serviço e modelos disponíveis no projeto (ver `docs/deploy-gcp.md`).

**A DEFINIR** (não inventado no código):
- Retrospectiva por projeto: quem preenche.
- `Fonte_evidência` / `Responsável` em Evolução de KPIs.
- Conteúdo final das páginas de visualização, a validar com os líderes.

## Deploy

Ver **[docs/deploy-gcp.md](docs/deploy-gcp.md)**: Cloud Run em `southamerica-east1`, token no Secret Manager, IAP para o domínio, lista de editores.
