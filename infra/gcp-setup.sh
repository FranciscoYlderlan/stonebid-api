#!/usr/bin/env bash
# Stonebid: prepara o projeto GCP para o CD do stonebid-api.
# Uso: cole no Cloud Shell de um projeto novo com faturamento (crédito) ligado.
# Pode rodar de novo: cada passo checa se o recurso já existe antes de criar.
set -euo pipefail

# ===== Variáveis (edite antes de rodar) ======================================
PROJECT_ID="${PROJECT_ID:-coloque-o-id-do-projeto}"
REGION="${REGION:-southamerica-east1}"
GITHUB_OWNER="${GITHUB_OWNER:-FranciscoYlderlan}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:-}"   # opcional (ex.: 0123AB-4567CD-89EF01): cria o alerta de US$ 50
# =============================================================================

API_REPO="stonebid-api"
AR_REPO="stonebid"
SQL_INSTANCE="stonebid-db"
DB_PROD="stonebid"
DB_STAGING="stonebid_staging"
DB_USER="stonebid"
SEED_PASSWORD_VALUE="stonebid123"
RUNTIME_SA_NAME="stonebid-runtime"
DEPLOY_SA_NAME="stonebid-deploy"
WIF_POOL="github"
WIF_PROVIDER="github"

log() { printf '\n==> %s\n' "$*"; }

if [[ "$PROJECT_ID" == "coloque-o-id-do-projeto" ]]; then
  echo "Edite PROJECT_ID no topo do script (ou rode: PROJECT_ID=meu-projeto bash gcp-setup.sh)." >&2
  exit 1
fi

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_SA="${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="${DEPLOY_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# ----- 1. APIs ----------------------------------------------------------------
log "Ativando APIs (pode levar alguns minutos)"
gcloud services enable \
  run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com iam.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com billingbudgets.googleapis.com cloudresourcemanager.googleapis.com

# ----- 2. Artifact Registry ----------------------------------------------------
log "Artifact Registry '$AR_REPO'"
if ! gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$AR_REPO" --repository-format=docker \
    --location="$REGION" --description="Imagens do Stonebid"
else
  echo "já existe"
fi

# ----- 3. Cloud SQL ------------------------------------------------------------
log "Cloud SQL '$SQL_INSTANCE' (PostgreSQL 16, db-f1-micro, ~10 min na primeira vez)"
if ! gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1; then
  gcloud sql instances create "$SQL_INSTANCE" \
    --database-version=POSTGRES_16 --edition=ENTERPRISE --tier=db-f1-micro \
    --region="$REGION" --storage-size=10 --storage-auto-increase \
    --availability-type=zonal
else
  echo "já existe"
fi
CLOUDSQL_CONNECTION="$(gcloud sql instances describe "$SQL_INSTANCE" --format='value(connectionName)')"

for db in "$DB_PROD" "$DB_STAGING"; do
  if ! gcloud sql databases describe "$db" --instance="$SQL_INSTANCE" >/dev/null 2>&1; then
    gcloud sql databases create "$db" --instance="$SQL_INSTANCE"
  else
    echo "banco $db já existe"
  fi
done

# ----- 4. Segredos -------------------------------------------------------------
secret_exists() { gcloud secrets describe "$1" >/dev/null 2>&1; }
secret_read()   { gcloud secrets versions access latest --secret="$1"; }
secret_create() { # nome valor (só cria se não existir; nunca troca o valor)
  if secret_exists "$1"; then
    echo "segredo $1 já existe (mantido)"
  else
    printf '%s' "$2" | gcloud secrets create "$1" --replication-policy=automatic --data-file=-
  fi
}
rand_hex() { openssl rand -hex "$1"; }   # hex: seguro dentro da URL do banco

log "Usuário do banco e segredos"
# A senha do banco fica no próprio Secret Manager: rodar de novo reaproveita a mesma.
if secret_exists DB_PASSWORD; then
  DB_PASSWORD="$(secret_read DB_PASSWORD)"
else
  DB_PASSWORD="$(rand_hex 24)"
  secret_create DB_PASSWORD "$DB_PASSWORD"
fi
if gcloud sql users list --instance="$SQL_INSTANCE" --format='value(name)' | grep -qx "$DB_USER"; then
  gcloud sql users set-password "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASSWORD"
else
  gcloud sql users create "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASSWORD"
fi

db_url() { printf 'postgresql://%s:%s@localhost/%s?host=/cloudsql/%s' "$DB_USER" "$DB_PASSWORD" "$1" "$CLOUDSQL_CONNECTION"; }
secret_create DATABASE_URL         "$(db_url "$DB_PROD")"
secret_create DATABASE_URL_STAGING "$(db_url "$DB_STAGING")"
secret_create JWT_SECRET           "$(rand_hex 32)"
secret_create JWT_SECRET_STAGING   "$(rand_hex 32)"
secret_create SEED_PASSWORD        "$SEED_PASSWORD_VALUE"
secret_create MCP_API_KEY_STAGING  "$(rand_hex 24)"

# ----- 5. Contas de serviço ----------------------------------------------------
log "Contas de serviço"
for sa in "$RUNTIME_SA_NAME:Stonebid runtime (Cloud Run)" "$DEPLOY_SA_NAME:Stonebid deploy (GitHub Actions)"; do
  name="${sa%%:*}"; display="${sa#*:}"
  if ! gcloud iam service-accounts describe "${name}@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$name" --display-name="$display"
  else
    echo "$name já existe"
  fi
done

bind_project() { # membro papel (add-iam-policy-binding já é idempotente)
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="$1" --role="$2" \
    --condition=None --quiet >/dev/null
  echo "ok: $2 -> $1"
}
for role in roles/cloudsql.client roles/secretmanager.secretAccessor; do
  bind_project "serviceAccount:$RUNTIME_SA" "$role"
done
for role in roles/run.admin roles/artifactregistry.writer roles/cloudsql.client roles/secretmanager.secretAccessor; do
  bind_project "serviceAccount:$DEPLOY_SA" "$role"
done
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/iam.serviceAccountUser --quiet >/dev/null
echo "ok: deploy pode agir como runtime"

# ----- 6. Workload Identity Federation (GitHub Actions sem chave JSON) ---------
log "Workload Identity Federation"
if ! gcloud iam workload-identity-pools describe "$WIF_POOL" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$WIF_POOL" --location=global --display-name="GitHub Actions"
else
  echo "pool já existe"
fi
if ! gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER" \
     --workload-identity-pool="$WIF_POOL" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" \
    --workload-identity-pool="$WIF_POOL" --location=global \
    --display-name="GitHub OIDC" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
    --attribute-condition="assertion.repository_owner=='${GITHUB_OWNER}'"
else
  echo "provider já existe"
fi
WIF_POOL_NAME="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}"
GCP_WIF_PROVIDER="${WIF_POOL_NAME}/providers/${WIF_PROVIDER}"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/${WIF_POOL_NAME}/attribute.repository/${GITHUB_OWNER}/${API_REPO}" \
  --quiet >/dev/null
echo "ok: só ${GITHUB_OWNER}/${API_REPO} pode usar a conta de deploy"

# ----- 7. Alerta de orçamento --------------------------------------------------
if [[ -n "$BILLING_ACCOUNT" ]]; then
  log "Alerta de orçamento US\$ 50"
  if gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" \
       --format='value(displayName)' | grep -qx "stonebid-budget"; then
    echo "já existe"
  else
    # A moeda precisa ser a da conta de faturamento; se der erro de moeda, troque 50USD por 250BRL.
    gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
      --display-name="stonebid-budget" --budget-amount=50USD \
      --filter-projects="projects/${PROJECT_NUMBER}" \
      --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
  fi
else
  log "BILLING_ACCOUNT vazio: alerta de orçamento não criado (crie no console: Faturamento > Orçamentos e alertas)"
fi

# ----- 8. Saída para o GitHub --------------------------------------------------
cat <<EOF

=====================================================================
Pronto. Cole no GitHub: stonebid-api > Settings > Secrets and variables
> Actions > aba "Secrets" > New repository secret (nome = valor):

GCP_PROJECT_ID = ${PROJECT_ID}
GCP_REGION = ${REGION}
GCP_WIF_PROVIDER = ${GCP_WIF_PROVIDER}
GCP_DEPLOY_SA = ${DEPLOY_SA}
GCP_RUNTIME_SA = ${RUNTIME_SA}
CLOUDSQL_CONNECTION = ${CLOUDSQL_CONNECTION}

Guarde (não vai para o GitHub; é a chave do conector MCP de staging):
MCP_API_KEY_STAGING = $(secret_read MCP_API_KEY_STAGING)
=====================================================================
EOF
