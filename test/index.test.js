import utility from 'util'
import chai from 'chai'
import chailint from 'chai-lint'
import _ from 'lodash'
import path from 'path'
import fs from 'fs-extra'
import { fileURLToPath } from 'url'
import { kdk } from '@kalisio/kdk/core.api.js'
import map, { createFeaturesService, createCatalogService } from '@kalisio/kdk/map.api.js'
import createServer from '../src/main.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { util, expect } = chai

describe('map:services', () => {
  let app, server, port, // baseUrl,
      kapp, catalogService, defaultLayers, hubeauStationsService, hubeauObsService

  before(() => {
    chailint(chai, util)

    kapp = kdk()
    //port = app.get('port')
    // baseUrl = `http://localhost:${port}${app.get('apiPath')}`
    return kapp.db.connect()
  })

  it('is ES module compatible', () => {
    expect(typeof createServer).to.equal('function')
  })

  it('initialize the app', async () => {
    server = await createServer()
    expect(server).toExist()
    app = server.app
    expect(app).toExist()
  })
  // Let enough time to process
    .timeout(10000)

  it('registers the services', async () => {
    // Create a global catalog service
    await createCatalogService.call(kapp)
    catalogService = kapp.getService('catalog')
    expect(catalogService).toExist()
  })
  // Let enough time to process
    .timeout(5000)

  it('registers the default layer catalog', async () => {
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
    const hubeauLayer = _.find(defaultLayers, { name: 'hubeau' })
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
    await hubeauStationsService.create(stations)
  })
  // Let enough time to process
    .timeout(5000)

  it('create and feed the hubeau observations service', async () => {
    // Create the service
    const hubeauLayer = _.find(defaultLayers, { name: 'hubeau' })
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

  // Cleanup
  after(async () => {
    if (server) await server.close()
    fs.emptyDirSync(path.join(__dirname, 'logs'))
    await catalogService.Model.drop()
    await hubeauStationsService.Model.drop()
    await hubeauObsService.Model.drop()
    await kapp.db.disconnect()
  })
})
