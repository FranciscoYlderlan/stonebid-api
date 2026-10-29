# Guia de deploy do Stonebid (GCP + Vercel)

Backend e banco no Google Cloud (Cloud Run + Cloud SQL), frontend na Vercel. Nada é publicado à mão: o GitHub Actions publica depois do CI verde. `main` = produção, `staging` = staging.

## 1. Criar o projeto no GCP

1. Entre em https://console.cloud.google.com com a conta Google e aceite o teste gratuito (US$ 300 por 90 dias). O cartão só confirma identidade.
2. Crie um projeto novo (ex.: `stonebid-2026`). Anote o **ID do projeto** (aparece abaixo do nome; pode ser diferente do nome).
3. Confira em **Faturamento** que o projeto está ligado à conta de faturamento do teste. Anote o **ID da conta de faturamento** (formato `0123AB-4567CD-89EF01`).

## 2. Rodar o script no Cloud Shell

1. No console, clique no ícone **>_** (Ativar Cloud Shell), no alto à direita.
2. Envie o `gcp-setup.sh` (menu **⋮ > Fazer upload**) ou crie com `nano gcp-setup.sh` e cole o conteúdo.
3. Rode, trocando os valores:
   ```bash
   PROJECT_ID=stonebid-2026 BILLING_ACCOUNT=0123AB-4567CD-89EF01 bash gcp-setup.sh
   ```
4. Espere (o Cloud SQL leva ~10 minutos). Se cair no meio, rode o mesmo comando de novo: ele pula o que já existe.
5. No fim, ele imprime o bloco **"Cole no GitHub"**. Deixe a aba aberta e guarde a `MCP_API_KEY_STAGING` (é a chave do conector MCP de staging).

## 3. Secrets e variables do `stonebid-api`

No GitHub: `stonebid-api` > **Settings > Secrets and variables > Actions**.

1. Aba **Secrets** > **New repository secret**, um por linha do bloco do script: `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `GCP_RUNTIME_SA`, `CLOUDSQL_CONNECTION`.
2. Aba **Variables** > **New repository variable**:
   - `CORS_ORIGIN` = `https://stonebid-web.vercel.app` (a URL de produção da Vercel, passo 5).
   - `CORS_ORIGIN_STAGING` = `https://stonebid-web-staging.vercel.app` (o alias de staging, passo 5). Mais de uma origem: separe por vírgula.
3. Copie `api-cd.yml` para `.github/workflows/cd.yml` no `stonebid-api`. O workflow de CI precisa se chamar exatamente `name: CI`.

## 4. Projeto na Vercel

1. Em https://vercel.com, **Add New > Project**, importe o repositório `stonebid-web` (preset Vite). O nome do projeto: `stonebid-web`.
2. **Desligue o deploy automático pelo Git**, para só publicar depois do CI verde. Isso é uma mudança **no repositório do web**: no `vercel.json`, junto do rewrite da SPA, acrescente:
   ```json
   "git": { "deploymentEnabled": false }
   ```
3. Em **Settings > Deployment Protection**, desligue a **Vercel Authentication** dos previews, senão o staging pede login da Vercel a quem abrir. [a confirmar o nome exato da opção no painel]
4. Crie o token em **Account Settings > Tokens** (escopo: sua conta/time).
5. Pegue os IDs: `VERCEL_ORG_ID` em **Account/Team Settings > General** (Team ID ou User ID) e `VERCEL_PROJECT_ID` em **Project > Settings > General** (Project ID). Outra forma: `npx vercel link` na pasta do web cria `.vercel/project.json` com os dois (não commite essa pasta).

## 5. Secrets e variables do `stonebid-web`

`stonebid-web` > **Settings > Secrets and variables > Actions**.

1. **Secrets:** `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
2. **Variables:**
   - `VITE_API_URL` = URL do serviço `stonebid-api` (aparece no resumo do primeiro deploy da API na `main`, formato `https://stonebid-api-xxxx.southamerica-east1.run.app`).
   - `VITE_API_URL_STAGING` = URL do `stonebid-api-staging`.
   - `VERCEL_STAGING_ALIAS` = `stonebid-web-staging.vercel.app` (alias fixo do preview de staging; tem de estar livre na Vercel) [a confirmar disponibilidade].
3. Copie `web-cd.yml` para `.github/workflows/cd.yml` no `stonebid-web`.

Ordem que funciona: deploy da API primeiro (pega a URL) > `VITE_API_URL*` no web > deploy do web > confira se as URLs da Vercel batem com `CORS_ORIGIN*` da API (se mudar, ajuste a variável e rode o CD da API de novo).

## 6. Criar a branch `staging` nos dois repos

```bash
git checkout main && git pull
git checkout -b staging && git push -u origin staging
```

## 7. Ver o deploy rodando

1. Faça push na `main` ou na `staging`. Na aba **Actions** do repo, o **CI** roda; quando fica verde, o **CD** começa sozinho.
2. Abra a execução do CD: o **Summary** mostra a URL publicada.
3. Na API, o passo "Migração e seed" roda um Cloud Run Job; o log dele fica no console GCP em **Cloud Run > Jobs**.
4. Teste: `curl https://<url-da-api>/health` [a confirmar a rota de saúde].
5. Para rodar o CD de novo sem commit: Actions > CI > **Re-run all jobs**.

## 8. Excluir tudo depois da avaliação

1. GCP: **IAM e administrador > Configurações > Encerrar** (ou `gcloud projects delete <PROJECT_ID>`). Derruba Cloud Run, Cloud SQL, imagens e segredos de uma vez. Fica 30 dias em exclusão pendente, sem cobrança.
2. Vercel: projeto `stonebid-web` > **Settings > General > Delete Project**. Revogue o token em **Account Settings > Tokens**.
3. GitHub: apague os secrets dos dois repos (opcional, já não servem para nada).

## Custos e escolhas

- Produção: 1 instância sempre ligada e CPU sempre alocada (sem cold start, agendador da liquidação rodando). Staging: 0 instâncias mínimas para economizar; a primeira requisição depois de parado demora alguns segundos e o agendador só roda enquanto houver requisição.
- Usuários de teste: senha `stonebid123` (segredo `SEED_PASSWORD`), listados no README da API.
