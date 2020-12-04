/* eslint-env mocha */

'use strict'

const assert = require('assert')
const { promisify } = require('util')

const createGrapes = require('bfx-svc-test-helper/grapes')
const createFxGrenache = require('bfx-svc-test-helper/fauxgrenache')

const Fac = require('..')

const stubs = {
  'rest:util:net': {
    getIpInfo (space, ip, cb) {
      const res = [ip, { country: 'US', region: 'CA' }]
      return cb(null, res)
    }
  }
}

const grapes = createGrapes()
const caller = {
  on: () => {},
  ctx: { root: __dirname }
}

const fac = new Fac(caller, {})
fac.tick = () => {}
fac.conf = { grape: 'http://127.0.0.1:30001', transport: 'http' }

let fxg1
let fxg2
describe('RPC integration: map', () => {
  before(async function () {
    this.timeout(20000)

    grapes.onAnnounce()

    await grapes.start()
    fxg1 = createFxGrenache(stubs, grapes, { port: 1557 })
    fxg2 = createFxGrenache(stubs, grapes, { port: 1558 })
    await fxg1.start()
    await fxg2.start()

    const start = promisify(fac.start).bind(fac)
    await start()
  })

  after(async function () {
    this.timeout(5000)

    await grapes.stop()
    await fxg1.stop()
    await fxg2.stop()
    fac.stop()
  })

  describe('callback', () => {
    it('options defaults', done => {
      fac.map('rest:util:net', 'getIpInfo', ['8.8.8.8'], (_err, res) => {
        assert.deepStrictEqual([
          ['8.8.8.8', { country: 'US', region: 'CA' }],
          ['8.8.8.8', { country: 'US', region: 'CA' }]
        ], res)
        done()
      })
    })

    it('success', done => {
      fac.map('rest:util:net', 'getIpInfo', ['8.8.8.8'], {}, (_err, res) => {
        assert.deepStrictEqual([
          ['8.8.8.8', { country: 'US', region: 'CA' }],
          ['8.8.8.8', { country: 'US', region: 'CA' }]
        ], res)
        done()
      })
    })

    it('lookup error', done => {
      fac.map('foo:test:net', 'getIpInfo', [], {}, (err, res) => {
        assert.strictEqual(err.message, 'Error: ERR_GRAPE_LOOKUP_EMPTY')
        done()
      })
    })

    it('invalid args', done => {
      fac.map('rest:util:net', 'getIpInfo', {}, {}, (err, res) => {
        assert.strictEqual(err.message, 'ERR_GRC_REQ_ARGS_INVALID')
        done()
      })
    })

    it('invalid action', done => {
      fac.map('rest:util:net', {}, [], {}, (err, res) => {
        assert.strictEqual(err.message, 'ERR_GRC_REQ_ACTION_INVALID')
        done()
      })
    })
  })

  describe('promise', () => {
    it('success', async () => {
      const res = await fac.map('rest:util:net', 'getIpInfo', ['8.8.8.8'], {})
      assert.deepStrictEqual([
        ['8.8.8.8', { country: 'US', region: 'CA' }],
        ['8.8.8.8', { country: 'US', region: 'CA' }]
      ], res)
    })

    it('lookup error', async () => {
      try {
        await fac.map('foo:test:net', 'getIpInfo', [], {})
      } catch (e) {
        assert.strictEqual(e.message, 'Error: ERR_GRAPE_LOOKUP_EMPTY')
        return
      }
      throw new Error('Should have thrown')
    })

    it('invalid args', async () => {
      try {
        await fac.map('rest:util:net', 'getIpInfo', {}, {})
      } catch (e) {
        assert.strictEqual(e.message, 'ERR_GRC_REQ_ARGS_INVALID')
        return
      }
      throw new Error('Should have thrown')
    })

    it('invalid action', async () => {
      try {
        await fac.map('rest:util:net', {}, [], {})
      } catch (e) {
        assert.strictEqual(e.message, 'ERR_GRC_REQ_ACTION_INVALID')
        return
      }
      throw new Error('Should have thrown')
    })
  })
})
