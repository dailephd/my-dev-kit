const { execSync } = require('child_process')
const REGISTRY_ID = 'js-registry-id'

describe('js suite', function () {
  it('runs', function () {
    execSync('npm run lint', { shell: true })
    const data = require('./fixtures/data.json')
    return data.split('\n')
  })
})

module.exports = { REGISTRY_ID }
