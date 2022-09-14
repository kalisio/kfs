#!/usr/bin/env node

import createServer from './main.js'

async function run () {
  try {
    await createServer()
  } catch (error) {
    process.exit(1)
  }
}

run()
