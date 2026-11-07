'use strict'

const test = require('brittle')
const { promisify } = require('util')
const createGrapes = require('@bitfinex/bfx-svc-test-helper/grapes')
const createFxGrenache = require('@bitfinex/bfx-svc-test-helper/fauxgrenache')
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

const fac = new Fac(caller, {}, { env: 'test' })
fac.tick = () => {}
fac.conf = { grape: 'http://127.0.0.1:30001', transport: 'http' }

let fxg1
let fxg2

const testCase = (testBlock) => async (t) => {
  try {
    await before()

    await testBlock(t)
  } finally {
    await after()
  }
}

const before = async () => {
  grapes.onAnnounce()

  await grapes.start()
  fxg1 = createFxGrenache(stubs, grapes, { port: 1557 })
  fxg2 = createFxGrenache(stubs, grapes, { port: 1558 })
  await fxg1.start()
  await fxg2.start()

  const start = promisify(fac.start).bind(fac)
  await start()
}

const after = async () => {
  await grapes.stop()
  await fxg1.stop()
  await fxg2.stop()
  fac.stop()
}

test('RPC integration: map', testCase(async (t) => {
  await t.test('callback', async (t) => {
    t.test('options defaults', async (t) => {
      await new Promise(resolve => {
        fac.map('rest:util:net', 'getIpInfo', ['8.8.8.8'], (_err, res) => {
          t.alike([
            ['8.8.8.8', { country: 'US', region: 'CA' }],
            ['8.8.8.8', { country: 'US', region: 'CA' }]
          ], res)
          resolve()
        })
      })
    })

    await t.test('success', async (t) => {
      await new Promise(resolve => {
        fac.map('rest:util:net', 'getIpInfo', ['8.8.8.8'], {}, (_err, res) => {
          t.alike([
            ['8.8.8.8', { country: 'US', region: 'CA' }],
            ['8.8.8.8', { country: 'US', region: 'CA' }]
          ], res)
          resolve()
        })
      })
    })

    await t.test('lookup error', async (t) => {
      await new Promise(resolve => {
        fac.map('foo:test:net', 'getIpInfo', [], {}, (err) => {
          t.is(err.message, 'ERR_GRAPE_LOOKUP_EMPTY')
          resolve()
        })
      })
    })

    await t.test('double cb error', async (t) => {
      const originalPeer = fac.peer
      const originalConsoleError = console.error

      await new Promise((resolve, reject) => {
        let errorArgs
        console.error = (...args) => {
          if (errorArgs) {
            reject(new Error('Should have been called once'))
          }
          errorArgs = args
        }

        fac.peer = {
          map (service, args, opts, cb) {
            cb()
            cb()
            fac.peer = originalPeer
            console.error = originalConsoleError
            t.is(errorArgs[0], 'ERR_DOUBLE_CB')
            t.is(errorArgs[1], 'rest:util:net')
            t.is(errorArgs[2], 'getIpInfo')
          }
        }
        fac.map('rest:util:net', 'getIpInfo', [], {}, () => {
          t.is(errorArgs, undefined)
          resolve()
        })
      })
    })

    await t.test('invalid args', async (t) => {
      await new Promise(resolve => {
        fac.map('rest:util:net', 'getIpInfo', {}, {}, (err) => {
          t.is(err.message, 'ERR_GRC_REQ_ARGS_INVALID')
          resolve()
        })
      })
    })

    await t.test('invalid action', async (t) => {
      await new Promise(resolve => {
        fac.map('rest:util:net', {}, [], {}, (err) => {
          t.is(err.message, 'ERR_GRC_REQ_ACTION_INVALID')
          resolve()
        })
      })
    })
  })

  await t.test('promise', async (t) => {
    await t.test('success', async (t) => {
      const res = await fac.map('rest:util:net', 'getIpInfo', ['8.8.8.8'], {})
      t.alike([
        ['8.8.8.8', { country: 'US', region: 'CA' }],
        ['8.8.8.8', { country: 'US', region: 'CA' }]
      ], res)
    })

    await t.test('lookup error', async () => {
      try {
        await fac.map('foo:test:net', 'getIpInfo', [], {})
      } catch (e) {
        t.is(e.message, 'ERR_GRAPE_LOOKUP_EMPTY')
        return
      }
      throw new Error('Should have thrown')
    })

    await t.test('double cb error', async () => {
      const originalPeer = fac.peer
      const originalConsoleError = console.error

      fac.peer = {
        map (service, args, opts, cb) {
          cb()
          cb()
          t.is(errorArgs[0], 'ERR_DOUBLE_CB')
          t.is(errorArgs[1], 'rest:util:net')
          t.is(errorArgs[2], 'getIpInfo')
          fac.peer = originalPeer
          console.error = originalConsoleError
        }
      }

      let errorArgs
      console.error = (...args) => {
        if (errorArgs) {
          throw new Error('Should have been called once')
        }
        errorArgs = args
      }

      await fac.map('rest:util:net', 'getIpInfo', [], {})
    })

    await t.test('invalid args', async () => {
      try {
        await fac.map('rest:util:net', 'getIpInfo', {}, {})
      } catch (e) {
        t.is(e.message, 'ERR_GRC_REQ_ARGS_INVALID')
        return
      }
      throw new Error('Should have thrown')
    })

    await t.test('invalid action', async () => {
      try {
        await fac.map('rest:util:net', {}, [], {})
      } catch (e) {
        t.is(e.message, 'ERR_GRC_REQ_ACTION_INVALID')
        return
      }
      throw new Error('Should have thrown')
    })
  })
}))
