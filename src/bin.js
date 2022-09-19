#!/usr/bin/env node

const createServer = require('./main.js')

async function run () {
  try {
    await createServer()
  } catch (error) {
    process.exit(1)
  }
}

run()
