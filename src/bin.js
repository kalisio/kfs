#!/usr/bin/env node

import createServer from './main.js'

async function run () {
  try {
    await createServer()
  } catch (error) {
    // Use console here as logger might have failed to initialize
    console.error(error)
    process.exit(1)
  }
}

run()
