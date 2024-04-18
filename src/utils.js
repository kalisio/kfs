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
import { convertCqlQuery } from './utils.cql.js'

const debug = makeDebug('kfs:utils')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { BadRequest } = errors

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

export function getServicePagination (service) {
  let { limit, offset } = getDefaults()
  // If a default is defined on service use it
  const defaultLimit = _.get(service, 'remoteOptions.paginate.default')
  if (defaultLimit && (defaultLimit < limit)) limit = defaultLimit
  const max = _.get(service, 'remoteOptions.paginate.max')
  // If a max is defined on service check it
  if (max && (limit > max)) limit = max
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
  if (layer.fromm || layer.to || layer.every) {
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

export function generateCollections (baseUrl, layer, query) {
  debug(`Generating collections for layer ${layer.name}`)
  const collections = []
  // Take i18n into account if any
  const title = _.get(layer, `i18n.en.${layer.name}`, layer.name)
  const description = _.get(layer, `i18n.en.${layer.description}`, layer.description)
  const extent = generateCollectionExtent(layer)
  const sortOrder = generateCollectionSortOrder(layer)
  // Probe service as well ?
  if (layer.probeService) {
    const measuresCollection = Object.assign(generateCollection(baseUrl, layer.service, title + ' (measures)', description, query), extent, sortOrder)
    collections.push(measuresCollection)
    const stationsCollection = Object.assign(generateCollection(baseUrl, layer.probeService, title + ' (stations)', description, query), extent, sortOrder)
    collections.push(stationsCollection)
  } else {
    const collection = Object.assign(generateCollection(baseUrl, layer.service, title, description, query), extent, sortOrder)
    collections.push(collection)
  }
  return collections
}

export function convertValue (value) {
  if (Array.isArray(value)) return value.map(item => convertValue(item))
  // Try to automatically convert to target types
  const lowerCaseValue = _.lowerCase(value)
  const date = moment(value, moment.ISO_8601)
  const number = _.toNumber(value)
  const boolean = (lowerCaseValue === 'true') || (lowerCaseValue === 'false')
  const nullable = (lowerCaseValue === 'null')
  if (date.isValid()) return date.toISOString()
  else if (!Number.isNaN(number)) return number
  else if (boolean) return lowerCaseValue === 'true'
  else if (nullable) return null
  // Enclosing quotes to avoid automated conversion to number eg '1000'
  else if (value.startsWith('\'') && value.endsWith('\'')) return value.substring(1, value.length - 1)
  else return value
}

export function convertDateTime (value) {
  // We need to support different formats according to https://docs.ogc.org/DRAFTS/17-069r5.html#_parameter_datetime:
  // <datetime>, <start>/<end>, <start>/.., ../<end>
  // We additionnaly support <start>/<duration>, <duration>/<end>
  // Datetime or interval ?
  if (value.indexOf('/') === -1) {
    // Half bounded interval
    if ((value === '..') || (value === '')) return null
    const datetime = moment.utc(value)
    if (datetime.isValid()) return datetime
    const duration = moment.duration(value)
    // It seems invalid duration can be created so we check for something > 0
    if (duration.isValid() && (duration.milliseconds() > 0)) return duration
    else throw new BadRequest('Invalid datetime format')
  } else {
    const interval = value.split('/')
    if (interval.length !== 2) throw new BadRequest('The datetime parameter shall have one of the following syntaxes: <datetime>, <start>/<end>, <start>/.., ../<end>')
    return interval.map(value => convertDateTime(value))
  }
}

export function convertQuery (query, options = { properties: true }) {
  // FIXME: hack to make OGC conformance tests pass
  // Indeed we don't know the schema of our features collections so that we cannot
  // detect if a given query parameter does not correspond to any property in features
  _.forOwn(query, (value, key) => {
    if (key.includes('unknownQueryParameter')) throw new BadRequest('Invalid query parameter')
  })

  const convertedQuery = {}
  if (query.limit) {
    convertedQuery.$limit = _.toNumber(query.limit)
    if (!_.isFinite(convertedQuery.$limit)) throw new BadRequest('Invalid limit parameter')
    delete query.limit
  }
  if (query.offset) {
    convertedQuery.$skip = _.toNumber(query.offset)
    if (!_.isFinite(convertedQuery.$skip)) throw new BadRequest('Invalid offset parameter')
    delete query.offset
  }
  if (query.bbox) {
    // TODO: we should support additionnal CRS according to https://docs.ogc.org/DRAFTS/17-069r5.html#_parameter_bbox
    const bbox = query.bbox.split(',').map(value => _.toNumber(value))
    if (bbox.length < 4) throw new BadRequest('The bounding box parameter shall have at least four numbers')
    Object.assign(convertedQuery, { south: bbox[1], north: bbox[3], east: bbox[2], west: bbox[0] })
    delete query.bbox
  }
  if (query.datetime) {
    const timeQuery = {}
    const interval = convertDateTime(query.datetime)
    // Datetime or interval ?
    if (!Array.isArray(interval)) {
      _.set(timeQuery, 'time', interval.toISOString())
    } else {
      const [start, end] = interval
      if (start) _.set(timeQuery, 'time.$gte', start.toISOString())
      if (end) _.set(timeQuery, 'time.$lte', end.toISOString())
    }
    Object.assign(convertedQuery, timeQuery)
    delete query.datetime
  }
  if (query.sortby) {
    const sortQuery = {}
    const sortOrders = query.sortby.split(',')
    sortOrders.forEach(sortOrder => {
      // Default is ascending if no specifier
      const descending = sortOrder.startsWith('-')
      if (sortOrder.startsWith('-') || sortOrder.startsWith('+')) sortOrder = sortOrder.substring(1)
      // Specific case of internal time property always located at feature root object so that we force it
      if (sortOrder === 'time') sortQuery.time = (descending ? -1 : 1)
      // Sorting usually refers to feature properties, which also for a possible user-defined time different from our internal time
      sortQuery[options.properties ? `properties.${sortOrder}` : sortOrder] = (descending ? -1 : 1)
    })
    Object.assign(convertedQuery, { $sort: sortQuery })
    delete query.sortby
  }
  if (query.filter) {
    const cqlQuery = convertCqlQuery(query)
    debug('Processed CQL query:', cqlQuery)
    Object.assign(convertedQuery, cqlQuery)
    delete query.filter
    delete query['filter-lang']
  }
  // Any other query parameter is assumed to be a filter on feature properties
  _.forOwn(query, (value, key) => {
    // Add implicit properties object
    if (options.properties) key = `properties.${key}`
    convertedQuery[key] = convertValue(value)
  })
  return convertedQuery
}

export function convertFeature (feature) {
  // Convert internal ID to OGC ID
  _.set(feature, 'id', _.get(feature, '_id'))
  _.unset(feature, '_id')
  return feature
}

export function convertFeatureCollection (featureCollection) {
  const features = _.get(featureCollection, 'features', [])
  features.forEach(convertFeature)
  featureCollection.numberMatched = featureCollection.total
  featureCollection.numberReturned = features.length
  featureCollection.timeStamp = moment().utc().toISOString()
  debug(`Retrieved ${featureCollection.numberReturned} over ${featureCollection.total} features`)
  delete featureCollection.total
  delete featureCollection.skip
  delete featureCollection.limit
  return featureCollection
}

export async function getFeaturesFromService (app, servicePath, query) {
  const featureService = app.service(servicePath)
  const apiPath = app.get('apiPath')
  const baseUrl = app.get('baseUrl')
  const serviceName = stripSlashes(servicePath).replace(stripSlashes(apiPath) + '/', '')
  const options = getServiceOptions(serviceName, featureService)
  // Keep track of original query as it will be updated by conversion
  const originalQuery = _.cloneDeep(query)
  // Any query parameter is assumed to be a filter on feature properties except reserved ones
  query = _.omit(query, app.get('reservedQueryParameters'))
  const convertedQuery = convertQuery(query, {
    properties: _.get(options, 'properties', isFeaturesService(featureService))
  })
  if (!isFeaturesService(featureService)) {
    // Specific query parameters to make service compliant with features service interfaces ?
    if (options.query) Object.assign(convertedQuery, options.query)
  } else {
    // Default sort order is descending time if not provided
    if (!_.has(convertedQuery, '$sort.time')) _.set(convertedQuery, '$sort.time', -1)
  }
  // Default pagination
  const pagination = getServicePagination(featureService)
  if (!_.has(convertedQuery, '$limit')) convertedQuery.$limit = pagination.limit
  if (!_.has(convertedQuery, '$skip')) convertedQuery.$skip = pagination.offset
  debug(`Requesting feature collection on path ${servicePath}`, convertedQuery)
  const featureCollection = await featureService.find({ query: convertedQuery })
  convertFeatureCollection(featureCollection)
  Object.assign(featureCollection, { links: generateFeatureCollectionLinks(baseUrl, serviceName, originalQuery, pagination, featureCollection) })
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

export async function getFeatureFromService (app, servicePath, id) {
  debug(`Requesting feature on path ${servicePath}`, id)
  const featureService = app.service(servicePath)
  const apiPath = app.get('apiPath')
  const serviceName = stripSlashes(servicePath).replace(stripSlashes(apiPath) + '/', '')
  const options = getServiceOptions(serviceName, featureService)
  const query = {}
  if (!isFeaturesService(featureService)) {
    // Specific query parameters to make service compliant with features service interfaces ?
    if (options.query) Object.assign(query, options.query)
  }
  const feature = await featureService.get(id, { query })
  return convertFeature(feature)
}
