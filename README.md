# Dashboard Tático P&D — BSV Robótica

Dashboard da **reunião tática de P&D**: OKRs com série de KPIs por sprint, board de metas × subsistemas, dependências, alertas por regra, rollover da sprint e pedido de registro de reunião para o Claude.

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
| Rollover R1–R6 | cria a #N+1; revincula metas e tarefas marcadas; histórico (ou `Sprint_de_origem`, quando existir); medições; no fim, #N → Concluído e #N+1 → Em andamento |
| Reunião & IA | nada: gera o prompt para a skill `gestao-sprint-notion` registrar a discussão |

Outros recursos:
- **Modo TV** (`?modo=tv`): tela grande, só leitura.
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
- **Entregável-Chave** (tipo que saiu do modelo; `TIPOS_OCULTOS` em `schema.js`): não vira lane.
  - Metas e desejos ligados a um Entregável-Chave aparecem no item pai, com a tag "via entregável-chave" e um alerta "reapontar". A relação no Notion não muda.
  - Reaponte as metas antes de arquivar o Entregável-Chave; senão elas ficam sem subsistema.
  - Arrastar o card para outra lane tira o Entregável-Chave da relação, numa linha explícita do plano.
  - Um Entregável-Chave sem item pai continua aparecendo em "Fora dos projetos", porque não há onde exibir as metas dele.

**A DEFINIR** (não inventado no código):
- Retrospectiva por projeto: quem preenche.
- `Fonte_evidência` / `Responsável` em Evolução de KPIs.
- Conteúdo final das páginas de visualização, a validar com os líderes.

## Deploy

Ver **[docs/deploy-gcp.md](docs/deploy-gcp.md)**: Cloud Run em `southamerica-east1`, token no Secret Manager, IAP para o domínio, lista de editores.
