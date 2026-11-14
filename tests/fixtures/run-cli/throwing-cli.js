'use strict';
// Fixture for tests/helpers-run-cli.test.js: run throws (sync) or rejects (async).

function run([kind]) {
  if (kind === 'async') return Promise.reject(new Error('boom'));
  process.stdout.write('x');
  throw new Error('boom');
}

const realDeps = {};

module.exports = { run, realDeps };
