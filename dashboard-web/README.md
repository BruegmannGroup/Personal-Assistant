# Momentum Dashboard (frontend)

React + Vite app for the browser recording dashboard — see the "Browser recording dashboard"
section in the repo root [README.md](../README.md) for full setup. Talks to the Cloudflare
Worker in [../worker](../worker) for everything (Smartsheet reads/writes, Gemini calls); this
app holds no secrets and can be safely hosted as a static site.

## Local development

```
cp .env.example .env   # fill in VITE_WORKER_URL
npm install
npm run dev
```

## Build

```
npm run build   # outputs dist/, deployed by .github/workflows/deploy-dashboard.yml
```
