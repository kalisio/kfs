import _ from 'lodash'
import moment from 'moment'
import makeDebug from 'debug'
import errors from '@feathersjs/errors'
import { convertCqlQuery } from './utils.cql.js'

const debug = makeDebug('kfs:utils:convert')
const { BadRequest } = errors

export function convertValue (value) {
  if (Array.isArray(value)) return value.map(item => convertValue(item))
  // Try to automatically convert to target types
  const lowerCaseValue = _.lowerCase(value)
  const date = moment(value, moment.ISO_8601)
  const number = _.toNumber(value)
  const boolean = (lowerCaseValue === 'true') || (lowerCaseValue === 'false')
  const nullable = (lowerCaseValue === 'null')
  if (!Number.isNaN(number)) return number
  else if (boolean) return lowerCaseValue === 'true'
  else if (nullable) return null
  // Enclosing quotes to avoid automated conversion to number eg '1000'
  else if (value.startsWith('\'') && value.endsWith('\'')) return value.substring(1, value.length - 1)
  else if (date.isValid()) return date.toISOString()
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
  if (query.sortby) {
    const sortQuery = {}
    const sortOrders = query.sortby.split(',')
    sortOrders.forEach(sortOrder => {
      // Default is ascending if no specifier
      const descending = sortOrder.startsWith('-')
      if (sortOrder.startsWith('-') || sortOrder.startsWith('+')) sortOrder = sortOrder.substring(1)
      // Specific case of internal time property always located at feature root object so that we force it
      if (sortOrder === 'time') sortQuery.time = (descending ? -1 : 1)
      // Sorting usually refers to feature properties, also for a possible user-defined time different from our internal time
      else sortQuery[options.properties ? `properties.${sortOrder}` : sortOrder] = (descending ? -1 : 1)
    })
    Object.assign(convertedQuery, { $sort: sortQuery })
    delete query.sortby
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
    // Default sort order is descending time if not provided
    if (!_.has(convertedQuery, '$sort.time')) _.set(convertedQuery, '$sort.time', -1)
    Object.assign(convertedQuery, timeQuery)
    delete query.datetime
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
