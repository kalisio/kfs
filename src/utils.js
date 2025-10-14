import _ from 'lodash'
import fs from 'fs-extra'
import path from 'path'
import config from 'config'
import { fileURLToPath, URLSearchParams } from 'url'
import moment from 'moment'
import envsub from 'envsub'
import makeDebug from 'debug'
import { stripSlashes } from '@feathersjs/commons'
import errors from '@feathersjs/errors'
import { getDefaults } from './defaults.js'
import { convertQuery, convertFeatureCollection, convertFeature } from './utils.convert.js'

// Special caracter used to separate service from filter name in collection name for layers providing filters.
// Indeed, we build collections based on available filters, e.g.
// a layer named 'admin-express' with filter like { {label|name}: 'region', ... } will result in a collection named admin-express~region
export const FilterCharacter = '~'
const debug = makeDebug('kfs:utils')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { NotFound } = errors

const packageInfo = fs.readJsonSync(path.join(__dirname, '..', 'package.json'))

function getEnvsubOptions (app, query) {
  // Report input query parameters if any (eg token)
  let queryUrl = new URLSearchParams(query).toString()
  if (queryUrl) queryUrl = `?${queryUrl}`
  const baseUrl = app.get('baseUrl')
  return {
    syntax: 'handlebars',
    envs: [
      { name: 'BASE_URL', value: baseUrl }, // see --env flag
      { name: 'QUERY_URL', value: queryUrl },
      { name: 'VERSION', value: packageInfo.version }
    ]
  }
}

export async function getApiFile (app, file, query) {
  const config = app.get('api')
  file = _.get(config, file)
  const result = await envsub({
    templateFile: file,
    outputFile: file + '.envsubh',
    options: getEnvsubOptions(app, query)
  })
  return JSON.parse(result.outputContents)
}

export function isFeaturesService (service) {
  return (_.get(service, 'remoteOptions.modelName') === 'features')
}

export function getPagination (service, query = {}) {
  let { limit: defaultLimit, offset: defaultOffset, max: globalMax } = getDefaults()

  // Default service limit
  const serviceDefault = _.get(service, 'remoteOptions.paginate.default')
  if (serviceDefault && serviceDefault < defaultLimit) defaultLimit = serviceDefault

  // Max service
  const serviceMax = _.get(service, 'remoteOptions.paginate.max')

  // Max effective = most restrictive
  let effectiveMax = serviceMax
  if (globalMax && (!serviceMax || globalMax < serviceMax)) effectiveMax = globalMax

  // $limit management
  let limit = _.get(query, '$limit', null)
  // Not defined in the query → set the default
  if (limit === null) limit = defaultLimit
  // If defined → limit it
  if (effectiveMax && limit > effectiveMax) limit = effectiveMax

  // $skip management
  let offset = _.get(query, '$skip', null)
  if (offset === null) offset = defaultOffset

  return { limit, offset }
}

function getServiceOptions (serviceName, service) {
  const services = config.services
  if (typeof services === 'function') return services(serviceName, service)
  else return (services && services[serviceName])
}

export function isExposedService (serviceName, service) {
  if (!service.remote) return false
  // Specific features services can be blacklisted using distribution config
  if (isFeaturesService(service)) return true
  // Additional non-features services can be whitelisted in config
  const options = getServiceOptions(serviceName, service)
  return !_.isNil(options)
}

export function generateCollectionExtent (layer) {
  // TODO: compute spatial extent based on data ?
  return {
    extent: Object.assign({
      spatial: {
        bbox: layer.bbox || [-180, -90, 180, 90],
        crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84'
      }
    }, generateCollectionTemporal(layer))
  }
}

export function generateCollectionTemporal (layer) {
  const { timeUnit } = getDefaults()

  const now = moment()
  // TODO: compute time extent based on data ?
  let from = layer.from
  if (from) {
    from = moment.duration(from)
    // Depending on the duration format we might have negative or positive values
    from = (from.asMilliseconds() > 0
      ? now.clone().subtract(from)
      : now.clone().add(from))
  }
  let to = layer.to
  if (to) {
    to = moment.duration(to)
    // Depending on the duration format we might have negative or positive values
    to = (to.asMilliseconds() > 0
      ? now.clone().subtract(to)
      : now.clone().add(to))
  }
  if (!from && !to) return {}
  return {
    temporal: {
      interval: [[
        from ? from.startOf(timeUnit).toISOString() : null,
        to ? to.endOf(timeUnit).toISOString() : null
      ]],
      trs: 'http://www.opengis.net/def/uom/ISO-8601/0/Gregorian'
    }
  }
}

export function generateCollectionLinks (baseUrl, name, query) {
  // Report input query parameters if any (eg token)
  let queryUrl = new URLSearchParams(query).toString()
  if (queryUrl) queryUrl = `?${queryUrl}`
  return [{
    href: `${baseUrl}/collections/${name}/items${queryUrl}`,
    rel: 'items',
    type: 'application/geo+json',
    title: 'The collection features as GeoJSON'
  },
  {
    href: `${baseUrl}/collections/${name}${queryUrl}`,
    rel: 'self',
    type: 'application/json',
    title: 'The collection as JSON'
  }]
}

export function generateFeatureCollectionLinks (baseUrl, name, query, pagination, features) {
  let { limit, offset } = pagination
  limit = _.toNumber(_.get(query, 'limit', limit))
  offset = _.toNumber(_.get(query, 'offset', offset))
  const hasNextPage = ((features.numberReturned + offset) < features.numberMatched)
  // Report input query parameters
  const queryUrl = new URLSearchParams(_.omit(query, ['limit', 'offset'])).toString()
  let href = `${baseUrl}/collections/${name}/items?limit=${limit}&offset=${offset}`
  if (queryUrl) href += `&${queryUrl}`
  const links = [{
    href,
    rel: 'self',
    type: 'application/geo+json',
    title: 'The current page of collection features as GeoJSON'
  }]
  // Report input query parameters and update limit/offset for next page if any
  if (hasNextPage) {
    href = `${baseUrl}/collections/${name}/items?limit=${limit}&offset=${offset + limit}`
    if (queryUrl) href += `&${queryUrl}`
    links.push({
      href,
      rel: 'next',
      type: 'application/json',
      title: 'The next page of collection features as GeoJSON'
    })
  }
  return links
}

export function generateCollectionSortOrder (layer) {
  const sortOrder = {}
  // For layer with temporal dimension we sort by descending time by default
  if (layer.from || layer.to || layer.every) {
    sortOrder.defaultSortOrder = ['-time']
  }
  return sortOrder
}

export function generateCollection (baseUrl, name, title, description, query) {
  const links = generateCollectionLinks(baseUrl, name, query)
  return {
    id: name,
    title,
    description,
    itemType: 'feature',
    links,
    crs: [
      'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
      'http://www.opengis.net/def/crs/OGC/1.3/4326'
    ]
  }
}

export function getCollectionName (serviceName, filterName) {
  return (filterName ? serviceName + FilterCharacter + _.kebabCase(filterName) : serviceName)
}

export function generateCollections (baseUrl, layer) {
  debug(`Generating collections for layer ${layer.name}`)
  const collections = []
  // Take i18n into account if any
  const title = _.get(layer, `i18n.en.${layer.name}`, layer.name)
  const description = _.get(layer, `i18n.en.${layer.description}`, layer.description)
  const extent = generateCollectionExtent(layer)
  const sortOrder = generateCollectionSortOrder(layer)
  // Probe service as well ?
  if (layer.probeService) {
    const measuresCollection = Object.assign(generateCollection(baseUrl, getCollectionName(layer.service), title + ' (measures)', description), extent, sortOrder)
    collections.push(measuresCollection)
    const stationsCollection = Object.assign(generateCollection(baseUrl, getCollectionName(layer.probeService), title + ' (stations)', description), extent, sortOrder)
    collections.push(stationsCollection)
  } else {
    const collection = Object.assign(generateCollection(baseUrl, getCollectionName(layer.service), title, description), extent, sortOrder)
    collections.push(collection)
  }
  // In case of a filtered layer we provide one collection per filter as well
  if (layer.filters) {
    layer.filters.forEach(filter => {
      // Take i18n into account if any
      const filterTitle = _.get(layer, `i18n.en.${filter.label}`, filter.label)
      const filterName = filter.name || filterTitle
      if (layer.probeService) {
        const measuresCollection = Object.assign(generateCollection(baseUrl, getCollectionName(layer.service, filterName), title + ` (measures) - ${filterTitle}`, description), extent, sortOrder)
        collections.push(measuresCollection)
        const stationsCollection = Object.assign(generateCollection(baseUrl, getCollectionName(layer.probeService, filterName), title + ` (stations) - ${filterTitle}`, description), extent, sortOrder)
        collections.push(stationsCollection)
      } else {
        const collection = Object.assign(generateCollection(baseUrl, getCollectionName(layer.service, filterName), title + ` - ${filterTitle}`, description), extent, sortOrder)
        collections.push(collection)
      }
    })
  }
  return collections
}

export async function getLayerForService (app, name, context) {
  const apiPath = app.get('apiPath')
  // Try to use any catalog service available
  const catalogPath = stripSlashes(context ? `${apiPath}/${context}/catalog` : `${apiPath}/catalog`)
  const servicePath = stripSlashes(context ? `${apiPath}/${context}/${name}` : `${apiPath}/${name}`)
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
  throw new NotFound(`Cannot find layer for collection ${name}`)
}

export async function getCollection (app, name, context) {
  const { serviceName } = getServiceAndFilterForCollection(app, name)
  const layer = await getLayerForService(app, serviceName, context)
  const baseUrl = app.get('baseUrl')
  const collections = generateCollections(baseUrl, layer)
  // Select the right collection
  return _.find(collections, { id: name })
}

// Take care of possible filter used in collection name
export function getServiceAndFilterForCollection (app, collection) {
  let serviceName = collection
  let filterName
  const tokens = collection.split(FilterCharacter)
  // First element will be service name, second element being the filter name
  if (tokens.length > 1) {
    serviceName = tokens.shift()
    filterName = tokens.shift()
  }
  return { serviceName, filterName }
}

// Take care of possible filter used in collection name
export async function getServiceForCollection (app, collection, context) {
  const { serviceName, filterName } = getServiceAndFilterForCollection(app, collection)
  const filterQuery = {}
  if (filterName) {
    const layer = await getLayerForService(app, serviceName, context)
    const filter = layer.filters.find(filter => {
      // Take i18n into account if any
      const filterTitle = _.get(layer, `i18n.en.${filter.label}`, filter.label)
      const layerFilterName = filter.name || filterTitle
      return (_.kebabCase(layerFilterName) === filterName)
    })
    Object.assign(filterQuery, filter.active)
  }
  const apiPath = app.get('apiPath')
  const servicePath = (context ? `${apiPath}/${context}/${serviceName}` : `${apiPath}/${serviceName}`)
  debug(`Requesting service ${serviceName} on path ${servicePath} for collection ${collection}`)
  return {
    serviceName,
    servicePath,
    filterName,
    filterQuery
  }
}

export async function getFeaturesFromService (app, collection, query, context) {
  const baseUrl = app.get('baseUrl')
  const { serviceName, servicePath, filterName, filterQuery } = await getServiceForCollection(app, collection, context)
  const featureService = app.service(servicePath)
  const options = getServiceOptions(serviceName, featureService)
  // Keep track of original query as it will be updated by conversion
  const originalQuery = _.cloneDeep(query)
  // Any query parameter is assumed to be a filter on feature properties except reserved ones
  query = _.omit(query, app.get('reservedQueryParameters'))
  const convertedQuery = convertQuery(query, {
    properties: _.get(options, 'properties', isFeaturesService(featureService))
  })
  Object.assign(convertedQuery, filterQuery)
  if (!isFeaturesService(featureService)) {
    // Specific query parameters to make service compliant with features service interfaces ?
    if (options.query) Object.assign(convertedQuery, options.query)
  }
  // Default pagination
  const pagination = getPagination(featureService, convertedQuery)
  convertedQuery.$limit = pagination.limit
  convertedQuery.$skip = pagination.offset
  debug(`Requesting feature collection on path ${servicePath}`, convertedQuery)
  const featureCollection = await featureService.find({ query: convertedQuery })
  convertFeatureCollection(featureCollection)
  Object.assign(featureCollection, { links: generateFeatureCollectionLinks(baseUrl, getCollectionName(serviceName, filterName), originalQuery, pagination, featureCollection) })
  return featureCollection
}

export function generateFeatureLinks (baseUrl, name, query, feature) {
  // Report input query parameters if any (eg token)
  let queryUrl = new URLSearchParams(query).toString()
  if (queryUrl) queryUrl = `?${queryUrl}`

  return [{
    href: `${baseUrl}/collections/${name}/items/${feature.id}${queryUrl}`,
    rel: 'self',
    type: 'application/geo+json',
    title: 'The feature as GeoJSON'
  },
  {
    href: `${baseUrl}/collections/${name}${queryUrl}`,
    rel: 'collection',
    type: 'application/json',
    title: 'The collection as JSON'
  }]
}

export async function getFeatureFromService (app, collection, id, context) {
  const { serviceName, servicePath } = await getServiceForCollection(app, collection, context)
  debug(`Requesting feature on path ${servicePath}`, id)
  const featureService = app.service(servicePath)
  const options = getServiceOptions(serviceName, featureService)
  const query = {}
  if (!isFeaturesService(featureService)) {
    // Specific query parameters to make service compliant with features service interfaces ?
    if (options.query) Object.assign(query, options.query)
  }
  const feature = await featureService.get(id, { query })
  return convertFeature(feature)
}
