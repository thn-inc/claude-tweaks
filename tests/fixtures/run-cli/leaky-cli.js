'use strict';
// Fixture for tests/helpers-run-cli.test.js: performs one process-state leak, named by argv[0].

const LEAKS = {
  exitcode: () => { process.exitCode = 3; },
  chdir: () => { process.chdir(require('os').tmpdir()); },
  'env-add': () => { process.env.CT_RUN_CLI_LEAK = '1'; },
  'env-change': () => { process.env.CT_RUN_CLI_LEAK_PROBE = 'changed'; },
  listener: () => { process.on('SIGTERM', () => {}); },
  // Removes only the SIGHUP listener the test marked, so the ones around it stay in place.
  'listener-remove': () => {
    const marked = process.rawListeners('SIGHUP').find((fn) => (fn.listener || fn).ctRunCliProbe);
    process.removeListener('SIGHUP', marked);
  },
  stdout: () => { process.stdout.write('leak'); },
  stderr: () => { process.stderr.write('leak'); },
  homedir: () => { require('os').homedir(); },
};

function run([kind]) {
  if (kind === 'async-stdout') {
    return new Promise((resolve) => setTimeout(() => {
      process.stdout.write('late');
      resolve(0);
    }, 10));
  }
  LEAKS[kind]();
  return 0;
}

const realDeps = {};

module.exports = { run, realDeps };
