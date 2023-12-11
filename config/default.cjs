const path = require('path')
const winston = require('winston')

const host = process.env.HOSTNAME || 'localhost'
const port = process.env.PORT || 8081
const apiPath = process.env.API_PREFIX || '/api'
/* Use to test HTTPS locally, useful for OGC conformance test suite,
  please refer to https://web.dev/articles/how-to-use-local-https for setup */
const https = {
  key: '/home/luc/Development/localhost-key.pem',
  cert: '/home/luc/Development/localhost.pem'
}
const baseUrl = process.env.BASE_URL || (https ? `https://${host}:${port}${apiPath}` : `http://${host}:${port}${apiPath}`)

module.exports = {
  host,
  port,
  https,
  baseUrl,
  apiPath,
  api: {
    landingPage: path.join(__dirname, 'api-landing-page.json'),
    definition: path.join(__dirname, 'api-definition.json'),
    conformance: path.join(__dirname, 'api-conformance.json')
  },
  // List of tokens not to be taken into account for feature filtering
  reservedQueryParameters: ['jwt', 'token'],
  logs: {
    Console: {
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
      level: (process.env.NODE_ENV === 'development' ? 'verbose' : 'info')
    },
    DailyRotateFile: {
      format: winston.format.json(),
      dirname: path.join(__dirname, '..', 'logs'),
      filename: 'kfs-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d'
    }
  },
  distribution: { // Distribute no services simply use remote ones from Kano
    services: (service) => false,
    remoteServices: (service) => (service.key === 'kano'),
    healthcheckPath: apiPath + '/distribution/'
  }
}
