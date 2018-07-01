'use strict'

const _ = require('lodash')
const async = require('async')
const GrLink = require('grenache-nodejs-link')
const GrHttp = require('grenache-nodejs-http')
const Base = require('bfx-facs-base')
const fs = require('fs')

class Grc extends Base {
  constructor (caller, opts, ctx) {
    super(caller, opts, ctx)

    this.name = 'grc'
    this._hasConf = true

    if (!this.opts.tickInterval) {
      this.opts.tickInterval = 45000
    }

    if (!this.opts.secPortOffset) {
      this.opts.secPortOffset = 2000
    }

    this.init()
  }

  onRequest (rid, service, payload, handler, cert) {
    if (this.api) {
      const api = this.api

      if (cert) {
        payload._isSecure = true
        payload._auth = {
          fingerprint: cert.fingerprint.toString('hex')
        }
      }

      api.handle(service, payload, (err, res) => {
        handler.reply(_.isString(err) ? new Error(err) : err, res)
      })
    } else {
      this.emit('request', rid, service, payload, handler)
    }
  }

  setupPeers () {
    const ctx = this.ctx
    const cal = this.cal

    if (!this.conf.protos) {
      this.conf.protos = ['gen', 'sec']
    }

    const protos = this.conf.protos

    if (protos.indexOf('gen') > -1) {
      this.peer = new GrHttp.PeerRPCClient(this.link, {
        maxActiveKeyDests: this.opts.maxActiveKeyDests
      })

      this.peerSrv = new GrHttp.PeerRPCServer(this.link, {
        timeout: this.opts.server_timeout || 600000
      })
    }

    if (protos.indexOf('sec') > -1) {
      const secPath = `${this.opts.root}/sec`

      if (fs.existsSync(secPath)) {
        this.peerSec = new GrHttp.PeerRPCClient(this.link, {
          maxActiveKeyDests: this.opts.maxActiveKeyDests,
          secure: {
            key: fs.readFileSync(`${secPath}/client-key.pem`),
            cert: fs.readFileSync(`${secPath}/client-crt.pem`),
            ca: fs.readFileSync(`${secPath}/ca-crt.pem`),
            requestCert: true
          }
        })

        this.peerSecSrv = new GrHttp.PeerRPCServer(this.link, {
          timeout: this.opts.server_timeout || 600000,
          secure: {
            key: fs.readFileSync(`${secPath}/server-key.pem`),
            cert: fs.readFileSync(`${secPath}/server-crt.pem`),
            ca: fs.readFileSync(`${secPath}/ca-crt.pem`),
            requestCert: true
          }
        })

        let acl = null
        try {
          const data = fs.readFileSync(`${secPath}/acl.json`)
          acl = JSON.parse(acl)
        } catch (err) {}

        this.aclSec = acl
      }
    }
  }

  _start (cb) {
    const ctx = this.ctx

    async.series([
      next => { super._start(next) },
      next => {
        this.link = new GrLink({
          grape: this.conf.grape,
          requestTimeout: this.opts.linkRequestTimeout || 2500,
          lruMaxAgeLookup: this.opts.linkRruMaxAgeLookup || 10000
        })

        this.link.start()

        switch (this.conf.transport) {
          case 'http':
            this.setupPeers()
            break
        }

        if (this.peer) {
          this.peer.init()
          this.peerSrv.init()
        }

        if (this.peerSec) {
          this.peerSec.init()
          this.peerSecSrv.init()
        }

        this._tickItv = setInterval(() => {
          this.tick()
        }, this.opts.tickInterval)

        this.tick()

        next()
      }
    ], cb)
  }

  tick () {
    let pubServices = _.clone(this.opts.services)
    if (!_.isArray(pubServices) || !pubServices.length) {
      pubServices = null
    }

    if (!pubServices || !this.opts.svc_port) {
      return
    }

    if (this.peerSec) {
      _.each(pubServices, s => {
        pubServices.push(`sec:${s}`)
      })
    }

    const port = this.opts.svc_port
    if (!port) {
      console.error('no port set')
      console.error('set port via commandline (--apiPort=$PORT)')
      throw new Error('ERR_NO_PORT')
    }

    if (!this.service && this.peerSrv) {
      this.service = this.peerSrv.transport('server')
      this.service.listen(port)
      this.service.on('request', this.onRequest.bind(this))
    }

    if (!this.serviceSec && this.peerSec) {
      this.serviceSec = this.peerSecSrv.transport('server')
      this.serviceSec.listen(port + this.opts.secPortOffset)
      this.serviceSec.on('request', this.onRequest.bind(this))
    }

    async.auto({
      announce: next => {
        async.eachSeries(pubServices, (srv, next) => {
          const tPort = srv.indexOf('sec:') === 0 ? port + this.opts.secPortOffset : port
          this.link.announce(srv, tPort, {}, (err) => {
            if (err) console.error(err)
            next()
          })
        }, next)
      }
    }, (err) => {
      if (err) console.error(err)
    })
  }

  _stop (cb) {
    async.series([
      next => { super._stop(next) },
      next => {
        clearInterval(this._announceItv)

        if (this.service) {
          this.service.stop()
          this.service.removeListener('request', this.onRequest.bind(this))
        }

       if (this.serviceSec) {
          this.serviceSec.stop()
          this.serviceSec.removeListener('request', this.onRequest.bind(this))
        }

        next()
      }
    ], cb)
  }

  setServices (ss) {
    this.opts.services = ss
  }

  addServices (ss) {
    if (!_.isArray(this.opts.services)) {
      this.opts.services = []
    }

    this.opts.services = _.union(this.opts.services, ss)
  }

  delServices (ss) {
    if (!_.isArray(this.opts.services)) {
      this.opts.servies = []
    }

    this.opts.services = _.difference(this.opts.services, ss)
  }

  req (service, action, args, opts = {}, _cb) {
    if (!_.isString(action)) return _cb(new Error('ERR_GRC_REQ_ACTION_INVALID'))
    if (!_.isArray(args)) return _cb(new Error('ERR_GRC_REQ_ARGS_INVALID'))
    if (!_.isFunction(_cb)) return _cb(new Error('ERR_GRC_REQ_CB_INVALID'))

    let isExecuted = false

    const cb = (err, res) => {
      if (err) {
        console.error(service, action, args, err)
      }

      if (isExecuted) {
        console.error('ERR_DOUBLE_CB', service, action, JSON.stringify(args))
        return
      }
      isExecuted = true
      if (err === 'ERR_TIMEOUT') {
        console.error('ERR_TIMEOUT received', service, action)
      }
      _cb(err ? new Error(err) : null, res)
    }

    const peer = service.indexOf('sec:') === 0 ? this.peerSec : this.peer
    peer.request(service, {
      action,
      args
    }, _.defaults({}, {
      timeout: 120000
    }, opts), cb)
  }

  map (service, action, args, opts = {}, _cb) {
    if (!_.isString(action)) return _cb(new Error('ERR_GRC_REQ_ACTION_INVALID'))
    if (!_.isArray(args)) return _cb(new Error('ERR_GRC_REQ_ARGS_INVALID'))
    if (!_.isFunction(_cb)) return _cb(new Error('ERR_GRC_REQ_CB_INVALID'))

    let isExecuted = false

    const cb = (err, res) => {
      if (isExecuted) {
        console.error('ERR_DOUBLE_CB', service, action, JSON.stringify(args))
        return
      }
      isExecuted = true
      if (err === 'ERR_TIMEOUT') {
        console.error('ERR_TIMEOUT received', service, action)
      }
      _cb(err ? new Error(err) : null, res)
    }

    const peer = service.indexOf('sec:') === 0 ? this.peerSec : this.peer

    peer.map(service, {
      action,
      args
    }, _.defaults({}, {
      timeout: 120000
    }, opts), cb)
  }
}

module.exports = Grc
