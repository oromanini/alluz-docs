#!/bin/bash
# =============================================================
# Setup GCP para deploy do nda-form no Cloud Run
# Execute este script no Cloud Shell do GCP:
#   https://console.cloud.google.com/cloudshell?project=docs-center-alluz-tech
# =============================================================

set -e

PROJECT_ID="docs-center-alluz-tech"
REGION="southamerica-east1"
REPO="alluz-docs"
SERVICE_ACCOUNT="github-actions"

echo "==> Configurando projeto: $PROJECT_ID"
gcloud config set project $PROJECT_ID

echo ""
echo "==> Ativando APIs necessárias..."
gcloud services enable \
  artifactregistry.googleapis.com \
  run.googleapis.com \
  iam.googleapis.com

echo ""
echo "==> Criando repositório no Artifact Registry ($REPO)..."
gcloud artifacts repositories create $REPO \
  --repository-format=docker \
  --location=$REGION \
  --description="Docker images - Alluz Tech" \
  2>/dev/null || echo "  (repositório já existe, continuando...)"

echo ""
echo "==> Criando service account ($SERVICE_ACCOUNT)..."
gcloud iam service-accounts create $SERVICE_ACCOUNT \
  --display-name="GitHub Actions Deploy" \
  --description="Usado pelo GitHub Actions para build e deploy" \
  2>/dev/null || echo "  (service account já existe, continuando...)"

SA_EMAIL="${SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com"

echo ""
echo "==> Concedendo permissões ao service account..."

# Escrever no Artifact Registry
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/artifactregistry.writer" \
  --quiet

# Administrar o Cloud Run
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.admin" \
  --quiet

# Usar service accounts (necessário para o Cloud Run deploy)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser" \
  --quiet

echo ""
echo "==> Gerando chave JSON do service account..."
gcloud iam service-accounts keys create sa-key.json \
  --iam-account=$SA_EMAIL

echo ""
echo "============================================================"
echo "PRONTO! Agora adicione os seguintes secrets no GitHub:"
echo "https://github.com/oromanini/alluz-docs/settings/secrets/actions"
echo ""
echo "GCP_SERVICE_ACCOUNT_KEY  → conteúdo do arquivo sa-key.json abaixo:"
echo "--------------------------------------------------------------------"
cat sa-key.json
echo "--------------------------------------------------------------------"
echo ""
echo "Demais secrets necessários:"
echo ""
echo "  DB_HOST               = srv1197.hstgr.io"
echo "  DB_USER               = u441227450_alluz_tech"
echo "  DB_PASSWORD           = (senha do banco)"
echo "  DB_NAME               = u441227450_tech_docs"
echo "  SMTP_USER             = (email SMTP Hostinger)"
echo "  SMTP_PASS             = (senha SMTP Hostinger)"
echo "  JWT_SECRET            = (string longa e aleatória)"
echo "  ADMIN_USERNAME        = admin"
echo "  ADMIN_PASSWORD_HASH   = (hash bcrypt da senha admin)"
echo "  DOCUSEAL_API_KEY      = (opcional, deixe vazio se não usar)"
echo ""
echo "Para gerar o JWT_SECRET:"
echo "  node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\""
echo ""
echo "Para gerar o ADMIN_PASSWORD_HASH:"
echo "  node -e \"require('bcrypt').hash('SUA_SENHA',10).then(console.log)\""
echo ""
echo "Após adicionar os secrets, faça push para main e o deploy roda automaticamente."
echo "============================================================"

# Limpa a chave do disco (já foi exibida)
rm -f sa-key.json
