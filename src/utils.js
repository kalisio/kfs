import _ from 'lodash'
import envsub from 'envsub'

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
    title: 'The layer features as GeoJSON'
  },
  {
    href: `${baseUrl}/collections/${name}?f=application/json`,
    rel: 'data',
    type: 'application/json',
    title: 'The layer as JSON'
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

export function convertQuery (query) {
  const convertedQuery = {}
  if (query.limit) {
    convertedQuery.$limit = query.limit
  }
  if (query.offset) {
    convertedQuery.$skip = query.offset
  }
  if (query.bbox) {
    Object.assign(convertedQuery, { south: query.bbox[1], north: query.bbox[3], east: query.bbox[0], west: query.bbox[2] })
  }
  if (query.datetime) {
    // TODO
  }
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
