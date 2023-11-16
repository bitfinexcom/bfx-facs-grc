'use strict'

const _ = require('lodash')

const getErr = err => _.isString(err) ? new Error(err) : err

const buildErr = err => err ? new Error(err.message || err) : null

module.exports = {
  buildErr,
  getErr
}
