# Deployment Guide

## Fly.io
1. Install the Fly CLI and log in: `fly auth signup` or `fly auth login`.
2. Create the app and volume: `fly launch --now --copy-config --copy-env` (the bundled `fly.toml` targets `/healthz`).
3. Supply secrets:
   ```bash
   fly secrets set REGISTRY_BROKER_API_URL=... REGISTRY_BROKER_API_KEY=...
   fly secrets set HEDERA_ACCOUNT_ID=... HEDERA_PRIVATE_KEY=...
   ```
4. Deploy: `fly deploy -c deploy/fly.toml`.
5. Configure Claude Code/Cursor with `https://<app>.fly.dev/mcp/stream`.

## Cloud Run (GCP)
1. Build the container:
   ```bash
   gcloud builds submit --tag gcr.io/PROJECT_ID/hashnet-mcp --config deploy/Dockerfile
   ```
2. Deploy the service:
   ```bash
   gcloud run deploy hashnet-mcp \
     --image gcr.io/PROJECT_ID/hashnet-mcp \
     --platform managed \
     --allow-unauthenticated \
     --set-env-vars PORT=3333 \
     --set-secrets REGISTRY_BROKER_API_KEY=projects/.../secrets/... \
     --region us-central1
   ```
3. Confirm `/healthz` returns `200` and wire clients to `https://hashnet-mcp-<region>.a.run.app/mcp/stream`.

Both platforms honor the same `.env` variables; enable rate limiting by setting the `BROKER_*` values and pointing Redis to a managed cache.
