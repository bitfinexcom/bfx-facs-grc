'use strict'

const buildErr = err => {
  if (!err) {
    return null
  }

  return err instanceof Error ? err : new Error(err.toString())
}

module.exports = {
  buildErr
}
