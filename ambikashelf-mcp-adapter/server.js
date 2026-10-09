'use strict';

const express = require('express');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_BASE_URL = (process.env.AMBIKASHELF_API_BASE_URL || 'https://refer-earn-app.onrender.com').replace(/\/$/, '');
const MCP_API_KEY = process.env.MCP_API_KEY || '';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateBuckets = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start >= RATE_LIMIT_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    res.set('Retry-After', '60');
    return res.status(429).json({ error: 'Rate limit exceeded; retry in one minute.' });
  }
  // Periodically discard old entries so the map cannot grow forever.
  if (rateBuckets.size > 1000) {
    for (const [ip, value] of rateBuckets) {
      if (now - value.start >= RATE_LIMIT_WINDOW_MS) rateBuckets.delete(ip);
    }
  }
  next();
}

function requireOptionalBearer(req, res, next) {
  // Configure MCP_API_KEY in the host to enable bearer authentication.
  // Leave it unset for the initial public-search-only test if the MCP client
  // connection flow has not been configured to supply a bearer token.
  if (!MCP_API_KEY) return next();
  const supplied = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (supplied !== MCP_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

async function searchEndpoint(path, query) {
  const url = new URL(`${API_BASE_URL}/api/portfolio/proxy/${path}`);
  url.searchParams.set('q', query);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`AmbikaShelf API returned HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.results)) {
      throw new Error('AmbikaShelf API returned an unexpected response schema');
    }
    return payload.results;
  } finally {
    clearTimeout(timeout);
  }
}

function createMcpServer() {
  const server = new McpServer({
    name: 'ambikashelf-portfolio-search',
    version: '0.1.0'
  });

  const querySchema = { query: z.string().trim().min(2).max(80).describe('Asset name, symbol, or search phrase (2–80 characters).') };

  server.tool(
    'search_stocks',
    'Search publicly available Indian stock listings using AmbikaShelf. Read-only; returns symbol, company name, and exchange.',
    querySchema,
    async ({ query }) => {
      try {
        const results = await searchEndpoint('stock-search', query);
        return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `Stock search failed: ${error.message}` }] };
      }
    }
  );

  server.tool(
    'search_mutual_funds',
    'Search mutual fund schemes using AmbikaShelf. Read-only; returns scheme code and scheme name.',
    querySchema,
    async ({ query }) => {
      try {
        const results = await searchEndpoint('mf-search', query);
        return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `Mutual fund search failed: ${error.message}` }] };
      }
    }
  );

  server.tool(
    'search_crypto',
    'Search cryptocurrencies using AmbikaShelf. Read-only; returns coin ID, name, and symbol.',
    querySchema,
    async ({ query }) => {
      try {
        const results = await searchEndpoint('crypto-search', query);
        return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `Crypto search failed: ${error.message}` }] };
      }
    }
  );

  return server;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'ambikashelf-portfolio-search-mcp', apiBaseConfigured: Boolean(API_BASE_URL) });
});

app.post('/mcp', rateLimit, requireOptionalBearer, async (req, res) => {
  const mcpServer = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close().catch(() => {});
    mcpServer.close().catch(() => {});
  });
  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request failed:', error.message);
    if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' });
  }
});

app.all('/mcp', (_req, res) => {
  res.set('Allow', 'POST');
  res.status(405).json({ error: 'Use POST for the stateless Streamable HTTP MCP endpoint.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AmbikaShelf Portfolio Search MCP listening on port ${PORT}`);
  console.log(`Portfolio API base: ${API_BASE_URL}`);
  console.log(`Bearer auth: ${MCP_API_KEY ? 'enabled' : 'disabled (public read-only search)'}`);
});
