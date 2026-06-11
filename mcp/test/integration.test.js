/**
 * Integration tests for the KFS MCP Server against a real KFS instance.
 *
 * Starts a KDK app that exposes hubeau-stations and hubeau-observations as
 * feathers-distributed feature services, then starts the KFS HTTP server and
 * wires an MCP client to it via InMemoryTransport.  Tests exercise complex CQL
 * operators (cql-json and cql-text) through the MCP get_features tool.
 *
 * Run with:
 *   NODE_CONFIG_DIR=../test/config/ npm run mocha:integration
 *
 * Requirements: MongoDB reachable at mongodb://127.0.0.1:27017
 */

import assert from 'node:assert/strict'
import utility from 'util'
import path from 'path'
import fs from 'fs-extra'
import { fileURLToPath } from 'url'
import distribution, { finalize } from '@kalisio/feathers-distributed'
import { kdk } from '@kalisio/kdk/core.api.js'
import { createFeaturesService } from '@kalisio/kdk/map.api.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { buildServer } from '../server.js'
import createKfsServer from '../../src/main.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const nbPerPage = 200

describe('KFS MCP Server — Integration (requires MongoDB)', function () {
  this.timeout(30000)

  let kapp, hubeauStationsService, hubeauObsService, kfsServer, mcpClient
  let nbStations, nbObservations
  let nbStationsLIMNI, nbStationsWithNullInfluLocal, nbStationsLIMNIWithNullInfluLocal
  let featureRef

  // ---------------------------------------------------------------------------
  // Helper: call get_features and return parsed GeoJSON body.
  // ---------------------------------------------------------------------------

  async function getFeatures (args) {
    const result = await mcpClient.callTool({ name: 'get_features', arguments: args })
    if (result.isError) throw new Error(result.content[0].text)
    return JSON.parse(result.content[0].text)
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  before(async function () {
    this.timeout(60000)

    // 1. KDK app — distributes feature services under the 'kfs-test' key that
    //    the test KFS config accepts (see test/config/default.cjs).
    kapp = kdk()
    await kapp.configure(distribution({
      cote: { helloInterval: 2000, checkInterval: 4000, nodeTimeout: 5000, masterTimeout: 6000 },
      publicationDelay: 3000,
      key: 'kfs-test',
      services: (service) => service.path.includes('hubeau') && !service.path.includes('filtered'),
      remoteServiceOptions: () => ['modelName', 'paginate']
    }))
    await kapp.db.connect()

    // 2. hubeau-stations feature service + fixture data
    await createFeaturesService.call(kapp, {
      collection: 'hubeau-stations',
      featureId: 'code_station',
      paginate: { default: nbPerPage }
    })
    hubeauStationsService = kapp.getService('hubeau-stations')

    const stationsRaw = fs.readJsonSync(
      path.join(__dirname, '../../test/data/hubeau.stations.json')
    ).features
    nbStations = stationsRaw.length
    nbStationsWithNullInfluLocal = stationsRaw.filter(s => !s.properties.InfluLocal).length
    nbStationsLIMNI = stationsRaw.filter(s => s.properties.TypStation === 'LIMNI').length
    nbStationsLIMNIWithNullInfluLocal = stationsRaw.filter(
      s => s.properties.TypStation === 'LIMNI' && !s.properties.InfluLocal
    ).length

    const createdStations = await hubeauStationsService.create(stationsRaw)
    featureRef = Array.isArray(createdStations) ? createdStations[0] : createdStations

    // 3. hubeau-observations feature service + fixture data
    await createFeaturesService.call(kapp, {
      collection: 'hubeau-observations',
      featureId: 'code_station',
      paginate: { default: nbPerPage }
    })
    hubeauObsService = kapp.getService('hubeau-observations')

    const observations = fs.readJsonSync(
      path.join(__dirname, '../../test/data/hubeau.observations.json')
    )
    nbObservations = observations.length
    await hubeauObsService.create(observations)

    // 4. Start the real KFS HTTP server (reads config from NODE_CONFIG_DIR).
    kfsServer = await createKfsServer()
    const baseUrl = kfsServer.app.get('baseUrl')

    // Wait for feathers-distributed to propagate the remote services.
    await utility.promisify(setTimeout)(10000)

    // 5. Wire MCP server → real KFS via in-memory transport.
    const mcpServer = buildServer({ url: baseUrl })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await mcpServer.connect(serverTransport)
    mcpClient = new Client({ name: 'integration-test-client', version: '1.0.0' })
    await mcpClient.connect(clientTransport)
  })

  // ---------------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------------

  after(async function () {
    this.timeout(15000)
    if (mcpClient) await mcpClient.close()
    if (kfsServer) await kfsServer.close()
    if (kapp) finalize(kapp)
    if (hubeauStationsService) await hubeauStationsService.Model.drop()
    if (hubeauObsService) await hubeauObsService.Model.drop()
    if (kapp) await kapp.db.disconnect()
  })

  // ---------------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------------

  it('list_collections discovers both feature services', async function () {
    const result = await mcpClient.callTool({ name: 'list_collections', arguments: {} })
    assert.ok(!result.isError)
    const data = JSON.parse(result.content[0].text)
    const ids = data.collections.map(c => c.id)
    assert.ok(ids.includes('hubeau-stations'), `hubeau-stations missing from ${ids}`)
    assert.ok(ids.includes('hubeau-observations'), `hubeau-observations missing from ${ids}`)
  })

  it('get_features returns all stations without any filter', async function () {
    const data = await getFeatures({ name: 'hubeau-stations' })
    assert.strictEqual(data.numberMatched, nbStations)
  })

  it('get_feature retrieves a single station by id', async function () {
    const id = featureRef._id.toString()
    const result = await mcpClient.callTool({ name: 'get_feature', arguments: { name: 'hubeau-stations', id } })
    assert.ok(!result.isError)
    const data = JSON.parse(result.content[0].text)
    assert.strictEqual(data.type, 'Feature')
    assert.ok(data.id)
    assert.ok(data.properties)
  })

  // ---------------------------------------------------------------------------
  // Bbox + datetime
  // ---------------------------------------------------------------------------

  it('get_features — bbox filters stations to a small area', async function () {
    const data = await getFeatures({ name: 'hubeau-stations', bbox: '6.39,48.30,6.41,48.32' })
    assert.strictEqual(data.numberMatched, 1)
  })

  it('get_features — datetime instant returns observations at that exact time', async function () {
    const data = await getFeatures({
      name: 'hubeau-observations',
      datetime: '2018-10-22T22:00:00.000Z'
    })
    assert.strictEqual(data.numberMatched, 1)
  })

  it('get_features — datetime closed interval returns observations in range', async function () {
    const data = await getFeatures({
      name: 'hubeau-observations',
      datetime: '2018-10-22T22:00:00.000Z/2018-10-24T08:00:00.000Z'
    })
    // First day = 3 obs, second day 24 obs, third day 8 obs
    assert.strictEqual(data.numberMatched, 35)
  })

  // ---------------------------------------------------------------------------
  // Property filter (equality via query param)
  // ---------------------------------------------------------------------------

  it('get_features — property filter on numeric value H = 0.63', async function () {
    const data = await getFeatures({
      name: 'hubeau-observations',
      properties: { H: 0.63 }
    })
    assert.strictEqual(data.numberMatched, 1)
    assert.strictEqual(data.features[0].properties.H, 0.63)
  })

  // ---------------------------------------------------------------------------
  // cql-json comparison operators
  // ---------------------------------------------------------------------------

  it('get_features — cql-json eq: H = 0.63 returns one observation', async function () {
    const data = await getFeatures({
      name: 'hubeau-observations',
      filter: JSON.stringify({ op: 'eq', args: [{ property: 'H' }, 0.63] }),
      filter_lang: 'cql-json'
    })
    assert.strictEqual(data.numberMatched, 1)
  })

  it('get_features — cql-json lt: H < 0.4 excludes the 9 non-standard observations', async function () {
    const data = await getFeatures({
      name: 'hubeau-observations',
      filter: JSON.stringify({ op: 'lt', args: [{ property: 'H' }, 0.4] }),
      filter_lang: 'cql-json'
    })
    assert.strictEqual(data.numberMatched, nbObservations - 9)
  })

  it('get_features — cql-json gt: H > 0.5 returns the H = 0.63 observation', async function () {
    const data = await getFeatures({
      name: 'hubeau-observations',
      filter: JSON.stringify({ op: 'gt', args: [{ property: 'H' }, 0.5] }),
      filter_lang: 'cql-json'
    })
    assert.strictEqual(data.numberMatched, 1)
  })

  // ---------------------------------------------------------------------------
  // cql-json logical operators
  // ---------------------------------------------------------------------------

  it('get_features — cql-json and(gte, lte): H in [0.63, 0.63] returns one', async function () {
    const data = await getFeatures({
      name: 'hubeau-observations',
      filter: JSON.stringify({
        op: 'and',
        args: [
          { op: 'gte', args: [{ property: 'H' }, 0.63] },
          { op: 'lte', args: [{ property: 'H' }, 0.63] }
        ]
      }),
      filter_lang: 'cql-json'
    })
    assert.strictEqual(data.numberMatched, 1)
  })

  it('get_features — cql-json not(lt): NOT H < 0.63 returns H >= 0.63', async function () {
    const data = await getFeatures({
      name: 'hubeau-observations',
      filter: JSON.stringify({ op: 'not', args: [{ op: 'lt', args: [{ property: 'H' }, 0.63] }] }),
      filter_lang: 'cql-json'
    })
    assert.strictEqual(data.numberMatched, 1)
  })

  // ---------------------------------------------------------------------------
  // cql-json null operators
  // ---------------------------------------------------------------------------

  it('get_features — cql-json isNull: H IS NULL returns 0 (no null values in dataset)', async function () {
    const data = await getFeatures({
      name: 'hubeau-observations',
      filter: JSON.stringify({ op: 'isNull', args: [{ property: 'H' }] }),
      filter_lang: 'cql-json'
    })
    assert.strictEqual(data.numberMatched, 0)
  })

  it('get_features — cql-json not(isNull): H IS NOT NULL returns all observations', async function () {
    const data = await getFeatures({
      name: 'hubeau-observations',
      filter: JSON.stringify({ op: 'not', args: [{ op: 'isNull', args: [{ property: 'H' }] }] }),
      filter_lang: 'cql-json'
    })
    assert.strictEqual(data.numberMatched, nbObservations)
  })

  // ---------------------------------------------------------------------------
  // cql-json like operators
  // ---------------------------------------------------------------------------

  it('get_features — cql-json like: TypStation = LIMNI', async function () {
    const data = await getFeatures({
      name: 'hubeau-stations',
      filter: JSON.stringify({ op: 'like', args: [{ property: 'TypStation' }, 'LIMNI'] }),
      filter_lang: 'cql-json'
    })
    assert.strictEqual(data.numberMatched, nbStationsLIMNI)
    data.features.forEach(f => assert.strictEqual(f.properties.TypStation, 'LIMNI'))
  })

  it('get_features — cql-json like nocase: TypStation = limni (case-insensitive)', async function () {
    const data = await getFeatures({
      name: 'hubeau-stations',
      filter: JSON.stringify({ op: 'like', args: [{ property: 'TypStation' }, 'limni'], nocase: true }),
      filter_lang: 'cql-json'
    })
    assert.strictEqual(data.numberMatched, nbStationsLIMNI)
  })

  it('get_features — cql-json like with % wildcard: LbStationH contains Wasselonne', async function () {
    const data = await getFeatures({
      name: 'hubeau-stations',
      filter: JSON.stringify({ op: 'like', args: [{ property: 'LbStationH' }, '%Wasselonne%'] }),
      filter_lang: 'cql-json'
    })
    assert.strictEqual(data.numberMatched, 1)
  })

  it('get_features — cql-json and(like, isNull): LIMNI stations with null InfluLocal', async function () {
    const data = await getFeatures({
      name: 'hubeau-stations',
      filter: JSON.stringify({
        op: 'and',
        args: [
          { op: 'like', args: [{ property: 'TypStation' }, 'LIMNI'] },
          { op: 'isNull', args: [{ property: 'InfluLocal' }] }
        ]
      }),
      filter_lang: 'cql-json'
    })
    assert.strictEqual(data.numberMatched, nbStationsLIMNIWithNullInfluLocal)
  })

  // ---------------------------------------------------------------------------
  // cql-json temporal operators
  // ---------------------------------------------------------------------------

  it('get_features — cql-json t_during: observations in a time interval', async function () {
    const data = await getFeatures({
      name: 'hubeau-observations',
      filter: JSON.stringify({
        op: 't_during',
        args: [
          { property: 'time' },
          ['2018-10-22T22:00:00.000Z', '2018-10-24T08:00:00.000Z']
        ]
      }),
      filter_lang: 'cql-json'
    })
    // First day = 3 obs, second day 24 obs, third day 8 obs
    assert.strictEqual(data.numberMatched, 35)
  })

  // ---------------------------------------------------------------------------
  // cql-json spatial operators
  // ---------------------------------------------------------------------------

  it('get_features — cql-json s_intersects: stations inside a small polygon', async function () {
    const data = await getFeatures({
      name: 'hubeau-stations',
      filter: JSON.stringify({
        op: 's_intersects',
        args: [
          { property: 'geometry' },
          {
            type: 'Polygon',
            coordinates: [[[7.42, 48.63], [7.43, 48.63], [7.43, 48.64], [7.42, 48.64], [7.42, 48.63]]]
          }
        ]
      }),
      filter_lang: 'cql-json'
    })
    assert.strictEqual(data.numberMatched, 1)
  })

  // ---------------------------------------------------------------------------
  // cql-text operators
  // ---------------------------------------------------------------------------

  it('get_features — cql-text IS NULL: stations with no InfluLocal', async function () {
    const data = await getFeatures({
      name: 'hubeau-stations',
      filter: 'InfluLocal IS NULL',
      filter_lang: 'cql-text'
    })
    assert.strictEqual(data.numberMatched, nbStationsWithNullInfluLocal)
    data.features.forEach(f => assert.ok(f.properties.InfluLocal == null))
  })

  it('get_features — cql-text IS NOT NULL: stations with InfluLocal set', async function () {
    const data = await getFeatures({
      name: 'hubeau-stations',
      filter: 'InfluLocal IS NOT NULL',
      filter_lang: 'cql-text'
    })
    assert.strictEqual(data.numberMatched, nbStations - nbStationsWithNullInfluLocal)
    data.features.forEach(f => assert.ok(f.properties.InfluLocal != null))
  })

  it('get_features — cql-text LIKE: exact match TypStation = LIMNI', async function () {
    const data = await getFeatures({
      name: 'hubeau-stations',
      filter: "TypStation LIKE 'LIMNI'",
      filter_lang: 'cql-text'
    })
    assert.strictEqual(data.numberMatched, nbStationsLIMNI)
  })

  it('get_features — cql-text ILIKE: case-insensitive match TypStation = limni', async function () {
    const data = await getFeatures({
      name: 'hubeau-stations',
      filter: "TypStation ILIKE 'limni'",
      filter_lang: 'cql-text'
    })
    assert.strictEqual(data.numberMatched, nbStationsLIMNI)
  })

  it('get_features — cql-text LIKE with % wildcard: LbStationH contains Wasselonne', async function () {
    const data = await getFeatures({
      name: 'hubeau-stations',
      filter: "LbStationH LIKE '%Wasselonne%'",
      filter_lang: 'cql-text'
    })
    assert.strictEqual(data.numberMatched, 1)
  })

  it('get_features — cql-text S_INTERSECTS: stations inside WKT polygon', async function () {
    const data = await getFeatures({
      name: 'hubeau-stations',
      filter: 'S_INTERSECTS(geometry,POLYGON((7.42 48.63, 7.43 48.63, 7.43 48.64, 7.42 48.64, 7.42 48.63)))',
      filter_lang: 'cql-text'
    })
    assert.strictEqual(data.numberMatched, 1)
  })
})
