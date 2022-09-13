const path = require('path')
const winston = require('winston')

const port = process.env.PORT || 8081
const API_PREFIX = '/api'

module.exports = {
  host: process.env.HOSTNAME || 'localhost',
  port: process.env.PORT || 8081,
  apiPath: API_PREFIX,
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
  }
}
