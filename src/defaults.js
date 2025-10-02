export const Defaults = {
  limit: process.env.LIMIT ? Number(process.env.LIMIT) : 500,
  offset: process.env.OFFSET ? Number(process.env.OFFSET) : 0,
  timeUnit: process.env.TIME_UNIT || 'minute',
  max: process.env.MAX ? Number(process.env.MAX) : null
}

export function getDefaults () {
  return Defaults
}
