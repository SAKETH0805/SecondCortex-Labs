# Azure OpenAI Cutover and Rollback Runbook

## Pre-cutover (T-24h)

1. Confirm Azure RBAC on target Azure OpenAI resource:
   - Backend managed identity has `Cognitive Services OpenAI User`.
2. Confirm all task deployments exist:
   - `AZURE_OPENAI_DEPLOYMENT_RETRIEVER`
   - `AZURE_OPENAI_DEPLOYMENT_PLANNER`
   - `AZURE_OPENAI_DEPLOYMENT_EXECUTOR`
   - `AZURE_OPENAI_DEPLOYMENT_SIMULATOR`
   - `AZURE_OPENAI_DEPLOYMENT_ARCHAEOLOGY`
   - `AZURE_OPENAI_DEPLOYMENT_EMBEDDINGS`
3. Configure app settings for:
   - `LLM_PROVIDER_DEFAULT=azure_openai`
   - `AZURE_OPENAI_BASE_URL`
   - `AZURE_OPENAI_AUTH_MODE=managed_identity_then_key`
   - `AZURE_OPENAI_CLIENT_ID`
   - `AZURE_OPENAI_API_KEY` (fallback)
   - `AZURE_OPENAI_TOKEN_SCOPE=https://ai.azure.com/.default`
4. Stage rollback env values:
   - `LLM_FALLBACK_PROVIDER_*` per task.

## Pre-cutover (T-2h)

1. Deploy backend build.
2. Check startup logs for:
   - `LLM startup validation passed.`
3. Verify health:
   - `GET /health` returns 200.

## Cutover (T0)

1. Set/confirm `LLM_PROVIDER_DEFAULT=azure_openai`.
2. Restart backend.
3. Run smoke checks:
   - `POST /api/v1/snapshot`
   - `POST /api/v1/query`
   - `POST /api/v1/decision-archaeology`
   - `POST /api/v1/resurrect`

## First 15 Minutes Validation

1. Watch logs for each task:
   - `task=retriever`
   - `task=planner`
   - `task=executor`
   - `task=simulator`
   - `task=archaeology`
   - `task=embeddings`
2. Ensure no sustained fallback spikes:
   - `fallback_used` should stay near zero in normal operation.
3. Validate error and latency thresholds:
   - 5xx rate not above baseline
   - p95 latency not above baseline target for your environment
   - repeated 429s not sustained after retry windows

## Rollback

1. For affected tasks, set provider overrides back to previous provider:
   - e.g. `LLM_PROVIDER_PLANNER=groq`
2. Restart backend.
3. Re-run smoke checks.
4. Keep Azure settings intact so re-cutover is config-only later.
