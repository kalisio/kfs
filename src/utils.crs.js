import _ from 'lodash'
import makeDebug from 'debug'
import errors from '@feathersjs/errors'
import epsg from 'epsg-index/all.json' with { type: 'json' }

const debug = makeDebug('kfs:utils:crs')
const { BadRequest } = errors
const DefaultCrs = 'http://www.opengis.net/def/crs/OGC/1.3/CRS84'
const DefaultCrsWithHeight = 'http://www.opengis.net/def/crs/OGC/0/CRS84h'

export function isDefaultCrs (crs) {
  return (crs === DefaultCrs) || (crs === DefaultCrsWithHeight)
}

export function getSrid (crs) {
  if (isDefaultCrs(crs)) {
    return 4326
  }
  try {
    if (crs.startsWith('http://www.opengis.net/def/crs/')) {
      return parseInt(crs.substring(crs.lastIndexOf('/') + 1))
    } else if (crs.startsWith('urn:ogc:def:crs:')) {
      return parseInt(crs.substring(crs.lastIndexOf(':') + 1))
    }
  } catch (error) {
    throw new BadRequest('Invalid CRS format')
  }
  return -1
}

export function getEpsg(crs) {
  if (isDefaultCrs()) {
    return epsg['4326']
  } else if (crs.startsWith('urn:ogc:def:crs:EPSG') || crs.startsWith('http://www.opengis.net/def/crs/EPSG')) {
    const srid = getSrid(crs)
    return epsg[`${srid}`]
  }
  throw new BadRequest('Unsupported CRS, only OGC URNs (starting with urn:ogc:def:crs:epsg) and OGC http-URIs (starting with http://www.opengis.net/def/crs/epsg) with EPSG auhority are supported')
}
