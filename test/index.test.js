const utility = require('util')
const chai = require('chai')
const chailint = require('chai-lint')
const _ = require('lodash')
const path = require('path')
const fs = require('fs-extra')
const request = require('superagent')
const distribution = require('@kalisio/feathers-distributed')
const kCore = require('@kalisio/kdk/core.api')
const kMap = require('@kalisio/kdk/map.api')
const createServer = require('../src/main.js')

const { util, expect } = chai
const { kalisio } = kCore
const { createFeaturesService, createCatalogService } = kMap

describe('kfs', () => {
  let app, server, baseUrl, apiPath,
    kapp, catalogService, defaultLayers, hubeauStationsService, hubeauObsService,
    nbStations

  before(async () => {
    chailint(chai, util)
  })

  it('is ES6 compatible', () => {
    expect(typeof createServer).to.equal('function')
  })

  it('initialize the remote app', async () => {
    kapp = kalisio()
    // Distribute services
    kapp.configure(distribution({
      // Use cote defaults to speedup tests
      cote: {
        helloInterval: 2000,
        checkInterval: 4000,
        nodeTimeout: 5000,
        masterTimeout: 6000
      },
      publicationDelay: 5000,
      key: 'kfs-test'
    }))
    await kapp.db.connect()
    // Create a global catalog service
    await createCatalogService.call(kapp)
    catalogService = kapp.getService('catalog')
    expect(catalogService).toExist()
    // Wait long enough to be sure distribution is up
    await utility.promisify(setTimeout)(7000)
  })
  // Let enough time to process
    .timeout(10000)

  it('initialize the app', async () => {
    server = await createServer()
    expect(server).toExist()
    app = server.app
    expect(app).toExist()
    baseUrl = app.get('baseUrl')
    apiPath = app.get('apiPath')
    // Wait long enough to be sure distribution is up
    await utility.promisify(setTimeout)(7000)
  })
  // Let enough time to process
    .timeout(10000)

  it('registers the default layers in catalog', async () => {
    const layers = await fs.readJson(path.join(__dirname, 'config/layers.json'))
    expect(layers.length > 0)
    // Create layers
    defaultLayers = await catalogService.create(layers)
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
      featureId: hubeauLayer.featureId
    })
    hubeauStationsService = kapp.getService(hubeauLayer.probeService)
    expect(hubeauStationsService).toExist()
    // Feed the collection
    const stations = fs.readJsonSync(path.join(__dirname, 'data/hubeau.stations.json')).features
    nbStations = stations.length
    await hubeauStationsService.create(stations)
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
      featureId: hubeauLayer.featureId
    })
    hubeauObsService = kapp.getService(hubeauLayer.service)
    expect(hubeauObsService).toExist()
    // Feed the collection
    const observations = fs.readJsonSync(path.join(__dirname, 'data/hubeau.observations.json'))
    await hubeauObsService.create(observations)
  })
  // Let enough time to process
    .timeout(5000)

  it('get landing page', async () => {
    const response = await request.get(`${baseUrl}${apiPath}`)
    expect(response.body.links).toExist()
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
    expect(response.body.links).toExist()
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
    expect(response.body.description).toExist()
    expect(response.body.links).toExist()
  })
  // Let enough time to process
    .timeout(5000)

  it('get nonexistent collection', (done) => {
    request.get(`${baseUrl}${apiPath}/collections/xxx`)
      .catch(data => {
        const error = data.response.body
        expect(error).toExist()
        expect(error.name).to.equal('NotFound')
        done()
      })
  })
  // Let enough time to process
    .timeout(5000)

  it('get items', async () => {
    const response = await request.get(`${baseUrl}${apiPath}/collections/hubeau-stations/items`)
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(nbStations)
    expect(response.body.numberReturned).to.equal(nbStations)
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

  // Cleanup
  after(async () => {
    if (server) await server.close()
    distribution.finalize(kapp)
    fs.emptyDirSync(path.join(__dirname, 'logs'))
    await catalogService.Model.drop()
    await hubeauStationsService.Model.drop()
    await hubeauObsService.Model.drop()
    await kapp.db.disconnect()
  })
})
