'use strict'

const buildErr = err => err ? new Error(err.message || err) : null

module.exports = {
  buildErr
}
