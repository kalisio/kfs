export const Defaults = {
  limit: process.env.LIMIT || 500,
  offset: process.env.OFFSET || 0,
  timeUnit: process.env.TIME_UNIT || 'minute'
}

export function getDefaults () {
  return Defaults
}
