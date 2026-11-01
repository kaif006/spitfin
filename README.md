# Spitfin

## Run locally

```sh
pnpm install
docker compose up -d postgres redis
pnpm dev
```

Open <http://localhost:5173> in two browsers (or one private window), sign in with a different account in each, and click "Find match".

Server: port 8080 (migrations run on start). Client: port 5173, proxying `/api` and `/ws` to the server.

## Checks

```sh
pnpm typecheck
pnpm test
```
