# Deploy no GCP — Cloud Run + IAP (login Google)

Guia passo a passo para colocar o Dashboard Tático P&D no projeto GCP da BSV. Resultado: uma URL do Cloud Run protegida pelo **Identity-Aware Proxy (IAP)**:
- **Quem acessa:** qualquer conta `@bsvrobotics.com.br` entra e **lê**.
- **Quem grava:** só os e-mails listados no secret `editor-emails` **gravam** no Notion.

> **Conferir antes de rodar.** Os comandos do IAP direto no Cloud Run (flag `--iap`, `gcloud iap web … --resource-type=cloud-run`) vieram da documentação do Google por busca: a página oficial estava bloqueada no ambiente onde este guia foi escrito. O recurso é GA desde mar/2026. Se algum comando for recusado, veja a seção [Se algo der errado](#se-algo-der-errado).

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

1. Em <https://www.notion.so/profile/integrations>, crie uma **integração interna** chamada "Dashboard Tático P&D".
   Use uma integração exclusiva do dashboard: o limite de ~3 req/s do Notion é por token.
2. Capacidades:
   - **Conteúdo:** ler, atualizar e inserir.
   - **Usuários:** ler informações *sem* e-mail (para mostrar o nome dos responsáveis).
3. Em cada uma das 9 bases abaixo, abra o menu `•••` → **Conexões** → adicione a integração:
   🏁 Metas da Sprint · 🎯 OKRs Táticos · 📈 Evolução de KPIs · 🤖 Projetos, Sistemas e Subsistemas · 🏃 Sprints · ✅ Lista de Tarefas · 🔼 Diretorias e Áreas Funcionais · 📜 Desejos e Expectativas · 📋 Requisitos
4. Copie o token (`secret_…` ou `ntn_…`) e teste localmente:
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

# token do Notion e lista de quem grava (e-mails separados por vírgula)
printf '%s' 'COLE_O_TOKEN_DO_NOTION' | gcloud secrets create notion-token --data-file=-
printf '%s' 'lider1@bsvrobotics.com.br,lider2@bsvrobotics.com.br' | gcloud secrets create editor-emails --data-file=-

# conta de serviço do app (só lê os dois secrets)
gcloud iam service-accounts create tatico-pd-run --display-name="Dashboard tático P&D"
SA=tatico-pd-run@$PROJECT_ID.iam.gserviceaccount.com
for s in notion-token editor-emails; do
  gcloud secrets add-iam-policy-binding $s --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
done
```

## 3. Deploy

Na raiz do repositório (o Cloud Build usa o `Dockerfile`):

```bash
gcloud run deploy $SERVICE --source . --region $REGION \
  --service-account $SA \
  --no-allow-unauthenticated --iap \
  --min-instances 1 --max-instances 1 --cpu-boost --timeout 900 \
  --set-env-vars AUTH_MODE=iap,NOTION_MODE=live \
  --set-secrets NOTION_TOKEN=notion-token:latest,EDITOR_EMAILS=editor-emails:latest
```

Por que essas flags:
- `--max-instances 1`: o cache do snapshot e a fila de gravações ficam numa instância só (são ~10 líderes).
- `--min-instances 1`: evita a espera da primeira abertura. Para economizar, use `0`; o primeiro acesso depois de um tempo parado leva alguns segundos.
- `--timeout 900`: o rollover grava ~100–200 itens a ~3 req/s e mostra o progresso na tela.
- `--iap`: liga o login Google na frente do serviço.

## 4. Permissões do IAP

```bash
# identidade do IAP no projeto e permissão para ele chamar o Cloud Run
gcloud beta services identity create --service=iap.googleapis.com --project=$PROJECT_ID
gcloud run services add-iam-policy-binding $SERVICE --region $REGION \
  --member=serviceAccount:service-$PROJECT_NUMBER@gcp-sa-iap.iam.gserviceaccount.com \
  --role=roles/run.invoker

# quem pode abrir o dashboard: todo o domínio
gcloud iap web add-iam-policy-binding --resource-type=cloud-run --service=$SERVICE --region=$REGION \
  --member=domain:bsvrobotics.com.br --role=roles/iap.httpsResourceAccessor --condition=None
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

- **`--iap` não reconhecido:** atualize o gcloud ou use `gcloud beta run deploy … --iap`. Se a região não aceitar IAP direto, a alternativa documentada pelo Google é colocar o serviço atrás de um HTTPS Load Balancer com IAP. Nesse caso o app continua igual; só a audiência do JWT muda (ver abaixo).
- **Todo acesso dá 401 "JWT do IAP inválido":** procure nos logs `iap.audiencia_divergente`. Ele mostra a audiência que o IAP está mandando. Defina `--update-env-vars IAP_AUDIENCE=<valor recebido>` e publique.
- **Banner vermelho "Somente leitura":** o schema do Notion não bate com `server/notion/schema.js`. O banner e o `/api/health` dizem qual base e qual campo. Os casos mais comuns são uma base não conectada à integração (passo 1.3) ou um campo apagado.
- **"Não foi possível ler o Notion":** confira se o token no secret está certo e se a integração não foi removida das bases.
