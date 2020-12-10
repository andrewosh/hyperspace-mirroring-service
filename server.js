const { NanoresourcePromise: Nanoresource } = require('nanoresource-promise/emitter')
const Client = require('./client')
const HyperspaceClient = require('@hyperspace/client')
const Hyperbee = require('hyperbee')
const hyperdrive = require('hyperdrive')

const RPC = require('./rpc')
const getNetworkOptions = require('./rpc/socket.js')

const DB_NAMESPACE = 'hyperspace-mirroring-service'
const DB_VERSION = 'v1'
const CORES_SUB = 'cores'
const TYPES_SUB = 'types'

module.exports = class MirroringService extends Nanoresource {
  constructor (opts = {}) {
    super()
    this.server = RPC.createServer(opts.server, this._onConnection.bind(this))
    this.mirroring = new Set()
    this.downloads = new Map()
    this.hsClient = null
    this.db = null

    this._corestore = null
    this._socketOpts = getNetworkOptions(opts)
  }

  // Nanoresource Methods

  async _open () {
    let running = false
    try {
      const client = new Client({ ...this._socketOpts, noRetry: true })
      await client.ready()
      running = true
    } catch (_) {}
    if (running) throw new Error('A mirroring server is already running on that host/port.')

    this.hsClient = new HyperspaceClient()
    await this.hsClient.ready()
    this._corestore = this.hsClient.corestore(DB_NAMESPACE)

    const rootDb = new Hyperbee(this._corestore.default(), {
      keyEncoding: 'utf-8',
      valueEncoding: 'json'
    }).sub(DB_VERSION)
    await rootDb.ready()
    this.coresDb = rootDb.sub(CORES_SUB)
    this.typesDb = rootDb.sub(TYPES_SUB)

    await this.server.listen(this._socketOpts)
    return this._restartMirroring()
  }

  async _close () {
    await this.server.close()
    for (const { core, request } of  this.downloads.values()) {
      core.undownload(request)
    }
    this.downloads.clear()
    this.mirroring.clear()
    await this.hsClient.close()
  }

  // Mirroring Methods

  async _getDriveCores (key, replicate) {
    const drive = hyperdrive(this._corestore, key)
    drive.on('error', noop)
    await drive.promises.ready()
    if (replicate) await this.hsClient.replicate(drive.metadata)
    return new Promise((resolve, reject) => {
      drive.getContent((err, content) => {
        if (err) return reject(err)
        return resolve({ content, metadata: drive.metadata })
      })
    })
  }

  async _restartMirroring () {
    for await (const { key } of this.coresDb.createReadStream()) {
      await this._mirrorCore(key)
    }
  }

  async _mirrorCore (key, core, noReplicate) {
    core = core || this._corestore.get(key)
    await core.ready()
    if (!noReplicate) await this.hsClient.replicate(core)
    const keyString = (typeof key === 'string') ? key : key.toString('hex')
    this.downloads.set(keyString, {
      core,
      request: core.download()
    })
    // TODO: What metadata should we store?
    await this.coresDb.put(keyString, {})
    this.mirroring.add(keyString)
  }

  // TODO: Make mount-aware
  async _mirrorDrive (key) {
    const { content, metadata } = await this._getDriveCores(key, true)
    return Promise.all([
      this._mirrorCore(metadata.key, metadata, true),
      this._mirrorCore(content.key, content, true)
    ])
  }

  async _unmirrorCore (key, noUnreplicate) {
    const keyString = (typeof key === 'string') ? key : key.toString('hex')
    if (!this.downloads.has(keyString)) return
    const { core, request } = this.downloads.get(keyString)
    if (!noUnreplicate) await this.hsClient.network.configure(core.discoveryKey, {
      announce: false
    })
    core.undownload(request)
    this.downloads.delete(keyString)
    this.mirroring.delete(keyString)
    return this.coresDb.del(keyString)
  }

  // TODO: Make mount-aware
  async _unmirrorDrive (key) {
    const keyString = (typeof key === 'string') ? key : key.toString('hex')
    if (!this.downloads.has(keyString)) return
    const { metadata, content } = await this._getDriveCores(key)
    await this.hsClient.network.configure(metadata.discoveryKey, {
      announce: false
    })
    return Promise.all([
      this._unmirrorCore(metadata.key),
      this._unmirrorCore(content.key)
    ])
  }

  async _mirror ({ key, type }) {
    if (typeof key === 'string') key = Buffer.from(key, 'hex')
    if (!type || type === 'hypercore') await this._mirrorCore(key)
    else if (type === 'hyperdrive') await this._mirrorDrive(key)
    await this.typesDb.put(key.toString('hex'), type)
    return this._status({ key, type })
  }

  async _unmirror ({ key, type }) {
    if (typeof key === 'string') key = Buffer.from(key, 'hex')
    if (!type || type === 'hypercore') await this._unmirrorCore(key)
    else if (type === 'hyperdrive') await this._unmirrorDrive(key)
    await this.typesDb.del(key.toString('hex'))
    return this._status({ key, type })
  }

  // Info Methods

  _status ({ key, type }) {
    const keyString = (typeof key === 'string') ? key : key.toString('hex')
    return {
      key,
      type,
      mirroring: this.mirroring.has(keyString)
    }
  }

  async _list () {
    const mirroring = []
    for await (const { key, value: type } of this.typesDb.createReadStream()) {
      mirroring.push({
        type,
        key: Buffer.from(key, 'hex'),
        mirroring: true
      })
    }
    return {
      mirroring
    }
  }

  // Connection Handling

  _onConnection (client) {
    this.emit('client-open', client)
    client.on('close', () => {
      this.emit('client-close', client)
    })
    client.mirror.onRequest({
      mirror: this._mirror.bind(this),
      unmirror: this._unmirror.bind(this),
      status: this._status.bind(this),
      list: this._list.bind(this),
      stop: this._close.bind(this),
    })
  }
}

function noop () {}
