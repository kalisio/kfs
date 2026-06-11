#!/usr/bin/env node
/**
 * MCP Server for Kalisio Features Service (KFS)
 *
 * Exposes KFS OGC API Features endpoints as MCP tools so that
 * Claude (or any MCP-compatible client) can query geospatial datasets.
 *
 * Configuration (environment variables):
 *   KFS_URL      – Base URL of the KFS API  (default: http://localhost:8081/api)
 *   KFS_JWT      – Bearer token for authenticated KFS instances (optional)
 *   MCP_PORT     – When set, starts an HTTP server on this port instead of stdio.
 *                  Exposes the MCP endpoint at POST /mcp (Streamable HTTP transport).
 *                  Use this for remote deployments reachable via URL.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MCP_PORT = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : null

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function makeApiFetch (baseUrl, jwt) {
  return async function apiFetch (path, params = {}, body = null) {
    const url = new URL(`${baseUrl}${path}`)
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    })

    const headers = { Accept: 'application/json, application/geo+json' }
    if (jwt) headers.Authorization = `Bearer ${jwt}`
    if (body !== null) headers['Content-Type'] = 'application/json'

    const response = await fetch(url.toString(), {
      method: body !== null ? 'POST' : 'GET',
      headers,
      body: body !== null ? JSON.stringify(body) : undefined
    })

    const text = await response.text()
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} — ${text.slice(0, 300)}`)
    }

    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
}

function ok (data) {
  return {
    content: [{
      type: 'text',
      text: typeof data === 'string' ? data : JSON.stringify(data, null, 2)
    }]
  }
}

function err (error) {
  return {
    isError: true,
    content: [{ type: 'text', text: String(error) }]
  }
}

// ---------------------------------------------------------------------------
// Server factory — called once for stdio, once per HTTP request for HTTP mode.
// Options override env vars; useful for testing.
// ---------------------------------------------------------------------------

export function buildServer (options = {}) {
  const baseUrl = (options.url || process.env.KFS_URL || 'http://localhost:8081/api').replace(/\/$/, '')
  const jwt = options.jwt !== undefined ? options.jwt : (process.env.KFS_JWT || null)
  const apiFetch = makeApiFetch(baseUrl, jwt)

  const server = new McpServer({
    name: 'kfs',
    version: '1.0.0'
  })

  // -------------------------------------------------------------------------
  // Tool: healthcheck
  // -------------------------------------------------------------------------

  server.tool(
    'healthcheck',
    'Check whether the KFS service is up and return its version information.',
    {},
    async () => {
      try {
        const data = await apiFetch('/healthcheck')
        return ok(data)
      } catch (e) {
        return err(e)
      }
    }
  )

  // -------------------------------------------------------------------------
  // Tool: get_landing_page
  // -------------------------------------------------------------------------

  server.tool(
    'get_landing_page',
    'Retrieve the OGC API Features landing page. ' +
    'Returns the service title, description and links to conformance, definition and collections.',
    {},
    async () => {
      try {
        const data = await apiFetch('/')
        return ok(data)
      } catch (e) {
        return err(e)
      }
    }
  )

  // -------------------------------------------------------------------------
  // Tool: get_conformance
  // -------------------------------------------------------------------------

  server.tool(
    'get_conformance',
    'Return the list of OGC conformance classes implemented by this KFS instance.',
    {},
    async () => {
      try {
        const data = await apiFetch('/conformance')
        return ok(data)
      } catch (e) {
        return err(e)
      }
    }
  )

  // -------------------------------------------------------------------------
  // Tool: get_api_definition
  // -------------------------------------------------------------------------

  server.tool(
    'get_api_definition',
    'Fetch the OpenAPI 3.0 definition of the KFS service. ' +
    'Useful to discover all available paths, parameters and schemas.',
    {},
    async () => {
      try {
        const data = await apiFetch('/definition')
        return ok(data)
      } catch (e) {
        return err(e)
      }
    }
  )

  // -------------------------------------------------------------------------
  // Tool: list_collections
  // -------------------------------------------------------------------------

  server.tool(
    'list_collections',
    'List all feature collections exposed by the KFS service. ' +
    'Each collection entry contains its id, title, description and spatial extent.',
    {},
    async () => {
      try {
        const data = await apiFetch('/collections')
        return ok(data)
      } catch (e) {
        return err(e)
      }
    }
  )

  // -------------------------------------------------------------------------
  // Tool: get_collection
  // -------------------------------------------------------------------------

  server.tool(
    'get_collection',
    'Get metadata for a single feature collection (extent, CRS, links…).',
    {
      name: z.string().describe('Collection identifier, e.g. "myLayer" or "myLayer~subFilter".'),
      context: z.string().optional().describe(
        'Optional context segment for context-scoped collections, e.g. a user or organisation id.'
      )
    },
    async ({ name, context }) => {
      try {
        const path = context
          ? `/collections/${context}/${name}`
          : `/collections/${name}`
        const data = await apiFetch(path)
        return ok(data)
      } catch (e) {
        return err(e)
      }
    }
  )

  // -------------------------------------------------------------------------
  // Tool: get_features
  // -------------------------------------------------------------------------

  server.tool(
    'get_features',
    'Query features from a collection. Returns a GeoJSON FeatureCollection. ' +
    'Supports spatial (bbox in WGS 84 only), temporal (datetime), CQL filter and property filters.',
    {
      name: z.string().describe('Collection identifier.'),
      context: z.string().optional().describe('Optional context segment.'),
      limit: z.number().int().positive().optional().describe(
        'Maximum number of features to return (server default applies when omitted).'
      ),
      offset: z.number().int().nonnegative().optional().describe(
        'Number of features to skip for pagination.'
      ),
      bbox: z.string().optional().describe(
        'Bounding box filter as "minLon,minLat,maxLon,maxLat" in WGS 84 (EPSG:4326) — ' +
        'the only supported CRS for bbox. ' +
        'Example: "-5.14,41.33,9.56,51.09" for metropolitan France.'
      ),
      datetime: z.string().optional().describe(
        'Temporal filter in ISO 8601 format. ' +
        'Single instant: "2024-01-15T00:00:00Z". ' +
        'Interval: "2024-01-01T00:00:00Z/2024-01-31T23:59:59Z". ' +
        'Open-ended: "2024-01-01T00:00:00Z/..".'
      ),
      sortby: z.string().optional().describe(
        'Comma-separated list of property names to sort by. ' +
        'Prefix with "+" for ascending (default) or "-" for descending, e.g. "-time,+name".'
      ),
      filter: z.string().optional().describe(
        'CQL filter expression. ' +
        'JSON example (recommended, set filter_lang to "cql-json"): ' +
        '{"op":"gt","args":[{"property":"temperature"},20]}. ' +
        'Text example (limited operators, set filter_lang to "cql-text"): ' +
        '"S_INTERSECTS(geometry, POLYGON(...))" or "windSpeed IS NULL".'
      ),
      filter_lang: z.enum(['cql-text', 'cql-json']).optional().describe(
        'Language of the filter expression. ' +
        '"cql-json" has full operator support (logical, comparison, spatial, temporal, null) — recommended. ' +
        '"cql-text" only supports spatial operators (S_INTERSECTS, S_WITHIN), IS NULL, and LIKE/ILIKE.'
      ),
      properties: z.record(z.string()).optional().describe(
        'Additional feature property filters as key/value pairs, ' +
        'e.g. {"status": "active", "country": "FR"}. ' +
        'String values that look like numbers can be quoted with single quotes: "\'1000\'".'
      )
    },
    async ({ name, context, limit, offset, bbox, datetime, sortby, filter, filter_lang: filterLang, properties }) => {
      try {
        const path = context
          ? `/collections/${context}/${name}/items`
          : `/collections/${name}/items`

        // cql-json must be sent as the POST body — KFS only reads it from req.body,
        // never from a URL query parameter (Express does not auto-parse JSON query strings).
        let cqlJsonBody = null
        if (filterLang === 'cql-json' && filter) {
          try {
            cqlJsonBody = typeof filter === 'string' ? JSON.parse(filter) : filter
          } catch {
            return err(new Error('filter must be valid JSON when filter_lang is cql-json'))
          }
        }

        const params = {
          limit,
          offset,
          bbox,
          datetime,
          sortby,
          filter: cqlJsonBody ? undefined : filter,
          'filter-lang': filterLang,
          ...properties
        }

        const data = await apiFetch(path, params, cqlJsonBody)
        return ok(data)
      } catch (e) {
        return err(e)
      }
    }
  )

  // -------------------------------------------------------------------------
  // Tool: get_feature
  // -------------------------------------------------------------------------

  server.tool(
    'get_feature',
    'Retrieve a single feature by its id from a collection.',
    {
      name: z.string().describe('Collection identifier.'),
      id: z.string().describe('Feature id (the "id" field of a GeoJSON feature).'),
      context: z.string().optional().describe('Optional context segment.')
    },
    async ({ name, id, context }) => {
      try {
        const path = context
          ? `/collections/${context}/${name}/items/${id}`
          : `/collections/${name}/items/${id}`
        const data = await apiFetch(path)
        return ok(data)
      } catch (e) {
        return err(e)
      }
    }
  )

  return server
}

// ---------------------------------------------------------------------------
// Start server — stdio (default) or HTTP (when MCP_PORT is set).
// Guarded so that importing this module for testing does not auto-start.
// ---------------------------------------------------------------------------

const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain && MCP_PORT) {
  // HTTP mode: Streamable HTTP transport, one server instance per request (stateless).
  // Connect via: claude mcp add kfs --transport http http://<host>:<MCP_PORT>/mcp
  const httpServer = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const { pathname } = new URL(req.url, `http://localhost:${MCP_PORT}`)
    if (pathname !== '/mcp') {
      res.writeHead(404).end('Not found')
      return
    }

    if (req.method !== 'POST') {
      res.writeHead(405).end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed' },
        id: null
      }))
      return
    }

    const server = buildServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res)
      res.on('close', () => {
        transport.close()
        server.close()
      })
    } catch (e) {
      process.stderr.write(`MCP request error: ${e}\n`)
      if (!res.headersSent) {
        res.writeHead(500).end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null
        }))
      }
    }
  })

  httpServer.listen(MCP_PORT, () => {
    process.stderr.write(`KFS MCP server (HTTP) listening on http://0.0.0.0:${MCP_PORT}/mcp\n`)
  })

  process.on('SIGINT', () => {
    httpServer.close()
    process.exit(0)
  })
} else if (isMain) {
  // Stdio mode (default): spawned as a local subprocess by Claude Desktop / Claude Code.
  const transport = new StdioServerTransport()
  await buildServer().connect(transport)
}
