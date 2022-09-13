import _ from 'lodash'
import path from 'path'
import fs from 'fs-extra'
import winston from 'winston'
import 'winston-daily-rotate-file'
import compress from 'compression'
import cors from 'cors'
import helmet from 'helmet'
import { fileURLToPath } from 'url'
import feathers from '@feathersjs/feathers'
import configuration from '@feathersjs/configuration'
import errors from '@feathersjs/errors'
import express from '@feathersjs/express'
import hooks from './hooks.js'
import channels from './channels.js'
import middlewares from './middlewares.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { rest } = express

export default async function createServer () {
  const app = express(feathers())
  app.configure(configuration())
  // Enable CORS, security, compression, and body parsing
  app.use(cors(app.get('cors')))
  app.use(helmet(app.get('helmet')))
  app.use(compress(app.get('compression')))
  const bodyParserConfig = app.get('bodyParser')
  app.use(express.json(_.get(bodyParserConfig, 'json')))
  app.use(express.urlencoded(Object.assign({ extended: true }, _.get(bodyParserConfig, 'urlencoded'))))

  // Set up plugins and providers
  app.configure(rest())

  const packageInfo = fs.readJsonSync(path.join(__dirname, '..', 'package.json'))
  app.use(app.get('apiPath') + '/healthcheck', (req, res, next) => {
      const response = {
        name: 'kfs',
        // Allow to override version number for custom build
        version: (process.env.VERSION ? process.env.VERSION : packageInfo.version)
      }
      if (process.env.BUILD_NUMBER) {
        response.buildNumber = process.env.BUILD_NUMBER
      }
      res.json(response)
    })

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
  // Configure middlewares - always has to be last
  app.configure(middlewares)

  const port = app.get('port')
  app.logger.info('Configuring HTTP server at port ' + port.toString())
  const server = await app.listen(port)
  server.app = app
  server.app.logger.info('Server started listening')
  
  return server
}
