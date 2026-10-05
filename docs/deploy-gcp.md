# Deploy no GCP — Cloud Run + IAP (login Google)

Guia passo a passo para colocar o Dashboard Tático P&D no projeto GCP da BSV. Resultado: uma URL do Cloud Run protegida pelo **Identity-Aware Proxy (IAP)**:
- **Quem acessa:** qualquer conta `@bsvrobotics.com.br` entra e **lê**.
- **Quem grava:** só os e-mails listados no secret `editor-emails` **gravam** no Notion.

> **Testado no projeto `bsv-robotics-management` em 28/09/2026.** O deploy em `southamerica-east1` com `--iap` funcionou. Os ajustes que precisaram ser feitos na primeira vez estão incorporados abaixo. Se algum comando for recusado, veja [Se algo der errado](#se-algo-der-errado).
>
> **Rode um comando por vez**, principalmente os que pedem entrada, como `read -s`. Se você colar um bloco inteiro, a linha seguinte pode ser lida como se fosse o que o comando pediu.

## 0. Pré-requisitos

- `gcloud` atualizado (`gcloud components update`) e logado numa conta com permissão de dono ou editor no projeto. Os papéis necessários são Run Admin, IAP Admin, Secret Manager Admin, Service Account Admin e Cloud Build Editor.
- O domínio `bsvrobotics.com.br` é uma organização Google Workspace, e o projeto GCP está dentro dela.
- Alguém com acesso de administrador ao workspace do Notion, para criar a integração.

```bash
PROJECT_ID=seu-projeto            # projeto GCP da BSV
REGION=southamerica-east1         # São Paulo
SERVICE=tatico-pd
gcloud config set project $PROJECT_ID
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
```

## 1. Integração do Notion (só do dashboard)

1. No Notion, vá em **Developer tools → Connections → New connection**, dê o nome "Dashboard Tático P&D" e escolha **API token**. Não use OAuth: o dashboard usa um token só, do servidor, e o login das pessoas é feito pelo Google (IAP).
   Use uma conexão exclusiva do dashboard: o limite de ~3 req/s do Notion é por token.
2. **Configuration:** capacidades
   - **Conteúdo:** ler, atualizar e inserir.
   - **Usuários:** ler informações **com e-mail** ("Read user information including email addresses").
     - Serve para mostrar o nome dos responsáveis.
     - Serve também para a aba **Eu** casar o login Google com a pessoa do Notion.
     - Sem e-mail, a aba Eu pede "Ver como".
3. **Content access → Edit access:** dê acesso às 10 bases abaixo.
   🏁 Metas da Sprint · 🎯 OKRs Táticos · 📈 Evolução de KPIs · 🤖 Projetos, Sistemas e Subsistemas · 🏃 Sprints · ✅ Lista de Tarefas · 🔼 Diretorias e Áreas Funcionais · 📜 Desejos e Expectativas · 📋 Requisitos · 👨‍👩‍👦‍👦 Reuniões
   - **👨‍👩‍👦‍👦 Reuniões** é opcional: sem acesso a ela, o schema check dá AVISO e só a gravação de atas fica desligada.
   - Dar acesso à página **BSV Robotics** também funciona, porque o acesso vale para tudo que está dentro dela. Em compensação, o token passa a poder editar qualquer página da BSV.
   - Páginas com acesso restrito, ou que ficam fora de BSV Robotics, precisam ser adicionadas uma a uma.
4. Copie o token (`ntn_…`, 50 caracteres). Guarde-o só no `.env` local e no Secret Manager, nunca em chat ou e-mail. Depois, teste localmente:
   ```bash
   cp .env.example .env   # preencha NOTION_TOKEN
   npm ci
   npm run schema:check   # deve terminar com "0 erro(s)"
   npm run dev:live       # abre em http://localhost:8080 com dados reais
   ```

## 2. APIs, secrets e conta de serviço

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com iap.googleapis.com
```

A ativação leva alguns minutos para valer. Antes de criar os secrets, espere este comando listar a API:

```bash
gcloud services list --enabled --filter="name:secretmanager.googleapis.com"
```

Se o gcloud perguntar "not enabled… (y/N)?", responda `N`, espere mais um pouco e repita.

```bash
# token do Notion: digite (ou cole) quando pedir; não aparece na tela nem fica no histórico
read -s -p "Token do Notion: " TOKEN; echo
printf '%s' "$TOKEN" | gcloud secrets create notion-token --data-file=-
unset TOKEN
gcloud secrets versions access latest --secret=notion-token | wc -c    # deve dar ~50, não 0

# lista de quem grava (e-mails reais, separados por vírgula)
printf '%s' 'lider1@bsvrobotics.com.br,lider2@bsvrobotics.com.br' | gcloud secrets create editor-emails --data-file=-

# conta de serviço do app (só lê os dois secrets)
gcloud iam service-accounts create tatico-pd-run --display-name="Dashboard tático P&D"
SA=tatico-pd-run@$PROJECT_ID.iam.gserviceaccount.com
for s in notion-token editor-emails; do
  gcloud secrets add-iam-policy-binding $s --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
done

# conta que executa o build (padrão do Compute): sem este papel, o build falha sem deixar log
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --role=roles/run.builder
```

### IA (Gemini no Vertex AI) — gravação de reuniões, atas, "Aprimorar" e "Documentar"

```bash
gcloud services enable aiplatform.googleapis.com
gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:$SA --role=roles/aiplatform.user
```

- **Credenciais:** o app usa as credenciais da própria conta de serviço; não há chave de API.
- **Áudio:** vai em trechos de ~5 min para o Gemini, só para transcrever, e **não é guardado**. A transcrição vai para a ata no Notion depois da revisão.
- **Modelos:** os padrões são `gemini-2.5-flash` (transcrição) e `gemini-2.5-pro` (ata e revisão), na localização `global`.
  - Confira no Model Garden do projeto que eles estão disponíveis.
  - Se quiser trocar, use `VERTEX_MODEL_TRANSCRICAO`, `VERTEX_MODEL_REVISAO` e `VERTEX_LOCATION`.
- **Desligar:** `IA_MODE=off` desliga a IA; o painel Reunião continua com o prompt para o Claude.

## 3. Deploy

Na raiz do repositório, no branch com o código (o Cloud Build usa o `Dockerfile`). Na primeira vez, o gcloud pergunta se pode criar o repositório `cloud-run-source-deploy` no Artifact Registry; responda **Y**.

```bash
gcloud run deploy $SERVICE --source . --region $REGION \
  --service-account $SA \
  --no-allow-unauthenticated --iap \
  --min-instances 1 --max-instances 1 --cpu-boost --timeout 900 \
  --set-env-vars AUTH_MODE=iap,NOTION_MODE=live,IA_MODE=vertex,VERTEX_PROJECT=$PROJECT_ID \
  --set-secrets NOTION_TOKEN=notion-token:latest,EDITOR_EMAILS=editor-emails:latest
```

Por que essas flags:
- `--max-instances 1`: o cache do snapshot e a fila de gravações ficam numa instância só (são ~10 líderes).
- `--min-instances 1`: evita a espera da primeira abertura. Para economizar, use `0`; o primeiro acesso depois de um tempo parado leva alguns segundos.
- `--timeout 900`: o rollover grava ~100–200 itens a ~3 req/s e mostra o progresso na tela.
- `--iap`: liga o login Google na frente do serviço. O próprio deploy já cria o agente do IAP e dá a ele permissão para chamar o serviço ("Setting IAP service agent ✓").

## 4. Permissões do IAP

```bash
# quem pode abrir o dashboard: todo o domínio
gcloud iap web add-iam-policy-binding --resource-type=cloud-run --service=$SERVICE --region=$REGION \
  --member=domain:bsvrobotics.com.br --role=roles/iap.httpsResourceAccessor --condition=None
```

Se o deploy não tiver mostrado "Setting IAP service agent ✓", crie o agente e dê a permissão manualmente. Repetir não causa problema:

```bash
gcloud beta services identity create --service=iap.googleapis.com --project=$PROJECT_ID
gcloud run services add-iam-policy-binding $SERVICE --region $REGION \
  --member=serviceAccount:service-$PROJECT_NUMBER@gcp-sa-iap.iam.gserviceaccount.com \
  --role=roles/run.invoker
```

Para restringir o acesso a um grupo, troque `domain:bsvrobotics.com.br` por `group:lideres-pd@bsvrobotics.com.br`.

## 5. Conferir

```bash
gcloud run services describe $SERVICE --region $REGION --format='value(status.url)'
```

Abra a URL, faça login com a conta da BSV e confira:
- **Header:** mostra seu e-mail e **edição** (se você está em `editor-emails`) ou **leitura**.
- **`/api/health`:** mostra `"somente_leitura": false` e a lista de avisos do schema. Os avisos esperados hoje são os campos da Fase 4.
- **Logs:** `gcloud run services logs read $SERVICE --region $REGION --limit 50`

Primeira gravação real: crie uma meta de teste pelo `+` de uma lane, confira no Notion e depois aborte a meta pelo próprio dashboard.

## Operação

| Tarefa | Como |
|---|---|
| Mudar quem grava | `printf '%s' 'a@…,b@…' \| gcloud secrets versions add editor-emails --data-file=-` e depois `gcloud run services update $SERVICE --region $REGION --update-secrets EDITOR_EMAILS=editor-emails:latest` (cria uma revisão nova) |
| Trocar o token do Notion | igual, com `notion-token` e `NOTION_TOKEN` |
| Publicar uma versão nova do código | repetir o `gcloud run deploy` do passo 3 |
| Voltar para a versão anterior | `gcloud run revisions list --service $SERVICE --region $REGION` e depois `gcloud run services update-traffic $SERVICE --region $REGION --to-revisions=REVISAO=100` |
| Campo renomeado ou criado no Notion | o dashboard avisa em `/api/health`. Um editor pode refazer o check pelo `POST /api/schema-check`. Se precisar, ajuste `server/notion/schema.js` e publique |
| Auditoria | cada gravação gera um log `notion.write` com e-mail, ação e páginas: `gcloud logging read 'jsonPayload.message="notion.write"' --limit 20` |

## Se algo der errado

- **"Build failed" com log vazio** (`gcloud builds log <ID>` não mostra nada): a conta de build está sem o papel `roles/run.builder`. Rode o último comando do passo 2 e repita o deploy. Para ver qual conta executou o build: `gcloud builds describe <ID> --region=$REGION --format='value(serviceAccount)'`.
- **"Secret Manager API has not been used… or it is disabled"** logo depois de ativar a API: é só a ativação ainda propagando. Espere alguns minutos e repita.
- **Página do Google dizendo que você não tem acesso:** a liberação do passo 4 leva alguns minutos para valer.
- **`--iap` não reconhecido:** atualize o gcloud ou use `gcloud beta run deploy … --iap`. Se a região não aceitar IAP direto, a alternativa documentada pelo Google é colocar o serviço atrás de um HTTPS Load Balancer com IAP. Nesse caso o app continua igual; só a audiência do JWT muda (ver abaixo).
- **Todo acesso dá 401 "JWT do IAP inválido":** procure nos logs `iap.audiencia_divergente`. Ele mostra a audiência que o IAP está mandando. Defina `--update-env-vars IAP_AUDIENCE=<valor recebido>` e publique.
- **Banner vermelho "Somente leitura":** o schema do Notion não bate com `server/notion/schema.js`. O banner e o `/api/health` dizem qual base e qual campo. Os casos mais comuns são uma base não conectada à integração (passo 1.3) ou um campo apagado.
- **"Não foi possível ler o Notion":** confira se o token no secret está certo e se a integração não foi removida das bases.
