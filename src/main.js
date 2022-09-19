const _ = require('lodash')
const fs = require('fs-extra')
const winston = require('winston')
require('winston-daily-rotate-file')
const compress = require('compression')
const cors = require('cors')
const helmet = require('helmet')
const feathers = require('@feathersjs/feathers')
const configuration = require('@feathersjs/configuration')
const express = require('@feathersjs/express')
const distribution = require('@kalisio/feathers-distributed')
const hooks = require('./hooks.js')
const channels = require('./channels.js')
const routes = require('./routes.js')
const middlewares = require('./middlewares.js')

const { rest } = express

module.exports = async function createServer () {
  const app = express(feathers())
  // Override Feathers configure that do not manage async operations,
  // here we also simply call the function given as parameter but await for it
  app.configure = async function (fn) {
    await fn.call(this, this)
    return this
  }
  app.configure(configuration())
  // Get distributed services
  app.configure(distribution(app.get('distribution')))
  // Enable CORS, security, compression, and body parsing
  app.use(cors(app.get('cors')))
  app.use(helmet(app.get('helmet')))
  app.use(compress(app.get('compression')))
  const bodyParserConfig = app.get('bodyParser')
  app.use(express.json(_.get(bodyParserConfig, 'json')))
  app.use(express.urlencoded(Object.assign({ extended: true }, _.get(bodyParserConfig, 'urlencoded'))))

  // Set up plugins and providers
  app.configure(rest())

  // Logger
  const config = app.get('logs')
  const logPath = _.get(config, 'DailyRotateFile.dirname')
  // This will ensure the log directory does exist
  fs.ensureDirSync(logPath)
  app.logger = winston.createLogger({
    level: (process.env.NODE_ENV === 'development' ? 'verbose' : 'info'),
    transports: [
      new winston.transports.Console(_.get(config, 'Console')),
      new winston.transports.DailyRotateFile(_.get(config, 'DailyRotateFile'))
    ]
  })
  // Top-level error handler
  process.on('unhandledRejection', (reason, p) =>
    app.logger.error('Unhandled Rejection: ', reason)
  )

  // Register hooks
  app.hooks(hooks)
  // Set up real-time event channels
  app.configure(channels)
  // Configure API routes
  await app.configure(routes)
  // Configure middlewares - always has to be last
  app.configure(middlewares)

  const port = app.get('port')
  app.logger.info('Configuring HTTP server at port ' + port.toString())
  const server = await app.listen(port)
  server.app = app
  server.app.logger.info('Server started listening')

  return server
}
