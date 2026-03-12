#!/usr/bin/env node
/**
 * MCP Server for Kalisio Features Service (KFS)
 *
 * Exposes KFS OGC API Features endpoints as MCP tools so that
 * Claude (or any MCP-compatible client) can query geospatial datasets.
 *
 * Configuration (environment variables):
 *   KFS_URL  – Base URL of the KFS API  (default: http://localhost:8081/api)
 *   KFS_JWT  – Bearer token for authenticated KFS instances (optional)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = (process.env.KFS_URL || 'http://localhost:8081/api').replace(/\/$/, '')
const KFS_JWT = process.env.KFS_JWT || null

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function apiFetch (path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`)
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  })

  const headers = { Accept: 'application/json, application/geo+json' }
  if (KFS_JWT) headers.Authorization = `Bearer ${KFS_JWT}`

  const response = await fetch(url.toString(), { headers })

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
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'kfs',
  version: '1.0.0'
})

// ---------------------------------------------------------------------------
// Tool: healthcheck
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tool: get_landing_page
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tool: get_conformance
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tool: get_api_definition
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tool: list_collections
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tool: get_collection
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tool: get_features
// ---------------------------------------------------------------------------

server.tool(
  'get_features',
  'Query features from a collection. Returns a GeoJSON FeatureCollection. ' +
  'Supports spatial (bbox), temporal (datetime), CQL filter and property filters.',
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
      'Bounding box filter as "minLon,minLat,maxLon,maxLat" in WGS 84 (EPSG:4326), ' +
      'e.g. "-5.14,41.33,9.56,51.09" for metropolitan France.'
    ),
    bbox_crs: z.string().optional().describe(
      'CRS of the bbox coordinates as an OGC URI or URN, ' +
      'e.g. "http://www.opengis.net/def/crs/EPSG/0/3857". Defaults to WGS 84.'
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
      'Text example: "temperature > 20 AND status = \'active\'". ' +
      'JSON example (set filter_lang to "cql-json"): {"op":"gt","args":[{"property":"temperature"},20]}.'
    ),
    filter_lang: z.enum(['cql-text', 'cql-json']).optional().describe(
      'Language of the filter expression: "cql-text" (default) or "cql-json".'
    ),
    properties: z.record(z.string()).optional().describe(
      'Additional feature property filters as key/value pairs, ' +
      'e.g. {"status": "active", "country": "FR"}. ' +
      'String values that look like numbers can be quoted with single quotes: "\'1000\'".'
    )
  },
  async ({ name, context, limit, offset, bbox, bbox_crs: bboxCrs, datetime, sortby, filter, filter_lang: filterLang, properties }) => {
    try {
      const path = context
        ? `/collections/${context}/${name}/items`
        : `/collections/${name}/items`

      const params = {
        limit,
        offset,
        bbox,
        'bbox-crs': bboxCrs,
        datetime,
        sortby,
        filter,
        'filter-lang': filterLang,
        ...properties
      }

      const data = await apiFetch(path, params)
      return ok(data)
    } catch (e) {
      return err(e)
    }
  }
)

// ---------------------------------------------------------------------------
// Tool: get_feature
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport()
await server.connect(transport)
