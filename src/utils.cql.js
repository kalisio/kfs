import _ from 'lodash'
import makeDebug from 'debug'
import errors from '@feathersjs/errors'
import { parse as parseWtk } from 'wellknown'
import { convertValue, convertDateTime } from './utils.js'

const debug = makeDebug('kfs:utils:cql')
const { BadRequest } = errors

export function convertSpatialTextCqlExpression (expression, operator) {
  const cqlJson = {}
  if (expression.startsWith(`${operator}(`)) {
    // Omit enclosing operator to manage operands
    expression = expression.replace(`${operator}(`, '')
    expression = expression.substring(0, expression.length - 1)
    const index = expression.indexOf(',')
    expression = [expression.substring(0, index), expression.substring(index + 1)]
    if (expression.length !== 2) throw new BadRequest(`Invalid ${operator} operator specification`)
    const geometry = parseWtk(expression[1])
    if (!geometry) throw new BadRequest(`Invalid WTK geometry specification ${expression[1]}`)
    cqlJson[_.lowerCase(operator)] = [{ property: expression[0] }, geometry]
  }
  return cqlJson
}

export function convertTextToJsonCql (expression) {
  const cqlJson = {}
  const operators = ['INTERSECTS', 'WITHIN']
  operators.forEach(operator => {
    Object.assign(cqlJson, convertSpatialTextCqlExpression(expression, operator))
  })
  return cqlJson
}

export function convertComparisonCqlOperator (expression, operator) {
  const query = {}
  if (_.has(expression, operator)) {
    const property = _.get(expression, `${operator}[0].property`)
    const value = _.get(expression, `${operator}[1]`)
    if (!property) throw new BadRequest('Invalid comparison operator specification')
    query[property] = { [`$${operator}`]: convertValue(value) }
  }
  return query
}

export function convertComparisonCqlExpression (expression) {
  const query = {}
  const operators = ['eq', 'lt', 'gt', 'lte', 'gte']
  operators.forEach(operator => {
    Object.assign(query, convertComparisonCqlOperator(expression, operator))
  })
  if (expression.between) {
    const property = _.get(expression, 'between.value.property')
    if (!property) throw new BadRequest('Invalid between operator specification')
    const lower = _.get(expression, 'between.lower')
    const upper = _.get(expression, 'between.upper')
    query[property] = { $gte: convertValue(lower), $lte: convertValue(upper) }
  }
  if (expression.in) {
    const property = _.get(expression, 'in.value.property')
    if (!property) throw new BadRequest('Invalid in operator specification')
    const list = _.get(expression, 'in.list')
    query[property] = { $in: convertValue(list) }
  }
  return query
}

export function convertTemporalCqlExpression (expression) {
  const query = {}
  if (expression.before) {
    const property = _.get(expression, 'before[0].property')
    const upper = _.get(expression, 'before[1]')
    if (!property || !upper) throw new BadRequest('Invalid before operator specification')
    query[property] = { $lt: convertDateTime(upper) }
  } else if (expression.after) {
    const property = _.get(expression, 'after[0].property')
    const lower = _.get(expression, 'after[1]')
    if (!property || !lower) throw new BadRequest('Invalid after operator specification')
    query[property] = { $gt: convertDateTime(lower) }
  } else if (expression.during) {
    const property = _.get(expression, 'during[0].property')
    const lower = _.get(expression, 'during[1][0]')
    const upper = _.get(expression, 'during[1][1]')
    if (!property || !lower || !upper) throw new BadRequest('Invalid during operator specification')
    query[property] = { $gte: convertDateTime(lower), $lte: convertDateTime(upper) }
  }
  return query
}

export function convertSpatialCqlExpression (expression) {
  const query = {}
  if (expression.intersects) {
    const property = _.get(expression, 'intersects[0].property', 'geometry')
    const geometry = _.get(expression, 'intersects[1]')
    if (!property || !geometry) throw new BadRequest('Invalid spatial operator specification')
    debug('Processed CQL intersects geometry:', geometry)
    query[property] = {
      $geoIntersects: {
        $geometry: geometry
      }
    }
  } else if (expression.within) {
    const property = _.get(expression, 'within[0].property', 'geometry')
    const geometry = _.get(expression, 'within[1]')
    if (!property || !geometry) throw new BadRequest('Invalid spatial operator specification')
    debug('Processed CQL within geometry:', geometry)
    query[property] = {
      $geoWithin: {
        $geometry: geometry
      }
    }
  }
  return query
}

export function convertLogicalCqlOperator (expression, operator) {
  const query = {}
  if (_.has(expression, operator)) {
    if (operator !== 'not') query[`$${operator}`] = []
    _.get(expression, operator).forEach(subexpression => {
      const subquery = convertCqlExpression(subexpression)
      if (operator === 'not') {
        // { not: { in: { value: { property: 'category' }, list: [] } } } should become
        // { category: { $not: { $in: [] } } } and subquery is like { category: { $in: [] } }
        const keys = Object.keys(subquery)
        if (keys.length !== 1) throw new BadRequest('Invalid not operator specification')
        query[keys[0]] = { $not: subquery[keys[0]] }
      } else {
        query[`$${operator}`].push(subquery)
      }
    })
  }
  return query
}

export function convertLogicalCqlExpression (expression) {
  const query = {}
  const operators = ['and', 'or', 'not']
  operators.forEach(operator => {
    Object.assign(query, convertLogicalCqlOperator(expression, operator))
  })
  return query
}

export function convertCqlExpression (expression) {
  const query = {}
  // Merge as different operators might target the same property
  Object.assign(query,
    convertLogicalCqlExpression(expression),
    convertComparisonCqlExpression(expression),
    convertTemporalCqlExpression(expression),
    convertSpatialCqlExpression(expression))
  return query
}

export function convertCqlQuery (query) {
  const encoding = _.get(query, 'filter-lang', 'cql-json')
  // TODO: we support a small subset of text encoding
  // We experimented various BNF parser without success (bnf and abnf nodejs modules, OpenLayers v2 CQL parser)
  //if (encoding !== 'cql-json') throw new BadRequest('Only JSON encoding of CQL is supported')
  let filter = _.get(query, 'filter')
  if (encoding === 'cql-text') {
    filter = convertTextToJsonCql(filter)
    debug('Converted CQL expression from text', filter)
  }
  return convertCqlExpression(filter)
}
