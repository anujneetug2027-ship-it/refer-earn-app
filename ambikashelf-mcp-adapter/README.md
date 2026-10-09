# AmbikaShelf Portfolio Search MCP adapter

A small stateless Streamable HTTP MCP server that exposes only three read-only search tools and forwards them to the existing AmbikaShelf deployment.

## Tools

- `search_stocks({ query })` → `GET /api/portfolio/proxy/stock-search?q=...` → `{ results: [{ symbol, name, exchange }] }`
- `search_mutual_funds({ query })` → `GET /api/portfolio/proxy/mf-search?q=...` → `{ results: [{ schemeCode, name }] }`
- `search_crypto({ query })` → `GET /api/portfolio/proxy/crypto-search?q=...` → `{ results: [{ id, name, symbol }] }`

Queries must be 2–80 characters. Requests are read-only, rate-limited to 60 requests per IP per minute, and upstream calls time out after 12 seconds. The adapter does **not** expose `/holdings`, `/gains`, `/add`, `/update`, or `/remove`.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env
npm start
```

Health check: `GET http://localhost:3000/health`
MCP endpoint: `POST http://localhost:3000/mcp`

## Deploy as a separate Render Web Service

1. Push this folder to a repository or branch.
2. Create a Render **Web Service** for that repository and set **Root Directory** to `ambikashelf-mcp-adapter` (if the folder is at repository root) or to the actual folder path.
3. Build command: `npm install`
4. Start command: `npm start`
5. Environment variable: `AMBIKASHELF_API_BASE_URL=https://refer-earn-app.onrender.com`
6. After deploy, verify `/health` and then connect the MCP URL `https://YOUR-SERVICE.onrender.com/mcp`.

The adapter is not deployed by creating this source package. The actual service URL must be verified before adding it to the ChatGPT plugin's `mcp.json`.

## Security notes

- Only public asset-search routes are called; no account or portfolio records are requested.
- `MCP_API_KEY` can enforce bearer authentication if the MCP client is configured to send that header. Do not set it until that client authentication path is confirmed, or the client will receive HTTP 401.
- The first test can run without a key because the upstream endpoints are public search endpoints; keep rate limiting enabled and avoid adding private holdings endpoints.
- Do not commit `.env` or API keys.
