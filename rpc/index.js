const messages = require('./messages')
const HRPC = require('hrpc-runtime')
const RPC = require('hrpc-runtime/rpc')

const errorEncoding = {
  encode: messages.RPCError.encode,
  encodingLength: messages.RPCError.encodingLength,
  decode (buf, offset) {
    const { message, code, errno, details } = messages.RPCError.decode(buf, offset)
    errorEncoding.decode.bytes = messages.RPCError.decode.bytes
    const err = new Error(message)
    err.code = code
    err.errno = errno
    err.details = details
    return err
  }
}

class HRPCServiceMirror {
  constructor (rpc) {
    const service = rpc.defineService({ id: 1 })

    this._mirror = service.defineMethod({
      id: 1,
      requestEncoding: messages.MirrorRequest,
      responseEncoding: messages.MirrorStatus
    })

    this._unmirror = service.defineMethod({
      id: 2,
      requestEncoding: messages.MirrorRequest,
      responseEncoding: messages.MirrorStatus
    })

    this._status = service.defineMethod({
      id: 3,
      requestEncoding: messages.MirrorRequest,
      responseEncoding: messages.MirrorStatus
    })

    this._list = service.defineMethod({
      id: 4,
      requestEncoding: RPC.NULL,
      responseEncoding: messages.ListResponse
    })

    this._stop = service.defineMethod({
      id: 5,
      requestEncoding: RPC.NULL,
      responseEncoding: RPC.NULL
    })
  }

  onRequest (context, handlers = context) {
    if (handlers.mirror) this._mirror.onrequest = handlers.mirror.bind(context)
    if (handlers.unmirror) this._unmirror.onrequest = handlers.unmirror.bind(context)
    if (handlers.status) this._status.onrequest = handlers.status.bind(context)
    if (handlers.list) this._list.onrequest = handlers.list.bind(context)
    if (handlers.stop) this._stop.onrequest = handlers.stop.bind(context)
  }

  mirror (data) {
    return this._mirror.request(data)
  }

  mirrorNoReply (data) {
    return this._mirror.requestNoReply(data)
  }

  unmirror (data) {
    return this._unmirror.request(data)
  }

  unmirrorNoReply (data) {
    return this._unmirror.requestNoReply(data)
  }

  status (data) {
    return this._status.request(data)
  }

  statusNoReply (data) {
    return this._status.requestNoReply(data)
  }

  list () {
    return this._list.request()
  }

  listNoReply () {
    return this._list.requestNoReply()
  }

  stop () {
    return this._stop.request()
  }

  stopNoReply () {
    return this._stop.requestNoReply()
  }
}

module.exports = class HRPCSession extends HRPC {
  constructor (rawSocket, { maxSize = 2 * 1024 * 1024 * 1024 } = {}) {
    super()

    this.rawSocket = rawSocket
    this.rawSocketError = null
    rawSocket.on('error', (err) => {
      this.rawSocketError = err
    })

    const rpc = new RPC({ errorEncoding, maxSize })
    rpc.pipe(this.rawSocket).pipe(rpc)
    rpc.on('close', () => this.emit('close'))
    rpc.on('error', (err) => {
      if ((err !== this.rawSocketError && !isStreamError(err)) || this.listenerCount('error')) this.emit('error', err)
    })

    this.mirror = new HRPCServiceMirror(rpc)
  }

  destroy (err) {
    this.rawSocket.destroy(err)
  }
}

function isStreamError (err) {
  return err.message === 'Writable stream closed prematurely' || err.message === 'Readable stream closed prematurely'
}
