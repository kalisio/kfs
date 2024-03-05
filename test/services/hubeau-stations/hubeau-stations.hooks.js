import _ from 'lodash'
import { hooks as kdkCoreHooks } from '@kalisio/kdk/core.api.js'
import { hooks as kdkMapHooks } from '@kalisio/kdk/map.api.js'

export default {
  before: {
    all: [kdkCoreHooks.marshallTimeQuery],
    find: [kdkCoreHooks.marshallComparisonQuery, kdkMapHooks.marshallSpatialQuery],
    get: [],
    create: [kdkCoreHooks.processTimes(['time'])],
    update: [],
    patch: [],
    remove: []
  },

  after: {
    all: [],
    find: [kdkMapHooks.asGeoJson()],
    get: [],
    create: [],
    update: [],
    patch: [],
    remove: []
  },

  error: {
    all: [],
    find: [],
    get: [],
    create: [],
    update: [],
    patch: [],
    remove: []
  }
}
