# AmbikaShelf Portfolio Search + WorldChat MCP adapter

A small stateless Streamable HTTP MCP server that exposes three public asset-search tools plus WorldChat username lookup and public-room posting. The WorldChat write tool posts as the AmbikaShelf bot and @mentions the selected username; it does not impersonate the user.

## Tools

- `search_stocks({ query })` → `GET /api/portfolio/proxy/stock-search?q=...` → `{ results: [{ symbol, name, exchange }] }`
- `search_mutual_funds({ query })` → `GET /api/portfolio/proxy/mf-search?q=...` → `{ results: [{ schemeCode, name }] }`
- `search_crypto({ query })` → `GET /api/portfolio/proxy/crypto-search?q=...` → `{ results: [{ id, name, symbol }] }`
- `search_worldchat_users({ query })` → `GET /api/notify/users` and filters registered notification names. This list may not include every WorldChat account.
- `send_worldchat_message({ recipient_name, message })` → revalidates the recipient, then uses Socket.IO `join` + `sendMessage` to post `@recipient message` to the existing public room as `AmbikaShelf`.

Asset queries must be 2–80 characters. MCP requests are rate-limited to 60 per IP per minute. Asset search remains read-only. WorldChat sending is a public write action: explain that the message is public, resolve the intended username with `search_worldchat_users`, refine the draft, then call `send_worldchat_message`. The sender shown in chat is `AmbikaShelf`, not the human user. The current chat server does not acknowledge delivery/read status; success means submitted to the connected Socket.IO server. User lookup is based on push-notification subscriber names and may not cover all accounts. The adapter does not expose portfolio holdings or mutations.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
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

The adapter is not deployed by creating this source package. The actual service URL must be verified before adding it to the ChatGPT plugin's `mcp.json`. This adapter uses `AMBIKASHELF_API_BASE_URL` for both existing REST routes and the Socket.IO WorldChat server.

## Security notes

- Asset search only calls public search routes; no account or portfolio records are requested.
- The WorldChat send tool posts publicly as the `AmbikaShelf` bot and can trigger public @mention notifications. Use it only for messages the user intends to publish publicly.
- `MCP_API_KEY` can enforce bearer authentication if the MCP client is configured to send that header. Do not set it until that client authentication path is confirmed, or the client will receive HTTP 401.
- The first test can run without a key because the upstream endpoints are public search endpoints; keep rate limiting enabled and avoid adding private holdings endpoints.
- Do not commit `.env` or API keys.
