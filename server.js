const { NanoresourcePromise: Nanoresource } = require('nanoresource-promise/emitter')
const Client = require('./client')
const HyperspaceClient = require('@hyperspace/client')
const Hyperbee = require('hyperbee')
const hyperdrive = require('hyperdrive')

const RPC = require('./rpc')
const getNetworkOptions = require('./rpc/socket.js')

const DB_NAMESPACE = 'hyperspace-mirroring-service/db'
const DB_VERSION = 'v1'

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

    this.db = new Hyperbee(this._corestore.default(), {
      keyEncoding: 'utf-8',
      valueEncoding: 'json'
    }).sub(DB_VERSION)
    await this.db.ready()

    await this.server.listen(this._socketOpts)
    return this._restartMirroring()
  }

  async _close () {
    await this.server.close()
    for (const { core, request } of  this.downloads.values()) {
      console.log('undownloading:', core.key.toString('hex'))
      core.undownload(request)
    }
    this.downloads.clear()
    this.mirroring.clear()
    await this.hsClient.close()
  }

  // Mirroring Methods

  async _getDriveCores (key) {
    const drive = hyperdrive(this._corestore, key)
    drive.on('error', noop)
    await drive.promises.ready()
    return new Promise((resolve, reject) => {
      drive.getContent((err, content) => {
        if (err) return reject(err)
        return resolve({ content, metadata: drive.metadata })
      })
    })
  }

  async _restartMirroring () {
    for await (const { key } of this.db.createReadStream()) {
      console.log('mirroring key:', key.toString('utf8'))
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
    await this.db.put(keyString, {})
    this.mirroring.add(keyString)
  }

  // TODO: Make mount-aware
  async _mirrorDrive (key) {
    const keyString = (typeof key === 'string') ? key : key.toString('hex')
    const { content, metadata } = await this._getDriveCores(key)
    await this.hsClient.replicate(metadata)
    return Promise.all([
      this._mirrorCore(metadata.key, metadata, true),
      this._mirrorCore(content.key, content, true)
    ])
  }

  async _unmirrorCore (key, noUnreplicate) {
    const keyString = (typeof key === 'string') ? key : key.toString('hex')
    console.log('unmirroring core:', keyString)
    if (!this.downloads.has(keyString)) return
    const { core, request } = this.downloads.get(keyString)
    if (!noUnreplicate) await this.hsClient.network.configure(core.discoveryKey, {
      announce: false
    })
    core.undownload(request)
    this.downloads.delete(keyString)
    this.mirroring.delete(keyString)
    return this.db.del(keyString)
  }

  // TODO: Make mount-aware
  async _unmirrorDrive (key) {
    const keyString = (typeof key === 'string') ? key : key.toString('hex')
    console.log('unmirroring drive:', keyString)
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
    return this._status({ key })
  }

  async _unmirror ({ key, type }) {
    if (typeof key === 'string') key = Buffer.from(key, 'hex')
    if (!type || type === 'hypercore') await this._unmirrorCore(key)
    else if (type === 'hyperdrive') await this._unmirrorDrive(key)
    return this._status({ key })
  }

  // Info Methods

  _status ({ key, type }) {
    const keyString = (typeof key === 'string') ? key : key.toString('hex')
    return {
      key,
      mirroring: this.mirroring.has(keyString)
    }
  }

  _list () {
    return {
      mirroring: [...this.mirroring.keys()]
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
