/**
 * Tests for the KFS MCP Server.
 *
 * Strategy: spin up a lightweight mock KFS HTTP server that returns canned
 * responses, then connect an MCP Client to the MCP server via an in-memory
 * transport pair.  Each test calls a tool through the client and asserts on
 * the text content returned.
 *
 * The mock server also records every request it receives so tests can verify
 * that the correct URL (path + query params) was called.
 */

import assert from 'node:assert'
import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { buildServer } from '../server.js'

// ---------------------------------------------------------------------------
// Mock KFS HTTP server
// ---------------------------------------------------------------------------

// Canned fixture data
const HEALTHCHECK = { version: '1.6.0', status: 'ok' }

const LANDING_PAGE = {
  title: 'KFS',
  description: 'Kalisio Features Service',
  links: [
    { href: 'http://localhost/api', rel: 'self' },
    { href: 'http://localhost/api/conformance', rel: 'conformance' },
    { href: 'http://localhost/api/definition', rel: 'service-desc' },
    { href: 'http://localhost/api/collections', rel: 'data' }
  ]
}

const CONFORMANCE = {
  conformsTo: ['http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core']
}

const API_DEFINITION = {
  openapi: '3.0.1',
  paths: { '/collections': { get: { summary: 'List collections' } } }
}

const COLLECTIONS = {
  collections: [
    { id: 'hubeau-stations', title: 'Hubeau Stations' },
    { id: 'hubeau-observations', title: 'Hubeau Observations' }
  ],
  links: [{ href: 'http://localhost/api/collections', rel: 'self' }]
}

const COLLECTION_STATIONS = {
  id: 'hubeau-stations',
  itemType: 'feature',
  title: 'Hubeau Stations',
  crs: ['http://www.opengis.net/def/crs/OGC/1.3/CRS84'],
  links: [
    { href: 'http://localhost/api/collections/hubeau-stations', rel: 'self' },
    { href: 'http://localhost/api/collections/hubeau-stations/items', rel: 'items' }
  ]
}

const FEATURE_COLLECTION = {
  type: 'FeatureCollection',
  numberMatched: 2,
  numberReturned: 2,
  features: [
    { type: 'Feature', id: 'id-1', properties: { name: 'Station A', H: 0.63 }, geometry: { type: 'Point', coordinates: [7.42, 48.63] } },
    { type: 'Feature', id: 'id-2', properties: { name: 'Station B', H: 0.33 }, geometry: { type: 'Point', coordinates: [6.39, 48.30] } }
  ]
}

const SINGLE_FEATURE = {
  type: 'Feature',
  id: 'id-1',
  properties: { name: 'Station A', H: 0.63 },
  geometry: { type: 'Point', coordinates: [7.42, 48.63] },
  links: [
    { href: 'http://localhost/api/collections/hubeau-stations/items/id-1', rel: 'self' },
    { href: 'http://localhost/api/collections/hubeau-stations', rel: 'collection' }
  ]
}

// Routes: path prefix → { status, body } or a function(url) → { status, body }
const routes = {
  '/api/healthcheck': { status: 200, body: HEALTHCHECK },
  '/api/': { status: 200, body: LANDING_PAGE },
  '/api/conformance': { status: 200, body: CONFORMANCE },
  '/api/definition': { status: 200, body: API_DEFINITION },
  '/api/collections': { status: 200, body: COLLECTIONS },
  '/api/collections/hubeau-stations': { status: 200, body: COLLECTION_STATIONS },
  '/api/collections/ctx/hubeau-stations': { status: 200, body: { ...COLLECTION_STATIONS, id: 'ctx/hubeau-stations' } },
  '/api/collections/hubeau-stations/items': { status: 200, body: FEATURE_COLLECTION },
  '/api/collections/ctx/hubeau-stations/items': { status: 200, body: FEATURE_COLLECTION },
  '/api/collections/hubeau-stations/items/id-1': { status: 200, body: SINGLE_FEATURE },
  '/api/collections/ctx/hubeau-stations/items/id-1': { status: 200, body: SINGLE_FEATURE }
}

let mockServer
let mockPort
const requests = [] // recorded incoming requests

function startMockServer () {
  return new Promise((resolve) => {
    mockServer = createServer((req, res) => {
      const parsedUrl = new URL(req.url, 'http://localhost')
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString()
        let body = null
        try { if (bodyText) body = JSON.parse(bodyText) } catch {}
        requests.push({
          pathname: parsedUrl.pathname,
          searchParams: parsedUrl.searchParams,
          method: req.method,
          body
        })
        const route = routes[parsedUrl.pathname]
        if (route) {
          res.writeHead(route.status, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(route.body))
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ name: 'NotFound', message: `${parsedUrl.pathname} not found` }))
        }
      })
    })
    mockServer.listen(0, () => {
      mockPort = mockServer.address().port
      resolve()
    })
  })
}

// ---------------------------------------------------------------------------
// MCP client helpers
// ---------------------------------------------------------------------------

let mcpClient

async function createMcpClient (options = {}) {
  const server = buildServer({ url: `http://localhost:${mockPort}/api`, ...options })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await client.connect(clientTransport)
  return { client, server }
}

/**
 * Call a tool and return the parsed text content.
 * Throws if the tool returns an error result.
 */
async function callTool (name, args = {}) {
  const result = await mcpClient.callTool({ name, arguments: args })
  if (result.isError) throw new Error(result.content[0].text)
  return JSON.parse(result.content[0].text)
}

/**
 * Call a tool that is expected to return an error and return the error message.
 */
async function callToolExpectError (name, args = {}) {
  const result = await mcpClient.callTool({ name, arguments: args })
  assert.ok(result.isError, 'Expected tool to return an error')
  return result.content[0].text
}

/** Returns the last request recorded by the mock server. */
function lastRequest () {
  return requests[requests.length - 1]
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('KFS MCP Server', () => {
  before(async () => {
    await startMockServer()
    const { client } = await createMcpClient()
    mcpClient = client
  })

  after(async () => {
    await mcpClient.close()
    await new Promise((resolve) => mockServer.close(resolve))
  })

  beforeEach(() => {
    requests.length = 0
  })

  // -------------------------------------------------------------------------
  // Tool listing
  // -------------------------------------------------------------------------

  it('exposes all 7 expected tools', async () => {
    const { tools } = await mcpClient.listTools()
    const names = tools.map((t) => t.name).sort()
    assert.deepStrictEqual(names, [
      'get_api_definition',
      'get_collection',
      'get_feature',
      'get_features',
      'get_conformance',
      'get_landing_page',
      'healthcheck',
      'list_collections'
    ].sort())
  })

  // -------------------------------------------------------------------------
  // healthcheck
  // -------------------------------------------------------------------------

  it('healthcheck — calls /healthcheck and returns version info', async () => {
    const data = await callTool('healthcheck')
    assert.strictEqual(data.version, HEALTHCHECK.version)
    assert.strictEqual(requests.length, 1)
    assert.strictEqual(lastRequest().pathname, '/api/healthcheck')
  })

  // -------------------------------------------------------------------------
  // get_landing_page
  // -------------------------------------------------------------------------

  it('get_landing_page — returns links array', async () => {
    const data = await callTool('get_landing_page')
    assert.ok(Array.isArray(data.links))
    assert.ok(data.links.length > 0)
    assert.strictEqual(lastRequest().pathname, '/api/')
  })

  // -------------------------------------------------------------------------
  // get_conformance
  // -------------------------------------------------------------------------

  it('get_conformance — returns conformsTo array', async () => {
    const data = await callTool('get_conformance')
    assert.ok(Array.isArray(data.conformsTo))
    assert.strictEqual(lastRequest().pathname, '/api/conformance')
  })

  // -------------------------------------------------------------------------
  // get_api_definition
  // -------------------------------------------------------------------------

  it('get_api_definition — returns OpenAPI paths object', async () => {
    const data = await callTool('get_api_definition')
    assert.ok(data.paths)
    assert.strictEqual(lastRequest().pathname, '/api/definition')
  })

  // -------------------------------------------------------------------------
  // list_collections
  // -------------------------------------------------------------------------

  it('list_collections — returns collections array', async () => {
    const data = await callTool('list_collections')
    assert.ok(Array.isArray(data.collections))
    assert.strictEqual(data.collections.length, 2)
    assert.strictEqual(lastRequest().pathname, '/api/collections')
  })

  // -------------------------------------------------------------------------
  // get_collection
  // -------------------------------------------------------------------------

  it('get_collection — returns collection metadata', async () => {
    const data = await callTool('get_collection', { name: 'hubeau-stations' })
    assert.strictEqual(data.id, 'hubeau-stations')
    assert.strictEqual(data.itemType, 'feature')
    assert.strictEqual(lastRequest().pathname, '/api/collections/hubeau-stations')
  })

  it('get_collection — with context prefix', async () => {
    const data = await callTool('get_collection', { name: 'hubeau-stations', context: 'ctx' })
    assert.strictEqual(lastRequest().pathname, '/api/collections/ctx/hubeau-stations')
    assert.ok(data.id)
  })

  it('get_collection — nonexistent collection returns isError', async () => {
    const msg = await callToolExpectError('get_collection', { name: 'nonexistent' })
    assert.ok(msg.includes('404'))
  })

  // -------------------------------------------------------------------------
  // get_features
  // -------------------------------------------------------------------------

  it('get_features — returns GeoJSON FeatureCollection', async () => {
    const data = await callTool('get_features', { name: 'hubeau-stations' })
    assert.strictEqual(data.type, 'FeatureCollection')
    assert.ok(Array.isArray(data.features))
    assert.strictEqual(data.numberMatched, 2)
    assert.strictEqual(lastRequest().pathname, '/api/collections/hubeau-stations/items')
  })

  it('get_features — passes limit and offset as query params', async () => {
    await callTool('get_features', { name: 'hubeau-stations', limit: 10, offset: 5 })
    const { searchParams } = lastRequest()
    assert.strictEqual(searchParams.get('limit'), '10')
    assert.strictEqual(searchParams.get('offset'), '5')
  })

  it('get_features — passes bbox as query param', async () => {
    await callTool('get_features', { name: 'hubeau-stations', bbox: '6.39,48.30,6.41,48.32' })
    assert.strictEqual(lastRequest().searchParams.get('bbox'), '6.39,48.30,6.41,48.32')
  })

  it('get_features — passes datetime as query param', async () => {
    const dt = '2024-01-01T00:00:00Z/2024-01-31T23:59:59Z'
    await callTool('get_features', { name: 'hubeau-stations', datetime: dt })
    assert.strictEqual(lastRequest().searchParams.get('datetime'), dt)
  })

  it('get_features — passes sortby as query param', async () => {
    await callTool('get_features', { name: 'hubeau-stations', sortby: '-time,+name' })
    assert.strictEqual(lastRequest().searchParams.get('sortby'), '-time,+name')
  })

  it('get_features — sends cql-json filter as POST body (not query param)', async () => {
    const filterObj = { op: 'gt', args: [{ property: 'H' }, 0.5] }
    await callTool('get_features', { name: 'hubeau-stations', filter: JSON.stringify(filterObj), filter_lang: 'cql-json' })
    const req = lastRequest()
    // cql-json must arrive as POST body so KFS can parse it via req.body
    assert.strictEqual(req.method, 'POST')
    assert.deepStrictEqual(req.body, filterObj)
    assert.strictEqual(req.searchParams.get('filter'), null)
    assert.strictEqual(req.searchParams.get('filter-lang'), 'cql-json')
  })

  it('get_features — passes cql-text filter', async () => {
    await callTool('get_features', { name: 'hubeau-stations', filter: 'InfluLocal IS NULL', filter_lang: 'cql-text' })
    const { searchParams } = lastRequest()
    assert.strictEqual(searchParams.get('filter'), 'InfluLocal IS NULL')
    assert.strictEqual(searchParams.get('filter-lang'), 'cql-text')
  })

  it('get_features — spreads additional property filters into query params', async () => {
    await callTool('get_features', { name: 'hubeau-stations', properties: { TypStation: 'LIMNI', CdDept: '67' } })
    const { searchParams } = lastRequest()
    assert.strictEqual(searchParams.get('TypStation'), 'LIMNI')
    assert.strictEqual(searchParams.get('CdDept'), '67')
  })

  it('get_features — with context prefix', async () => {
    await callTool('get_features', { name: 'hubeau-stations', context: 'ctx' })
    assert.strictEqual(lastRequest().pathname, '/api/collections/ctx/hubeau-stations/items')
  })

  it('get_features — omits undefined/null/empty params from query string', async () => {
    await callTool('get_features', { name: 'hubeau-stations' })
    const { searchParams } = lastRequest()
    // No stray empty keys
    assert.strictEqual(searchParams.get('limit'), null)
    assert.strictEqual(searchParams.get('bbox'), null)
    assert.strictEqual(searchParams.get('filter'), null)
  })

  // -------------------------------------------------------------------------
  // get_feature (single)
  // -------------------------------------------------------------------------

  it('get_feature — returns single GeoJSON Feature', async () => {
    const data = await callTool('get_feature', { name: 'hubeau-stations', id: 'id-1' })
    assert.strictEqual(data.type, 'Feature')
    assert.strictEqual(data.id, 'id-1')
    assert.strictEqual(lastRequest().pathname, '/api/collections/hubeau-stations/items/id-1')
  })

  it('get_feature — with context prefix', async () => {
    const data = await callTool('get_feature', { name: 'hubeau-stations', id: 'id-1', context: 'ctx' })
    assert.strictEqual(data.type, 'Feature')
    assert.strictEqual(lastRequest().pathname, '/api/collections/ctx/hubeau-stations/items/id-1')
  })

  it('get_feature — nonexistent feature returns isError', async () => {
    const msg = await callToolExpectError('get_feature', { name: 'hubeau-stations', id: 'nonexistent' })
    assert.ok(msg.includes('404'))
  })

  // -------------------------------------------------------------------------
  // JWT authentication
  // -------------------------------------------------------------------------

  it('forwards JWT as Authorization header when configured', async () => {
    let receivedAuthHeader
    const authMockServer = await new Promise((resolve) => {
      const s = createServer((req, res) => {
        receivedAuthHeader = req.headers.authorization
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok' }))
      })
      s.listen(0, () => resolve(s))
    })
    const authPort = authMockServer.address().port

    const server = buildServer({ url: `http://localhost:${authPort}/api`, jwt: 'test-token-123' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    await client.connect(clientTransport)

    await client.callTool({ name: 'healthcheck', arguments: {} })
    await client.close()
    await new Promise((resolve) => authMockServer.close(resolve))

    assert.strictEqual(receivedAuthHeader, 'Bearer test-token-123')
  })

  it('omits Authorization header when no JWT configured', async () => {
    let receivedAuthHeader = 'was-set'
    const noAuthMockServer = await new Promise((resolve) => {
      const s = createServer((req, res) => {
        receivedAuthHeader = req.headers.authorization
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok' }))
      })
      s.listen(0, () => resolve(s))
    })
    const noAuthPort = noAuthMockServer.address().port

    const server = buildServer({ url: `http://localhost:${noAuthPort}/api`, jwt: null })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    await client.connect(clientTransport)

    await client.callTool({ name: 'healthcheck', arguments: {} })
    await client.close()
    await new Promise((resolve) => noAuthMockServer.close(resolve))

    assert.strictEqual(receivedAuthHeader, undefined)
  })
})
