# HubSpot Marketing Director (Render + Node)

Services:
- apps/web   → Express web API (`/health`, `/reports/latest`)
- apps/worker → Background worker (weekly snapshot/report)

## Local structure
apps/
  web/
    package.json, index.js
  worker/
    package.json, index.js
packages/ (stubs to be added later)
db/
  schema.sql
.env.example  (copy values into Render env vars; do not commit a real .env)

## Deploy
1) Push this repo to GitHub
2) In Render:
   - Web Service root dir: apps/web
   - Worker root dir: apps/worker
   - Add environment variables (use .env.example as a guide)
   - Link the managed Postgres: set DATABASE_URL on both services (Internal DB URL)
