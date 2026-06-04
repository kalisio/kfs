import _ from 'lodash'
import makeDebug from 'debug'
import errors from '@feathersjs/errors'
import { parse as parseWtk } from 'wellknown'
import { convertValue, convertDateTime } from './utils.convert.js'

const debug = makeDebug('kfs:utils:cql')
const { BadRequest } = errors
// Reserved properties at root level ?
const ReservedProperties = ['time', 'geometry']

// ==================== CQL text → CQL JSON (op/args format) ====================

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
    cqlJson.op = operator.toLowerCase()
    cqlJson.args = [{ property: expression[0] }, geometry]
  }
  return cqlJson
}

export function convertIsNullTextCqlExpression (expression, operator) {
  let cqlJson = {}
  if (expression.endsWith(operator)) {
    // Omit operator to manage operand
    const property = expression.replace(operator, '').trim()
    cqlJson = { op: 'isNull', args: [{ property }] }
    if (operator.includes('NOT')) cqlJson = { op: 'not', args: [cqlJson] }
  }
  return cqlJson
}

export function convertLikeTextCqlExpression (expression) {
  const cqlJson = {}
  const match = expression.match(/^(\w+)\s+(I?LIKE)\s+'([^']*)'$/i)
  if (match) {
    const property = match[1]
    const ilike = match[2].toUpperCase() === 'ILIKE'
    const pattern = match[3]
    cqlJson.op = 'like'
    cqlJson.args = [{ property }, pattern]
    if (ilike) cqlJson.nocase = true
  }
  return cqlJson
}

export function convertTextToJsonCql (expression) {
  const cqlJson = {}
  let operators = ['INTERSECTS', 'WITHIN']
  operators.forEach(operator => {
    Object.assign(cqlJson, convertSpatialTextCqlExpression(expression, operator))
  })
  operators = ['IS NOT NULL', 'IS NULL']
  operators.forEach(operator => {
    Object.assign(cqlJson, convertIsNullTextCqlExpression(expression, operator))
  })
  Object.assign(cqlJson, convertLikeTextCqlExpression(expression))
  return cqlJson
}

// ==================== CQL JSON (op/args format) → MongoDB ====================

function likeToRegex (pattern, options = {}) {
  const wildcard = options.wildcard || '%'
  const singleChar = options.singleChar || '_'
  const escapeChar = options.escapeChar || '\\'
  const nocase = options.nocase || false
  // Build regex char by char so escapeChar is handled before wildcard substitution
  let result = ''
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === escapeChar && i + 1 < pattern.length) {
      result += pattern[++i].replace(/[.+^${}()|[\]\\]/g, '\\$&')
    } else if (char === wildcard) {
      result += '.*'
    } else if (char === singleChar) {
      result += '.'
    } else {
      result += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  // Use PCRE inline flag so the string survives JSON serialization (avoids $options key)
  return nocase ? `(?i)^${result}$` : `^${result}$`
}

export function convertLikeCqlExpression (expression) {
  const query = {}
  if (expression.op !== 'like') return query
  let property = _.get(expression, 'args[0].property')
  if (!ReservedProperties.includes(property)) property = `properties.${property}`
  const pattern = _.get(expression, 'args[1]')
  if (!property || pattern === undefined) throw new BadRequest('Invalid like operator specification')
  query[property] = { $regex: likeToRegex(pattern, {
    nocase: expression.nocase,
    wildcard: expression.wildcard,
    singleChar: expression.singleChar,
    escapeChar: expression.escapeChar
  }) }
  return query
}

export function convertComparisonCqlOperator (expression, operator) {
  const query = {}
  if (expression.op !== operator) return query
  let property = _.get(expression, 'args[0].property')
  if (!ReservedProperties.includes(property)) property = `properties.${property}`
  const value = _.get(expression, 'args[1]')
  if (!property) throw new BadRequest('Invalid comparison operator specification')
  query[property] = { [`$${operator}`]: convertValue(value) }
  return query
}

export function convertComparisonCqlExpression (expression) {
  const query = {}
  const operators = ['eq', 'lt', 'gt', 'lte', 'gte']
  operators.forEach(operator => {
    Object.assign(query, convertComparisonCqlOperator(expression, operator))
  })
  if (expression.op === 'between') {
    let property = _.get(expression, 'args[0].property')
    if (!ReservedProperties.includes(property)) property = `properties.${property}`
    if (!property) throw new BadRequest('Invalid between operator specification')
    const lower = _.get(expression, 'args[1]')
    const upper = _.get(expression, 'args[2]')
    query[property] = { $gte: convertValue(lower), $lte: convertValue(upper) }
  }
  if (expression.op === 'in') {
    let property = _.get(expression, 'args[0].property')
    if (!ReservedProperties.includes(property)) property = `properties.${property}`
    if (!property) throw new BadRequest('Invalid in operator specification')
    const list = _.get(expression, 'args[1]')
    query[property] = { $in: convertValue(list) }
  }
  return query
}

export function convertTemporalCqlExpression (expression) {
  const query = {}
  if (expression.op === 'before') {
    let property = _.get(expression, 'args[0].property')
    if (!ReservedProperties.includes(property)) property = `properties.${property}`
    const upper = _.get(expression, 'args[1]')
    if (!property || !upper) throw new BadRequest('Invalid before operator specification')
    query[property] = { $lt: convertDateTime(upper) }
  } else if (expression.op === 'after') {
    let property = _.get(expression, 'args[0].property')
    if (!ReservedProperties.includes(property)) property = `properties.${property}`
    const lower = _.get(expression, 'args[1]')
    if (!property || !lower) throw new BadRequest('Invalid after operator specification')
    query[property] = { $gt: convertDateTime(lower) }
  } else if (expression.op === 'during') {
    let property = _.get(expression, 'args[0].property')
    if (!ReservedProperties.includes(property)) property = `properties.${property}`
    const lower = _.get(expression, 'args[1][0]')
    const upper = _.get(expression, 'args[1][1]')
    if (!property || !lower || !upper) throw new BadRequest('Invalid during operator specification')
    query[property] = { $gte: convertDateTime(lower), $lte: convertDateTime(upper) }
  }
  return query
}

export function convertSpatialCqlExpression (expression) {
  const query = {}
  if (expression.op === 'intersects') {
    const property = _.get(expression, 'args[0].property', 'geometry')
    const geometry = _.get(expression, 'args[1]')
    if (!property || !geometry) throw new BadRequest('Invalid spatial operator specification')
    debug('Processed CQL intersects geometry:', geometry)
    query[property] = { $geoIntersects: { $geometry: geometry } }
  } else if (expression.op === 'within') {
    const property = _.get(expression, 'args[0].property', 'geometry')
    const geometry = _.get(expression, 'args[1]')
    if (!property || !geometry) throw new BadRequest('Invalid spatial operator specification')
    debug('Processed CQL within geometry:', geometry)
    query[property] = { $geoWithin: { $geometry: geometry } }
  }
  return query
}

export function convertLogicalCqlOperator (expression, operator) {
  const query = {}
  if (expression.op !== operator) return query
  if (operator !== 'not') query[`$${operator}`] = []
  const args = _.get(expression, 'args', [])
  args.forEach(subexpression => {
    const subquery = convertCqlExpression(subexpression)
    if (operator === 'not') {
      // { op: 'not', args: [subexpr] } → { property: { $not: { ... } } }
      const keys = Object.keys(subquery)
      if (keys.length !== 1) throw new BadRequest('Invalid not operator specification')
      query[keys[0]] = { $not: subquery[keys[0]] }
    } else {
      query[`$${operator}`].push(subquery)
    }
  })
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

export function convertIsNullCqlExpression (expression) {
  const query = {}
  if (expression.op !== 'isNull') return query
  let property = _.get(expression, 'args[0].property')
  if (property) {
    if (!ReservedProperties.includes(property)) property = `properties.${property}`
    query[property] = { $eq: null }
  }
  return query
}

export function convertCqlExpression (expression) {
  if (!expression || !expression.op) return {}
  const { op } = expression
  // Dispatch to the appropriate converter based on op
  if (op === 'isNull') return convertIsNullCqlExpression(expression)
  if (['and', 'or', 'not'].includes(op)) return convertLogicalCqlExpression(expression)
  if (['eq', 'lt', 'gt', 'lte', 'gte', 'between', 'in'].includes(op)) return convertComparisonCqlExpression(expression)
  if (op === 'like') return convertLikeCqlExpression(expression)
  if (['before', 'after', 'during'].includes(op)) return convertTemporalCqlExpression(expression)
  if (['intersects', 'within'].includes(op)) return convertSpatialCqlExpression(expression)
  return {}
}

export function convertCqlQuery (query) {
  const encoding = _.get(query, 'filter-lang', 'cql-json')
  // TODO: we support a small subset of text encoding
  // We experimented various BNF parser without success (bnf and abnf nodejs modules, OpenLayers v2 CQL parser)
  // if (encoding !== 'cql-json') throw new BadRequest('Only JSON encoding of CQL is supported')
  let filter = _.get(query, 'filter')
  if (encoding === 'cql-text') {
    // Decode any remaining valid %XX sequences that qs may have left undecoded when
    // a raw % wildcard (not encoded as %25) in the same value caused decodeURIComponent to throw
    if (typeof filter === 'string') filter = filter.replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    const textFilter = filter
    filter = convertTextToJsonCql(filter)
    debug('Converted CQL expression from text', textFilter, filter)
  }
  return convertCqlExpression(filter)
}
