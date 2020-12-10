#!/usr/bin/env node
const minimist = require('minimist')
const { Server, Client } = require('..')

const argv = minimist(process.argv.slice(2), {
  string: ['host', 'port'],
  alias: {
    host: 'h',
    port: 'p'
  }
})
const version = `hyperspace-mirror/${require('../package.json').version} ${process.platform}-${process.arch} node-${process.version}`
const help = `The Hyperspace mirroring service.
${version}

Usage: hyperspace-mirror [options]

  --host,      -h  Set unix socket name
  --port       -p  Set the port (will use TCP)
`

if (argv.help) {
  console.error(help)
  process.exit(0)
}
main().catch(onerror)

async function main () {
  console.log('Running ' + version)

  const s = new Server({
    host: argv.host,
    port: argv.port
  })
  global.hyperspaceMirror = s

  s.on('client-open', () => {
    console.log('Remote client opened')
  })
  s.on('client-close', () => {
    console.log('Remote client closed')
  })
  s.on('close', () => process.exit(0))

  process.once('SIGINT', close)
  process.once('SIGTERM', close)

  try {
    await s.open()
  } catch (err) {
    const c = new Client()
    let mirroring

    try {
      mirroring = await c.list()
    } catch (_) {}

    if (mirroring) {
      console.log('Mirroring server is already running')
      process.exit(1)
    } else {
      throw err
    }
  }

  const socketOpts = s._socketOpts
  if (socketOpts.port) {
    console.log(`Listening on ${socketOpts.host || 'localhost'}:${socketOpts.port}`)
  } else {
    console.log(`Listening on ${socketOpts}`)
  }

  function close () {
    console.log('Shutting down...')
    s.close().catch(onerror)
  }
}

function onerror (err) {
  console.error(err.stack)
  process.exit(1)
}
