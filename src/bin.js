#!/usr/bin/env node

import createServer from './main.js'

try {
  await createServer()
} catch (error) {
  process.exit(1)
}
