import fs from 'fs-extra'
import path from 'path'
import _ from 'lodash'
import errors from '@feathersjs/errors'
import { fileURLToPath } from 'url'
import * as utils from './utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { NotFound, BadRequest, GeneralError } = errors

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
  const landingPage = await utils.getApiFile(app, 'landingPage')
  app.get(apiPath, (req, res, next) => {
  	res.json(landingPage)
  })

  // API conformance
  const conformance = await utils.getApiFile(app, 'conformance')
  app.get(`${apiPath}/conformance`, (req, res, next) => {
  	res.json(conformance)
  })

  // API definition
  const definition = await utils.getApiFile(app, 'definition')
  app.get(`${apiPath}/definition`, (req, res, next) => {
  	res.json(definition)
  })

  // Collections
  async function getLayerForCollection(name) {
  	const catalogService = app.service(`${apiPath}/catalog`)
  	if (catalogService) {
		  const layers = await catalogService.find({ query: { $or: [{ service: name }, { probeService: name }] }, paginate: false })
		  if (layers.length === 0) throw new NotFound(`Cannot find collection ${name}`)
		  return layers[0]
		} else {
			throw new GeneralError(`Cannot find collection ${name} as catalog is currently unavailable`)
		}
	}
  async function getCollection(name) {
  	const layer = await getLayerForCollection(name)
		const collections = utils.generateCollections(baseUrl, layer)
		// Select the right collection
  	return _.find(collections, { name })
	}

  app.get(`${apiPath}/collections`, async (req, res, next) => {
  	try {
	  	let collections = []
	  	const catalogService = app.service(`${apiPath}/catalog`)
	  	if (catalogService) {
		  	// Retrieve service-based layers
		  	let layers = await catalogService.find({ query: { service: { $exists: true } }, paginate: false })
		  	layers.forEach(layer => {
		  		// Create a collection for feature service(s)
		  		collections = collections.concat(utils.generateCollections(baseUrl, layer))
		  	})
		  } else {
				throw new GeneralError(`Cannot list collections as catalog is currently unavailable`)
			}
			res.json({
	  		collections,
	  		links: [{
	  			href: `${baseUrl}/collections?f=application/json`,
		      rel: 'self',
		      type: 'application/json',
		      title: 'This document'
	  		}]
	  	})
		} catch (error) {
			next(error)
		}
  })
  app.get(`${apiPath}/collections/:name`, async (req, res, next) => {
  	try {
	  	const name = _.get(req, 'params.name')
	  	const collection = await getCollection(name)
	  	res.json(collection)
	  } catch (error) {
			next(error)
		}
  })

  // Collection features
  app.get(`${apiPath}/collections/:name/items`, async (req, res, next) => {
  	try {
	  	const name = _.get(req, 'params.name')
	  	const query = _.get(req, 'query', {})
	  	const featureService = app.service(`${apiPath}/${name}`)
	  	const featureCollection = await featureService.find({ query: utils.convertQuery(query) })
	  	res.json(utils.convertFeatureCollection(featureCollection))
	  } catch (error) {
			next(error)
		}
  })
  app.get(`${apiPath}/collections/:name/items/:id`, async (req, res, next) => {
  	try {
	  	const name = _.get(req, 'params.name')
	  	const id = _.get(req, 'params.id')
	  	const featureService = app.service(`${apiPath}/${name}`)
	  	const feature = await featureService.get(id)
	  	res.json(feature)
	  } catch (error) {
			next(error)
		}
  })
}
