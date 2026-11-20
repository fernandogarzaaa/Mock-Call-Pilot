#!/usr/bin/env bash
# Deploy the mock-call pilot to Cloud Run. Usage: deploy.sh PROJECT REGION MODE
# Secret values come from ANTHROPIC_API_KEY, ELEVENLABS_API_KEY and ACCESS_CODE. This script
# creates and updates things; it never deletes anything.
set -euo pipefail

usage() {
  echo "usage: deploy.sh PROJECT REGION MODE   (MODE is live or demo)" >&2
  exit 2
}

[ "$#" -eq 3 ] || usage
PROJECT=$1
REGION=$2
MODE=$3

# These values end up in resource names and a JSON file, so refuse anything unexpected.
printf '%s' "$PROJECT" | grep -Eq '^[a-z][a-z0-9-]{4,28}[a-z0-9]$' || usage
printf '%s' "$REGION" | grep -Eq '^[a-z]+-[a-z]+[0-9]+$' || usage
case "$MODE" in live | demo) ;; *) usage ;; esac

cd "$(dirname "$0")/.."

SERVICE=mock-call
SA_NAME=mock-call-run
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
BUCKET="$PROJECT-mock-call-sessions"
PILOT_CONFIG=${PILOT_CONFIG:-config/pilot.json}
RETRY_DELAY=${RETRY_DELAY:-5}
SECRETS="anthropic-key:ANTHROPIC_API_KEY elevenlabs-key:ELEVENLABS_API_KEY access-code:ACCESS_CODE"

# IAM changes can lag a freshly created resource, so retry a few times before giving up.
retry() {
  attempt=1
  until "$@"; do
    if [ "$attempt" -ge 5 ]; then
      echo "failed after $attempt attempts: $*" >&2
      return 1
    fi
    attempt=$((attempt + 1))
    sleep "$RETRY_DELAY"
  done
}

# Value of the env var named by $1, or empty. The name comes from SECRETS above, never from input.
env_value() {
  eval "printf '%s' \"\${$1:-}\""
}

# Read retention before touching anything, so a live deploy with the gap open changes nothing.
RETENTION=$(node -p 'JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).gaps.retentionDays)' "$PILOT_CONFIG")
if [ "$RETENTION" = "null" ]; then
  if [ "$MODE" = "live" ]; then
    echo "gaps.retentionDays in $PILOT_CONFIG is null; MODE=live will not deploy without it" >&2
    exit 1
  fi
  echo "warning: gaps.retentionDays is null, so the bucket gets no deletion rule" >&2
elif ! printf '%s' "$RETENTION" | grep -Eq '^[1-9][0-9]*$'; then
  echo "gaps.retentionDays in $PILOT_CONFIG must be null or a positive whole number, got: $RETENTION" >&2
  exit 1
fi

echo "1/8 enabling APIs"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  --project "$PROJECT"

echo "2/8 secrets"
missing=""
for pair in $SECRETS; do
  name=${pair%%:*}
  var=${pair#*:}
  if [ -z "$(env_value "$var")" ] && ! gcloud secrets describe "$name" --project "$PROJECT" >/dev/null 2>&1; then
    missing="$missing $var"
  fi
done
if [ -n "$missing" ]; then
  echo "missing and not yet stored in Secret Manager:$missing" >&2
  exit 1
fi
for pair in $SECRETS; do
  name=${pair%%:*}
  var=${pair#*:}
  if ! gcloud secrets describe "$name" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud secrets create "$name" --replication-policy automatic --project "$PROJECT"
  fi
  if [ -n "$(env_value "$var")" ]; then
    env_value "$var" | gcloud secrets versions add "$name" --data-file=- --project "$PROJECT"
  fi
done

echo "3/8 service account $SA"
if ! gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --display-name "Mock call pilot" --project "$PROJECT"
fi
retry gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --member "serviceAccount:$SA" --role roles/iam.serviceAccountTokenCreator \
  --project "$PROJECT" >/dev/null
for pair in $SECRETS; do
  retry gcloud secrets add-iam-policy-binding "${pair%%:*}" \
    --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor \
    --project "$PROJECT" >/dev/null
done

echo "4/8 build permission for the default compute service account"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format 'value(projectNumber)')
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member "serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role roles/run.builder --condition=None >/dev/null

echo "5/8 bucket gs://$BUCKET"
if ! gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT" --location "$REGION" \
    --uniform-bucket-level-access --public-access-prevention
fi
retry gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member "serviceAccount:$SA" --role roles/storage.objectUser >/dev/null

echo "6/8 retention"
if [ "$RETENTION" != "null" ]; then
  LIFECYCLE=$(mktemp "${TMPDIR:-/tmp}/mock-call-lifecycle.XXXXXX")
  trap 'rm -f "$LIFECYCLE"' EXIT
  printf '{"rule":[{"action":{"type":"Delete"},"condition":{"age":%s}}]}\n' "$RETENTION" >"$LIFECYCLE"
  gcloud storage buckets update "gs://$BUCKET" --lifecycle-file="$LIFECYCLE" --project "$PROJECT"
fi

echo "7/8 deploying $SERVICE"
gcloud run deploy "$SERVICE" --source . --region "$REGION" --project "$PROJECT" \
  --service-account "$SA" \
  --allow-unauthenticated --concurrency 40 --max-instances 5 \
  --set-env-vars "MODE=$MODE,STORAGE=gcs,BUCKET=$BUCKET,STT=scribe,PICKER=claude,SCRIBE_MODEL=scribe_v1" \
  --set-secrets "ANTHROPIC_API_KEY=anthropic-key:latest,ELEVENLABS_API_KEY=elevenlabs-key:latest,ACCESS_CODE=access-code:latest" \
  --quiet

echo "8/8 checking the public URL"
URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format 'value(status.url)')
status=000
for attempt in 1 2 3; do
  status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$URL/healthz" || true)
  [ "$status" = "200" ] && break
  [ "$attempt" -lt 3 ] && sleep "$RETRY_DELAY"
done
if [ "$status" = "403" ]; then
  echo "$URL/healthz answered 403: the public (allUsers) binding was refused." >&2
  echo "Usually the organization policy iam.allowedPolicyMemberDomains blocks it." >&2
  echo "The service is deployed but candidates and reviewers cannot reach it." >&2
  exit 1
fi
if [ "$status" != "200" ]; then
  echo "$URL/healthz answered $status, expected 200" >&2
  exit 1
fi
echo "deployed: $URL"
