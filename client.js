const net = require('net')
const RPC = require('./rpc')
const getNetworkOptions = require('./rpc/socket')

module.exports = class HyperspaceMirroringClient {
  constructor (opts = {}) {
    this.opts = opts
    this._socketOpts = getNetworkOptions(opts)
    this._client = RPC.connect(this._socketOpts)
  }

  static async serverReady (opts) {
    const sock = getNetworkOptions(opts)
    return new Promise((resolve, reject) => {
      retry()

      function retry () {
        const socket = net.connect(sock)
        let connected = false

        socket.on('connect', function () {
          connected = true
          socket.destroy()
        })
        socket.on('error', socket.destroy)
        socket.on('close', function () {
          if (connected) return resolve()
          if (!opts.noRetry) return setTimeout(retry, 100)
          return reject(new Error('Could not connect to server'))
        })
      }
    })
  }

  ready () {
    return HyperspaceMirroringClient.serverReady({ ...this.opts, noRetry: true })
  }

  close () {
    return this._client.destroy()
  }

  // RPC Methods

  status (key, type) {
    if (typeof key === 'string') key = Buffer.from(key, 'hex')
    return this._client.mirror.status({ key, type })
  }

  async list () {
    const rsp = await this._client.mirror.list()
    return rsp.mirroring
  }

  mirror (key, type) {
    if (typeof key === 'string') key = Buffer.from(key, 'hex')
    return this._client.mirror.mirror({ key, type })
  }

  unmirror (key, type) {
    if (typeof key === 'string') key = Buffer.from(key, 'hex')
    return this._client.mirror.unmirror({ key, type })
  }

  stop () {
    return this._client.mirror.stopNoReply()
  }
}
