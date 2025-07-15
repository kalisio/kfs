import utility from 'util'
import chai from 'chai'
import chailint from 'chai-lint'
import assert from 'assert'
import _ from 'lodash'
import path from 'path'
import config from 'config'
import fs from 'fs-extra'
import request from 'superagent'
import { fileURLToPath } from 'url'
import moment from 'moment'
import distribution, { finalize } from '@kalisio/feathers-distributed'
import { kdk } from '@kalisio/kdk/core.api.js'
import { createFeaturesService, createCatalogService } from '@kalisio/kdk/map.api.js'
import createServer from '../src/main.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const modelsPath = path.join(__dirname, 'models')
const servicesPath = path.join(__dirname, 'services')
const { util, expect } = chai

// Test suite based on using the catalog service or not
function runTests (options = {
  catalog: true,
  features: true
}) {
  let app, server, baseUrl,
    kapp, catalogService, defaultLayers, hubeauStationsService, hubeauObsService, hubeauFilteredService,
    nbStations, nbStationsWithNullInfluLocal, nbObservations, feature
  const nbPerPage = 200

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
      services: (service) => (service.path.includes('hubeau') && !service.path.includes('filtered')) ||
                (options.catalog && service.path.includes('catalog')),
      // Distribute at least modelName and pagination for KFS to know about features services
      remoteServiceOptions: () => ['modelName', 'paginate']
    }))
    await kapp.db.connect()
    // Create a global catalog service
    if (options.catalog) {
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
    if (options.catalog) defaultLayers = await catalogService.create(layers)
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
    if (options.features) {
      await createFeaturesService.call(kapp, {
        collection: hubeauLayer.probeService,
        featureId: hubeauLayer.featureId,
        paginate: { default: nbPerPage }
      })
    } else {
      await kapp.createService('hubeau-stations', {
        modelsPath,
        servicesPath,
        paginate: { default: nbPerPage }
      })
    }
    hubeauStationsService = kapp.getService(hubeauLayer.probeService)
    expect(hubeauStationsService).toExist()
    // Feed the collection
    let stations = fs.readJsonSync(path.join(__dirname, 'data/hubeau.stations.json')).features
    nbStations = stations.length
    nbStationsWithNullInfluLocal = stations.filter(station => !station.properties.InfluLocal).length
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
    if (options.features) {
      await createFeaturesService.call(kapp, {
        collection: hubeauLayer.service,
        featureId: hubeauLayer.featureId,
        paginate: { default: nbPerPage }
      })
    } else {
      await kapp.createService('hubeau-observations', {
        modelsPath,
        servicesPath,
        paginate: { default: nbPerPage }
      })
    }
    hubeauObsService = kapp.getService(hubeauLayer.service)
    expect(hubeauObsService).toExist()
    // Feed the collection, most observations have H = 0.33 with a few exceptions:
    // First one with H = 0.63, second to last four ones with H = 0.43, last four ones with H = 0.53
    const observations = fs.readJsonSync(path.join(__dirname, 'data/hubeau.observations.json'))
    nbObservations = observations.length
    // Take care that in this case no hook will convert time correctly
    if (!options.features) observations.forEach(observation => observation.time = new Date(observation.time))
    await hubeauObsService.create(observations)
  })
  // Let enough time to process
    .timeout(5000)

  it('create and feed the hubeau filtered service', async () => {
    // Create the service
    const hubeauLayer = _.find(defaultLayers, { name: 'Layers.FILTERED_SERVICE' })
    expect(hubeauLayer).toExist()
    expect(hubeauLayer.service === 'hubeau-filtered').beTrue()
    if (options.features) {
      await createFeaturesService.call(kapp, {
        collection: hubeauLayer.service,
        featureId: hubeauLayer.featureId,
        paginate: { default: nbPerPage }
      })
    } else {
      await kapp.createService('hubeau-filtered', {
        modelsPath,
        servicesPath,
        paginate: { default: nbPerPage }
      })
    }
    hubeauFilteredService = kapp.getService(hubeauLayer.service)
    expect(hubeauFilteredService).toExist()
  })
  // Let enough time to process
    .timeout(5000)

  it('initialize the app', async () => {
    server = await createServer()
    expect(server).toExist()
    app = server.app
    expect(app).toExist()
    baseUrl = app.get('baseUrl')
    // Wait long enough to be sure distribution is up
    await utility.promisify(setTimeout)(10000)
  })
  // Let enough time to process
    .timeout(15000)

  it('get landing page', async () => {
    const response = await request.get(`${baseUrl}`)
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
    const response = await request.get(`${baseUrl}/conformance`)
    expect(response.body.conformsTo).toExist()
  })
  // Let enough time to process
    .timeout(5000)

  it('get api definition', async () => {
    const response = await request.get(`${baseUrl}/definition`)
    expect(response.body.paths).toExist()
  })
  // Let enough time to process
    .timeout(5000)

  it('get collections', async () => {
    const response = await request.get(`${baseUrl}/collections`)
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
    const response = await request.get(`${baseUrl}/collections/hubeau-stations`)
    expect(response.body.id).toExist()
    expect(response.body.id).to.equal('hubeau-stations')
    expect(response.body.itemType).toExist()
    expect(response.body.itemType).to.equal('feature')
    expect(response.body.title).toExist()
    // When not using layers we don't have this information
    if (options.catalog) {
      expect(response.body.description).toExist()
      expect(response.body.extent).toExist()
      expect(response.body.extent.spatial).toExist()
      expect(response.body.extent.spatial.bbox).toExist()
      expect(response.body.extent.spatial.crs).toExist()
      expect(response.body.extent.temporal).toExist()
      expect(response.body.extent.temporal.interval).toExist()
      expect(response.body.extent.temporal.interval.length).to.equal(1)
      expect(response.body.extent.temporal.interval[0].length).to.equal(2)
      expect(response.body.extent.temporal.interval[0][0]).not.to.equal(null)
      expect(response.body.extent.temporal.interval[0][1]).not.to.equal(null)
      expect(response.body.extent.temporal.trs).toExist()
      expect(response.body.defaultSortOrder).toExist()
      expect(response.body.defaultSortOrder).to.deep.equal(['-time'])
    }
    expect(response.body.crs).toExist()
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
      await request.get(`${baseUrl}/collections/xxx`)
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
    const response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(nbStations)
    expect(response.body.numberReturned).to.equal(nbStations < nbPerPage ? nbStations : nbPerPage)
    response.body.links.forEach(link => {
      expect(link.href).toExist()
      expect(link.href.includes('offset')).beTrue()
      expect(link.href.includes('limit')).beTrue()
      expect(link.rel).toExist()
    })
  })
  // Let enough time to process
    .timeout(5000)

  it('get sorted items', async () => {
    // Use a string property that actually contains a number so that comparisons are made easy
    let response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ sortby: '+CdCommune' })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(nbStations)
    expect(response.body.numberReturned).to.equal(nbStations < nbPerPage ? nbStations : nbPerPage)
    let CdCommune, previousCdCommune
    response.body.features.forEach(feature => {
      CdCommune = Number(_.get(feature, 'properties.CdCommune'))
      if (previousCdCommune) expect(previousCdCommune <= CdCommune).beTrue()
      previousCdCommune = CdCommune
    })
    response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ sortby: '-CdCommune' })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(nbStations)
    expect(response.body.numberReturned).to.equal(nbStations < nbPerPage ? nbStations : nbPerPage)
    previousCdCommune = undefined
    response.body.features.forEach(feature => {
      CdCommune = Number(_.get(feature, 'properties.CdCommune'))
      if (previousCdCommune) expect(previousCdCommune >= CdCommune).beTrue()
      previousCdCommune = CdCommune
    })
  })
  // Let enough time to process
    .timeout(5000)

  it('get nonexistent item', async () => {
    try {
      await request.get(`${baseUrl}/collections/hubeau-stations/items/xxx`)
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
    const response = await request.get(`${baseUrl}/collections/hubeau-stations/items/${feature._id}`)
    expect(response.body.id).toExist()
    expect(response.body.id.toString()).to.equal(feature._id.toString())
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
    const response = await request.get(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ gml_id: 'StationHydro_FXX_shp.A282000101' })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(nbObservations)
    expect(response.body.numberReturned).to.equal(nbObservations < nbPerPage ? nbObservations : nbPerPage)
  })
  // Let enough time to process
    .timeout(5000)

  it('get items without filtering on a reserved query parameter', async () => {
    const response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ jwt: 'xxx' })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(nbStations)
    expect(response.body.numberReturned).to.equal(nbStations < nbPerPage ? nbStations : nbPerPage)
  })
  // Let enough time to process
    .timeout(5000)

  it('get items with filtering on number property', async () => {
    const response = await request.get(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ H: 0.63 })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(1)
    expect(response.body.numberReturned).to.equal(1)
  })
  // Let enough time to process
    .timeout(5000)

  it('get items with filtering on number-like property but stored as string', async () => {
    const response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ CdCommune: '\'67520\'' })
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
      await request.get(`${baseUrl}/collections/hubeau-stations/items`)
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
    const response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
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
    const nbPages = Math.ceil(nbStations / nbPerPage)
    const hasUnfilledPage = ((nbStations / nbPerPage) % 1 !== 0)
    let href = `${baseUrl}/collections/hubeau-stations/items?limit=${nbPerPage}`
    // According to max limit allowed by service go through pages
    for (let i = 0; i < nbPages; i++) {
      const isLastPage = (i === (nbPages - 1))
      const response = await request.get(href)
      expect(response.body.features).toExist()
      expect(response.body.numberMatched).toExist()
      expect(response.body.numberReturned).toExist()
      expect(response.body.numberMatched).to.equal(nbStations)
      expect(response.body.numberReturned).to.equal(isLastPage && hasUnfilledPage ? nbStations - i*nbPerPage : nbPerPage)
      expect(response.body.links).toExist()
      expect(response.body.links.length).to.equal(isLastPage ? 1 : 2)
      const currentPage = response.body.links[0]
      expect(currentPage.href).toExist()
      expect(currentPage.href.includes(`offset=${i*nbPerPage}`)).beTrue()
      expect(currentPage.href.includes(`limit=${nbPerPage}`)).beTrue()
      expect(currentPage.rel).toExist()
      if (!isLastPage) {
        const nextPage = response.body.links[1]
        expect(nextPage.href).toExist()
        expect(nextPage.href.includes(`offset=${(i+1)*nbPerPage}`)).beTrue()
        expect(nextPage.href.includes(`limit=${nbPerPage}`)).beTrue()
        expect(nextPage.rel).toExist()
        // Get next page url
        href = nextPage.href
      }
    }
  })
  // Let enough time to process
    .timeout(5000)

  it('get items at invalid time', async () => {
    try {
      await request.get(`${baseUrl}/collections/hubeau-observations/items`)
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
    const response = await request.get(`${baseUrl}/collections/hubeau-observations/items`)
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
      await request.get(`${baseUrl}/collections/hubeau-observations/items`)
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
    const response = await request.get(`${baseUrl}/collections/hubeau-observations/items`)
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
    const response = await request.get(`${baseUrl}/collections/hubeau-observations/items`)
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
    const response = await request.get(`${baseUrl}/collections/hubeau-observations/items`)
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

  it('get items by sorted times', async () => {
    let time, previousTime, minTime, maxTime
    // Data starts at 2018-10-22T22:00:00.000Z every hour
    let response = await request.get(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ datetime: '../2018-10-23T08:00:00.000Z' })
    let features = response.body.features
    expect(features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberMatched > 0).beTrue()
    // Default sort order should be descending time (only for features services)
    if (options.features) {
      minTime = moment.utc(features[features.length-1].time)
      maxTime = moment.utc(features[0].time)
      expect(maxTime.isAfter(minTime)).beTrue()
      features.forEach(feature => {
        time = moment.utc(feature.time)
        expect(time.isSameOrAfter(minTime)).beTrue()
        expect(time.isSameOrBefore(maxTime)).beTrue()
        if (previousTime) expect(time.isBefore(previousTime)).beTrue()
        previousTime = time
      })
    }
    response = await request.get(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ datetime: '../2018-10-23T08:00:00.000Z', sortby: '+time' })
    features = response.body.features
    expect(features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberMatched > 0).beTrue()
    // Sort order should now be ascending time
    if (options.features) {
      expect(moment.utc(features[0].time).isSame(minTime)).beTrue()
      expect(moment.utc(features[features.length-1].time).isSame(maxTime)).beTrue()
    } else {
      minTime = moment.utc(features[0].time)
      maxTime = moment.utc(features[features.length-1].time)
    }
    previousTime = undefined
    features.forEach(feature => {
      time = moment.utc(feature.time)
      expect(time.isSameOrAfter(minTime)).beTrue()
      expect(time.isSameOrBefore(maxTime)).beTrue()
      if (previousTime) expect(time.isAfter(previousTime)).beTrue()
      previousTime = time
    })
  })
  // Let enough time to process
    .timeout(5000)

  it('get items with combined filters', async () => {
    // Data ends at 2018-11-23T08:06:00.000Z every 3 mns with some values higher than 0.33
    const response = await request.get(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ H: 0.43, datetime: '2018-11-22T20:00:00.000Z/..', bbox: [7.42, 48.63, 7.43, 48.64].join(','), limit: 3 })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(4)
    expect(response.body.numberReturned).to.equal(3)
  })
  // Let enough time to process
    .timeout(5000)

  it('cql is null expressions', async () => {
    let response = await request.post(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ 'filter-lang': 'cql-json', limit: 3 })
      .send({ isNull: { property: 'H' } })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(0)
    expect(response.body.numberReturned).to.equal(0)
    response = await request.post(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ 'filter-lang': 'cql-json', limit: 3 })
      .send({ not: { isNull: { property: 'H' } } })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(nbObservations)
    expect(response.body.numberReturned).to.equal(3)
  })
  // Let enough time to process
    .timeout(5000)

  it('cql comparison expressions', async () => {
    let response = await request.post(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ 'filter-lang': 'cql-json', limit: 3 })
      .send({ eq: [{ property: 'H' }, 0.63] })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(1)
    expect(response.body.numberReturned).to.equal(1)
    response = await request.post(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ 'filter-lang': 'cql-json', limit: 3 })
      .send({ lt: [{ property: 'H' }, 0.4] })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(nbObservations - 9)
    expect(response.body.numberReturned).to.equal(3)
  })
  // Let enough time to process
    .timeout(5000)

  it('cql logical expressions', async () => {
    let response = await request.post(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ 'filter-lang': 'cql-json', limit: 3 })
      .send({ and: [{ gte: [{ property: 'H' }, 0.63] }, { lte: [{ property: 'H' }, 0.63] }] })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(1)
    expect(response.body.numberReturned).to.equal(1)
    response = await request.post(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ 'filter-lang': 'cql-json', limit: 3 })
      .send({ not: [{ lt: [{ property: 'H' }, 0.63] }] })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(1)
    expect(response.body.numberReturned).to.equal(1)
  })
  // Let enough time to process
    .timeout(5000)

  it('cql temporal expressions', async () => {
    // Data in range 2018-10-22T22:00:00.000Z/2018-10-24T08:00:00.000Z every hour
    let response = await request.post(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ 'filter-lang': 'cql-json' })
      .send({ during: [{ property: 'time' }, ['2018-10-22T22:00:00.000Z', '2018-10-24T08:00:00.000Z']]})
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

  it('cql spatial expressions', async () => {
    let response = await request.post(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-json', limit: 3 })
      .send({ intersects: [{ property: 'geometry' }, { type: 'Polygon', coordinates: [[[7.42, 48.63], [7.43, 48.63], [7.43, 48.64], [7.42, 48.64], [7.42, 48.63]]] }] })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(1)
    expect(response.body.numberReturned).to.equal(1)
  })
  // Let enough time to process
    .timeout(5000)

  it('cql text expressions', async () => {
    let response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-text', filter: `INTERSECTS(geometry,POLYGON((7.42 48.63, 7.43 48.63, 7.43 48.64, 7.42 48.64, 7.42 48.63)))`, limit: 3 })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(1)
    expect(response.body.numberReturned).to.equal(1)

    response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-text', filter: `InfluLocal IS NULL`, limit: 1 })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(nbStationsWithNullInfluLocal)
    expect(response.body.numberReturned).to.equal(1)
    expect(response.body.features[0].properties.InfluLocal).beNull()

    response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-text', filter: `InfluLocal IS NOT NULL`, limit: 1 })
    expect(response.body.features).toExist()
    expect(response.body.numberMatched).toExist()
    expect(response.body.numberReturned).toExist()
    expect(response.body.numberMatched).to.equal(nbStations - nbStationsWithNullInfluLocal)
    expect(response.body.numberReturned).to.equal(1)
    expect(response.body.features[0].properties.InfluLocal).toExist()
  })
  // Let enough time to process
    .timeout(5000)

  // Cleanup
  it('cleanup', async () => {
    if (server) await server.close()
    finalize(kapp)
    fs.emptyDirSync(path.join(__dirname, 'logs'))
    if (options.catalog) await catalogService.Model.drop()
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

  // Run test with/without catalog
  // and with/without features services
  runTests({
    catalog: false,
    features: true
  })
  runTests({
    catalog: true,
    features: true
  })
  // Expose specific non-features service
  config.services = (serviceName, service) => {
    if (serviceName.includes('hubeau')) return {
      properties: true,
      query: { geoJson: true }
    }
  }
  runTests({
    catalog: false,
    features: false
  })
})
