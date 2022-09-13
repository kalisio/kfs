const path = require('path')
const containerized = require('containerized')()

// Use default app config
const config = require(path.join(__dirname, '../../config/default.cjs'))

// Simply changes outputs so we don't pollute DB, logs, etc.
config.logs.DailyRotateFile.dirname = path.join(__dirname, '..', 'logs')
// This is for KDK test app
config.db = {
  adapter: 'mongodb',
  url: (containerized ? 'mongodb://mongodb:27017/kfs-test' : 'mongodb://127.0.0.1:27017/kfs-test')
}

module.exports = config
