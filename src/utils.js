import _ from 'lodash'
import moment from 'moment'
import envsub from 'envsub'
import makeDebug from 'debug'
import errors from '@feathersjs/errors'

const debug = makeDebug('kfs:utils')
const { BadRequest } = errors

function getEnvsubOptions (app) {
  const baseUrl = app.get('baseUrl')
  const apiPath = app.get('apiPath')
  return {
    syntax: 'handlebars',
    envs: [
      { name: 'BASE_URL', value: baseUrl }, // see --env flag
      { name: 'API_PREFIX', value: apiPath }
    ]
  }
}

export async function getApiFile (app, file) {
  const config = app.get('api')
  file = _.get(config, file)
  const result = await envsub({
    templateFile: file,
    outputFile: file + '.envsubh',
    options: getEnvsubOptions(app)
  })
  return JSON.parse(result.outputContents)
}

export function generateCollectionExtent (name) {
  // TODO: compute spatial extent based on data
  return {
    extent: {
      spatial: [-180, -90, 180, 90],
      crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84'
    },
    crs: [
      'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
      'http://www.opengis.net/def/crs/OGC/1.3/4326'
    ],
    storageCrs: 'http://www.opengis.net/def/crs/OGC/1.3/4326'
  }
}

export function generateCollectionLinks (baseUrl, name) {
  return [{
    href: `${baseUrl}/collections/${name}/items?f=application/json`,
    rel: 'items',
    type: 'application/geo+json',
    title: 'The collection features as GeoJSON'
  },
  {
    href: `${baseUrl}/collections/${name}?f=application/json`,
    rel: 'data',
    type: 'application/json',
    title: 'The collection as JSON'
  }]
}

export function generateCollection (baseUrl, name, title, description) {
  const links = generateCollectionLinks(baseUrl, name)
  const extent = generateCollectionExtent(name)
  return Object.assign({
    name,
    title,
    description,
    itemType: 'feature',
    links
  }, extent)
}

export function generateCollections (baseUrl, layer) {
  debug('Generating collections for layer', layer)
  const collections = []
  // Take i18n into account if any
  const title = _.get(layer, `i18n.en.${layer.name}`, layer.name)
  const description = _.get(layer, `i18n.en.${layer.description}`, layer.description)
  // Probe service as well ?
  if (layer.probeService) {
    collections.push(generateCollection(baseUrl, layer.service, title + ' (measures)', description))
    collections.push(generateCollection(baseUrl, layer.probeService, title + ' (stations)', description))
  } else {
    collections.push(generateCollection(baseUrl, layer.service, title, description))
  }
  return collections
}

function convertDateTime (value) {
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

export function convertQuery (query) {
  const convertedQuery = {}
  if (query.limit) {
    convertedQuery.$limit = _.toNumber(query.limit)
    delete query.limit
  }
  if (query.offset) {
    convertedQuery.$skip = _.toNumber(query.offset)
    delete query.offset
  }
  if (query.bbox) {
    // TODO: we should support additionnal CRS according to https://docs.ogc.org/DRAFTS/17-069r5.html#_parameter_bbox
    const bbox = query.bbox.split(',').map(value => _.toNumber(value))
    if (bbox.length < 4) throw new BadRequest('The bounding box parameter shall have at least four numbers')
    Object.assign(convertedQuery, { south: bbox[1], north: bbox[3], east: bbox[0], west: bbox[2] })
    delete query.bbox
  }
  if (query.datetime) {
    const timeQuery = {
      $sort: { time: -1 }
    }
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
  // Any other query parameter is assumed to be a filter on feature properties
  _.forOwn(query, (value, key) => {
    // Add implicit properties object
    key = `properties.${key}`
    // Try to automatically convert to target types
    const lowerCaseValue = _.lowerCase(value)
    const date = moment(value, moment.ISO_8601)
    const number = _.toNumber(value)
    const boolean = (lowerCaseValue === 'true') || (lowerCaseValue === 'false')
    if (date.isValid()) convertedQuery[key] = date.toISOString()
    else if (!Number.isNaN(number)) convertedQuery[key] = number
    else if (boolean) convertedQuery[key] = lowerCaseValue === 'true'
    else convertedQuery[key] = value
  })
  return convertedQuery
}

export function convertFeatureCollection (featureCollection) {
  featureCollection.numberMatched = featureCollection.total
  featureCollection.numberReturned = featureCollection.features.length
  delete featureCollection.total
  delete featureCollection.skip
  delete featureCollection.limit
  return featureCollection
}

export async function getFeaturesFromService (app, servicePath, query) {
  const featureService = app.service(servicePath)
  query = convertQuery(query)
  debug(`Requesting feature collection on path ${servicePath}`, query)
  const featureCollection = await featureService.find({ query })
  return convertFeatureCollection(featureCollection)
}

export function generateFeatureLinks (baseUrl, name, feature) {
  return [{
    href: `${baseUrl}/collections/${name}/items/${feature._id}?f=application/json`,
    rel: 'self',
    type: 'application/geo+json',
    title: 'The feature as GeoJSON'
  },
  {
    href: `${baseUrl}/collections/${name}?f=application/json`,
    rel: 'collection',
    type: 'application/json',
    title: 'The collection as JSON'
  }]
}

export function convertFeature (feature) {
  // Nothing specific todo now on
  return feature
}

export async function getFeatureFromService (app, servicePath, id) {
  debug(`Requesting feature on path ${servicePath}`, id)
  const featureService = app.service(servicePath)
  const feature = await featureService.get(id)
  return convertFeature(feature)
}
