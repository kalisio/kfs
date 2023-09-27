import utility from 'util'
import chai from 'chai'
import chailint from 'chai-lint'
import assert from 'assert'
import _ from 'lodash'
import path from 'path'
import fs from 'fs-extra'
import request from 'superagent'
import { fileURLToPath } from 'url'
import distribution, { finalize } from '@kalisio/feathers-distributed'
import { kdk } from '@kalisio/kdk/core.api.js'
import { createFeaturesService, createCatalogService } from '@kalisio/kdk/map.api.js'
import createServer from '../src/main.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { util, expect } = chai

// Test suite based on using the catalog service or not
function runTests (catalog) {
  let app, server, baseUrl, apiPath,
    kapp, catalogService, defaultLayers, hubeauStationsService, hubeauObsService,
    nbStations, nbObservations, feature
  const nbPerPage = 500

  it('initialize the remote app', async () => {
    kapp = kdk()
    // Distribute services
    await kapp.configure(distribution({
      // Use cote defaults to speedup tests
      cote: {
        helloInterval: 2000,
        checkInterval: 4000,
        nodeTimeout: 5000,
        masterTimeout: 6000
      },
      publicationDelay: 3000,
      key: 'kfs-test',
      // Distribute only the test services
      services: (service) => service.path.includes('hubeau') ||
                (catalog && service.path.includes('catalog'))
    }))
    await kapp.db.connect()
    // Create a global catalog service
    if (catalog) {
      await createCatalogService.call(kapp)
      catalogService = kapp.getService('catalog')
      expect(catalogService).toExist()
    }
  })
  // Let enough time to process
    .timeout(5000)

  it('registers the default layers', async () => {
    const layers = await fs.readJson(path.join(__dirname, 'config/layers.json'))
    expect(layers.length > 0)
    // Create layers
    if (catalog) defaultLayers = await catalogService.create(layers)
    else defaultLayers = layers
    // Single layer case
    if (!Array.isArray(defaultLayers)) defaultLayers = [defaultLayers]
    expect(defaultLayers.length > 0)
  })

  it('create and feed the hubeau stations service', async () => {
    // Create the services
    const hubeauLayer = _.find(defaultLayers, { name: 'Layers.HUBEAU' })
    expect(hubeauLayer).toExist()
    expect(hubeauLayer.probeService === 'hubeau-stations').beTrue()
    await createFeaturesService.call(kapp, {
      collection: hubeauLayer.probeService,
      featureId: hubeauLayer.featureId,
      paginate: { default: nbPerPage }
    })
    hubeauStationsService = kapp.getService(hubeauLayer.probeService)
    expect(hubeauStationsService).toExist()
    // Feed the collection
    let stations = fs.readJsonSync(path.join(__dirname, 'data/hubeau.stations.json')).features
    nbStations = stations.length
    stations = await hubeauStationsService.create(stations)
    feature = stations[Math.floor(Math.random() * nbStations)]
  })
  // Let enough time to process
    .timeout(5000)

  it('create and feed the hubeau observations service', async () => {
    // Create the service
    const hubeauLayer = _.find(defaultLayers, { name: 'Layers.HUBEAU' })
    expect(hubeauLayer).toExist()
    expect(hubeauLayer.service === 'hubeau-observations').beTrue()
    await createFeaturesService.call(kapp, {
      collection: hubeauLayer.service,
      featureId: hubeauLayer.featureId,
      paginate: { default: nbPerPage }
    })
    hubeauObsService = kapp.getService(hubeauLayer.service)
    expect(hubeauObsService).toExist()
    // Feed the collection
    const observations = fs.readJsonSync(path.join(__dirname, 'data/hubeau.observations.json'))
    nbObservations = observations.length
    await hubeauObsService.create(observations)
  })
  // Let enough time to process
    .timeout(5000)

  it('initialize the app', async () => {
    server = await createServer()
    expect(server).toExist()
    app = server.app
    expect(app).toExist()
    baseUrl = app.get('baseUrl')
    apiPath = app.get('apiPath')
    // Wait long enough to be sure distribution is up
    await utility.promisify(setTimeout)(10000)
  })
  // Let enough time to process
    .timeout(15000)

  it('get landing page', async () => {
    const response = await request.get(`${baseUrl}${apiPath}`)
    expect(response.body.links).toExist()
    expect(response.body.links.length).to.equal(4)
    response.body.links.forEach(link => {
      expect(link.href).toExist()
      expect(link.rel).toExist()
    })
  })
  // Let enough time to process
    .timeout(5000)

  it('get conformance page', async () => {
    const response = await request.get(`${baseUrl}${apiPath}/conformance`)
    expect(response.body.conformsTo).toExist()
  })
  // Let enough time to process
    .timeout(5000)

  it('get api definition', async () => {
    const response = await request.get(`${baseUrl}${apiPath}/definition`)
    expect(response.body.paths).toExist()
  })
  // Let enough time to process
    .timeout(5000)

  it('get collections', async () => {
    const response = await request.get(`${baseUrl}${apiPath}/collections`)
    expect(response.body.collections).toExist()
    expect(response.body.collections.length).to.equal(2)
    expect(response.body.links).toExist()
    expect(response.body.links.length).to.equal(1)
    response.body.links.forEach(link => {
      expect(link.href).toExist()
      expect(link.rel).toExist()
    })
  })
  // Let enough time to process
    .timeout(5000)

  it('get collection', async () => {
    const response = await request.get(`${baseUrl}${apiPath}/collections/hubeau-stations`)
    expect(response.body.name).toExist()
    expect(response.body.name).to.equal('hubeau-stations')
    expect(response.body.itemType).toExist()
    expect(response.body.itemType).to.equal('feature')
    expect(response.body.title).toExist()
    // When not using layers we don't have this information
    if (catalog) expect(response.body.description).toExist()
    expect(response.body.links).toExist()
    expect(response.body.links.length).to.equal(2)
    response.body.links.forEach(link => {
      expect(link.href).toExist()
      expect(link.rel).toExist()
    })
  })
  // Let enough time to process
    .timeout(5000)

  it('get nonexistent collection', async () => {
    try {
      await request.get(`${baseUrl}${apiPath}/collections/xxx`)
      assert.fail('getting nonexistent collection should raise on error')
    } catch (data) {
      const error = data.response.body
      expect(error).toExist()
      expect(error.name).to.equal('NotFound')
    }
  })
  // Let enough time to process
    .timeout(5000)

  it('get items', async () => {
    const response = await request.get(`${baseUrl}${apiPath}/collections/hubeau-stations/items`)
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(nbStations)
    expect(response.body.numberReturned).to.equal(nbStations < nbPerPage ? nbStations : nbPerPage)
  })
  // Let enough time to process
    .timeout(5000)

  it('get nonexistent item', async () => {
    try {
      await request.get(`${baseUrl}${apiPath}/collections/hubeau-stations/items/xxx`)
      assert.fail('getting nonexistent item should raise on error')
    } catch (data) {
      const error = data.response.body
      expect(error).toExist()
      expect(error.name).to.equal('NotFound')
    }
  })
  // Let enough time to process
    .timeout(5000)

  it('get item', async () => {
    const response = await request.get(`${baseUrl}${apiPath}/collections/hubeau-stations/items/${feature._id}`)
    expect(response.body._id).toExist()
    expect(response.body.properties).toExist()
    expect(response.body.links).toExist()
    expect(response.body.links.length).to.equal(2)
    response.body.links.forEach(link => {
      expect(link.href).toExist()
      expect(link.rel).toExist()
    })
  })
  // Let enough time to process
    .timeout(5000)

  it('get items with filtering on string property', async () => {
    const response = await request.get(`${baseUrl}${apiPath}/collections/hubeau-observations/items`)
      .query({ gml_id: 'StationHydro_FXX_shp.A282000101' })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(nbObservations)
    expect(response.body.numberReturned).to.equal(nbObservations < nbPerPage ? nbObservations : nbPerPage)
  })
  // Let enough time to process
    .timeout(5000)

  it('get items with filtering on number property', async () => {
    const response = await request.get(`${baseUrl}${apiPath}/collections/hubeau-observations/items`)
      .query({ H: 0.63 })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(1)
    expect(response.body.numberReturned).to.equal(1)
  })
  // Let enough time to process
    .timeout(5000)

  it('get items with incomplete bbox', async () => {
    try {
      await request.get(`${baseUrl}${apiPath}/collections/hubeau-stations/items`)
        .query({ bbox: [6.39, 48.30, 48.32].join(',') })
      assert.fail('getting with incomplete bbox should raise on error')
    } catch (data) {
      const error = data.response.body
      expect(error).toExist()
      expect(error.name).to.equal('BadRequest')
    }
  })
  // Let enough time to process
    .timeout(5000)

  it('get items in bbox', async () => {
    const response = await request.get(`${baseUrl}${apiPath}/collections/hubeau-stations/items`)
      .query({ bbox: [6.39, 48.30, 6.41, 48.32].join(',') })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(1)
    expect(response.body.numberReturned).to.equal(1)
  })
  // Let enough time to process
    .timeout(5000)

  it('get paginated items', async () => {
    const response = await request.get(`${baseUrl}${apiPath}/collections/hubeau-stations/items`)
      .query({ limit: 10 })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(nbStations)
    expect(response.body.numberReturned).to.equal(10)
  })
  // Let enough time to process
    .timeout(5000)

  it('get items at invalid time', async () => {
    try {
      await request.get(`${baseUrl}${apiPath}/collections/hubeau-observations/items`)
        .query({ datetime: 'xxx' })
      assert.fail('getting at invalid time should raise on error')
    } catch (data) {
      const error = data.response.body
      expect(error).toExist()
      expect(error.name).to.equal('BadRequest')
    }
  })
  // Let enough time to process
    .timeout(5000)

  it('get items at time', async () => {
    const response = await request.get(`${baseUrl}${apiPath}/collections/hubeau-observations/items`)
      .query({ datetime: '2018-10-22T22:00:00.000Z' })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(1)
    expect(response.body.numberReturned).to.equal(1)
  })
  // Let enough time to process
    .timeout(5000)

  it('get items with invalid time interval', async () => {
    try {
      await request.get(`${baseUrl}${apiPath}/collections/hubeau-observations/items`)
        .query({ datetime: '2018-10-22T22:00:00.000Z/2018-10-23T08:00:00.000Z/2018-10-24T08:00:00.000Z' })
      assert.fail('getting with invalid time interval should raise on error')
    } catch (data) {
      const error = data.response.body
      expect(error).toExist()
      expect(error.name).to.equal('BadRequest')
    }
  })
  // Let enough time to process
    .timeout(5000)

  it('get items in bounded time interval', async () => {
    // Data in range 2018-10-22T22:00:00.000Z/2018-10-24T08:00:00.000Z every hour
    const response = await request.get(`${baseUrl}${apiPath}/collections/hubeau-observations/items`)
      .query({ datetime: '2018-10-22T22:00:00.000Z/2018-10-24T08:00:00.000Z' })
    // First day = 3 obs, second day 24 obs, third day 8 obs
    const nbObservations = 3 + 24 + 8
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(nbObservations)
    expect(response.body.numberReturned).to.equal(nbObservations < nbPerPage ? nbObservations : nbPerPage)
  })
  // Let enough time to process
    .timeout(5000)

  it('get items in half-bounded start time interval', async () => {
    // Data starts at 2018-10-22T22:00:00.000Z every hour
    const response = await request.get(`${baseUrl}${apiPath}/collections/hubeau-observations/items`)
      .query({ datetime: '../2018-10-23T08:00:00.000Z' })
    // First day = 3 obs, second day 8 obs
    const nbObservations = 3 + 8
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(nbObservations)
    expect(response.body.numberReturned).to.equal(nbObservations < nbPerPage ? nbObservations : nbPerPage)
    // Data ends at 2018-11-23T08:06:00.000Z every 3 mns
    // First day = 3 obs, second day 8 obs
  })
  // Let enough time to process
    .timeout(5000)

  it('get items in half-bounded end time interval', async () => {
    // Data ends at 2018-11-23T08:06:00.000Z every 3 mns
    const response = await request.get(`${baseUrl}${apiPath}/collections/hubeau-observations/items`)
      .query({ datetime: '2018-11-22T20:00:00.000Z/..' })
    // First day = 80 obs, second day 163 obs
    const nbObservations = 80 + 163
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(nbObservations)
    expect(response.body.numberReturned).to.equal(nbObservations < nbPerPage ? nbObservations : nbPerPage)
  })
  // Let enough time to process
    .timeout(5000)

  it('get items with combined filters', async () => {
    // Data ends at 2018-11-23T08:06:00.000Z every 3 mns with some values higher than 0.33
    const response = await request.get(`${baseUrl}${apiPath}/collections/hubeau-observations/items`)
      .query({ H: 0.43, datetime: '2018-11-22T20:00:00.000Z/..', bbox: [7.42, 48.63, 7.43, 48.64].join(','), limit: 3 })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(4)
    expect(response.body.numberReturned).to.equal(3)
  })
  // Let enough time to process
    .timeout(5000)

  // Cleanup
  it('cleanup', async () => {
    if (server) await server.close()
    finalize(kapp)
    fs.emptyDirSync(path.join(__dirname, 'logs'))
    if (catalog) await catalogService.Model.drop()
    await hubeauStationsService.Model.drop()
    await hubeauObsService.Model.drop()
    await kapp.db.disconnect()
  })
}
describe('kfs', () => {
  before(async () => {
    chailint(chai, util)
  })

  it('is ES module compatible', () => {
    expect(typeof createServer).to.equal('function')
  })

  // Run test with and without catalog
  runTests(false)
  runTests(true)
})
