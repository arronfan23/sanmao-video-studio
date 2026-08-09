const assert = require('assert');
const { compareVersions } = require('../src/main/core/updater');

assert(compareVersions('0.2.0', '0.1.0') > 0);
assert(compareVersions('0.1.0', '0.2.0') < 0);
assert.strictEqual(compareVersions('1.0.0', '1.0.0'), 0);
assert(compareVersions('1.0.1', '1.0.0') > 0);
assert(compareVersions('0.10.0', '0.9.9') > 0, '0.10 应大于 0.9.9');

console.log('updater.test.js 通过：版本比较正常');
