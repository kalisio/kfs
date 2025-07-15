import fs from 'fs-extra'
import path from 'path'
import _ from 'lodash'
import makeDebug from 'debug'
import { stripSlashes } from '@feathersjs/commons'
import errors from '@feathersjs/errors'
import { fileURLToPath } from 'url'
import * as utils from './utils.js'

const debug = makeDebug('kfs:routes')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { NotFound } = errors

export default async function (app) {
  const packageInfo = fs.readJsonSync(path.join(__dirname, '..', 'package.json'))
  const baseUrl = app.get('baseUrl')
  const apiPath = app.get('apiPath')

  app.get(`${apiPath}/healthcheck`, (req, res, next) => {
    const response = {
      name: 'kfs',
      // Allow to override version number for custom build
      version: (process.env.VERSION ? process.env.VERSION : packageInfo.version)
    }
    if (process.env.BUILD_NUMBER) {
      response.buildNumber = process.env.BUILD_NUMBER
    }
    res.json(response)
  })

  // API landing page
  app.get(apiPath || '/', async (req, res, next) => {
    const query = _.get(req, 'query', {})
    const landingPage = await utils.getApiFile(app, 'landingPage', query)
    res.json(landingPage)
  })

  // API conformance
  app.get(`${apiPath}/conformance`, async (req, res, next) => {
    const query = _.get(req, 'query', {})
    const conformance = await utils.getApiFile(app, 'conformance', query)
    res.json(conformance)
  })

  // API definition
  app.get(`${apiPath}/definition`, async (req, res, next) => {
    const query = _.get(req, 'query', {})
    const definition = await utils.getApiFile(app, 'definition', query)
    res.set('content-type', 'application/vnd.oai.openapi+json;version=3.0')
    res.json(definition)
  })

  // Collections
  async function getLayerForCollection (name, context) {
    // Try to use any catalog service available
    const catalogPath = stripSlashes((context ? `${apiPath}/${context}/catalog` : `${apiPath}/catalog`))
    const servicePath = stripSlashes((context ? `${apiPath}/${context}/${name}` : `${apiPath}/${name}`))
    if (app.services[catalogPath]) {
      debug(`Seeking for layer ${name} in catalog`)
      const catalogService = app.service(catalogPath)
      const layers = await catalogService.find({ query: { $or: [{ service: name }, { probeService: name }] }, paginate: false })
      if (layers.length > 0) return layers[0]
    } else {
      // Otherwise try to retrieve it from available services as if they are
      // authorised in the distribution config it should be exposed
      debug(`Seeking for service ${name} in app`)
      const servicePaths = Object.keys(app.services)
      for (let i = 0; i < servicePaths.length; i++) {
        const path = servicePaths[i]
        const service = app.service(path)
        // We do not expose local internal services
        if (!service.remote) continue
        // Return virtual "layer" definition used to expose service
        if (path === servicePath) {
          return {
            name: (context ? `${context}/${name}` : `${name}`),
            service: (context ? `${context}/${name}` : `${name}`)
          }
        }
      }
    }
    throw new NotFound(`Cannot find collection ${name}`)
  }
  async function getCollection (name, context) {
    const layer = await getLayerForCollection(name, context)
    const collections = utils.generateCollections(baseUrl, layer)
    // Select the right collection
    return _.find(collections, { id: name })
  }

  app.get(`${apiPath}/collections`, async (req, res, next) => {
    let collections = []
    // Try to use any catalog service available
    if (app.services[stripSlashes(`${apiPath}/catalog`)]) {
      debug('Seeking for layers in catalog')
      const catalogService = app.service(`${apiPath}/catalog`)
      // Retrieve service-based layers
      const layers = await catalogService.find({ query: { service: { $exists: true } }, paginate: false })
      layers.forEach(layer => {
        // Create a collection for feature service(s) except if service is filtered (ie not available)
        console.log(layer.service, app.services[stripSlashes(`${apiPath}/${layer.service}`)])
        if (!app.services[stripSlashes(`${apiPath}/${layer.service}`)]) return
        collections = collections.concat(utils.generateCollections(baseUrl, layer))
      })
    }
    // Otherwise try to retrieve available feature services as if they are
    // authorised in the distribution config it should be exposed
    debug('Seeking for services in app')
    const servicePaths = Object.keys(app.services)
    servicePaths.forEach(path => {
      const service = app.service(path)
      const serviceName = stripSlashes(path).replace(stripSlashes(apiPath) + '/', '')
      // Do not expose e.g. non features services or local internal services
      if (!utils.isExposedService(serviceName, service)) return
      // Check if already exposed as a layer
      if (_.find(collections, { id: serviceName })) return
      // Create virtual "layer" definition otherwise to expose service
      collections = collections.concat(utils.generateCollections(baseUrl, {
        name: serviceName,
        service: serviceName
      }))
    })

    debug('Getting list of collections', _.map(collections, 'id'))

    res.json({
      collections,
      links: [{
        href: `${baseUrl}/collections`,
        rel: 'self',
        type: 'application/json',
        title: 'This document'
      }]
    })
  })
  // Routes without context first as otherwise we might have catch conflicts
  app.get(`${apiPath}/collections/:name`, async (req, res, next) => {
    try {
      const name = _.get(req, 'params.name')
      const collection = await getCollection(name)
      debug('Getting collection', collection)
      res.json(collection)
    } catch (error) {
      next(error)
    }
  })
  app.get(`${apiPath}/collections/:name/items`, async (req, res, next) => {
    try {
      const name = _.get(req, 'params.name')
      const query = _.get(req, 'query', {})
      debug(`Getting features for collection ${name}`)
      const features = await utils.getFeaturesFromService(app, `${apiPath}/${name}`, query)
      res.set('content-type', 'application/geo+json')
      res.json(features)
    } catch (error) {
      next(error)
    }
  })
  app.post(`${apiPath}/collections/:name/items`, async (req, res, next) => {
    try {
      const name = _.get(req, 'params.name')
      const query = _.get(req, 'query', {})
      // In this case the CQL filter is given as body
      query.filter = _.get(req, 'body')
      debug(`Getting features for collection ${name}`)
      const features = await utils.getFeaturesFromService(app, `${apiPath}/${name}`, query)
      res.set('content-type', 'application/geo+json')
      res.json(features)
    } catch (error) {
      next(error)
    }
  })
  app.get(`${apiPath}/collections/:name/items/:id`, async (req, res, next) => {
    try {
      const name = _.get(req, 'params.name')
      const id = _.get(req, 'params.id')
      const query = _.get(req, 'query', {})
      debug(`Getting feature ${id} from collection ${name}`)
      const feature = await utils.getFeatureFromService(app, `${apiPath}/${name}`, id)
      res.set('content-type', 'application/geo+json')
      res.json(Object.assign(feature, { links: utils.generateFeatureLinks(baseUrl, name, query, feature) }))
    } catch (error) {
      next(error)
    }
  })
  // Similar route with context
  app.get(`${apiPath}/collections/:context/:name`, async (req, res, next) => {
    try {
      const context = _.get(req, 'params.context')
      const name = _.get(req, 'params.name')
      const collection = await getCollection(name, context)
      debug('Getting collection', collection)
      res.json(collection)
    } catch (error) {
      next(error)
    }
  })
  app.get(`${apiPath}/collections/:context/:name/items`, async (req, res, next) => {
    try {
      const context = _.get(req, 'params.context')
      const name = _.get(req, 'params.name')
      const query = _.get(req, 'query', {})
      debug(`Getting features for collection ${name} and context ${context}`)
      const features = await utils.getFeaturesFromService(app, `${apiPath}/${context}/${name}`, query)
      res.set('content-type', 'application/geo+json')
      res.json(features)
    } catch (error) {
      next(error)
    }
  })
  app.get(`${apiPath}/collections/:context/:name/items/:id`, async (req, res, next) => {
    try {
      const context = _.get(req, 'params.context')
      const name = _.get(req, 'params.name')
      const id = _.get(req, 'params.id')
      const query = _.get(req, 'query', {})
      debug(`Getting feature ${id} from collection ${name} and context ${context}`)
      const feature = await utils.getFeatureFromService(app, `${apiPath}/${context}/${name}`, id)
      res.set('content-type', 'application/geo+json')
      res.json(Object.assign(feature, { links: utils.generateFeatureLinks(baseUrl, `${context}/${name}`, query, feature) }))
    } catch (error) {
      next(error)
    }
  })
}
