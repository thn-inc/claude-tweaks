#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

// The generated wrapper's source lives in its own real, lintable/
// typecheckable .js file (bin/lib/statusline-wrapper-source.js) rather than
// as an inline template literal — the wrapper has no runtime interpolation
// (it's a fully static script copied byte-for-byte to the install target),
// so a template literal bought nothing here beyond making the nested script
// un-lintable and forcing its /^\d+\.\d+\.\d+$/ regex to be hand-double-
// escaped (\\d) to survive being embedded in an outer backtick string.
const TEMPLATE_PATH = path.join(__dirname, 'lib', 'statusline-wrapper-source.js');

function buildWrapperSource() {
  return fs.readFileSync(TEMPLATE_PATH, 'utf8');
}

// Writes the generated wrapper script under `<homedir>/.claude-tweaks/bin/statusline.js`.
// `homedir` is injectable (defaults to `os.homedir()`) so tests can point this at a
// temp directory instead of the real developer home directory.
function installWrapper(homedir = os.homedir()) {
  const targetDir = path.join(homedir, '.claude-tweaks', 'bin');
  const targetPath = path.join(targetDir, 'statusline.js');
  const wrapper = buildWrapperSource();

  fs.mkdirSync(targetDir, { recursive: true });
  // fs.writeFileSync's `mode` option is only applied by the underlying
  // open() syscall's O_CREAT path — re-running the installer over an
  // already-existing wrapper file (the documented, expected re-invocation
  // path on every plugin upgrade) silently leaves whatever permissions the
  // file already had. chmod explicitly and unconditionally afterward so a
  // wrapper that was ever written non-executable gets restored to 0o755 on
  // every re-run, not just the first.
  fs.writeFileSync(targetPath, wrapper);
  fs.chmodSync(targetPath, 0o755);

  return targetPath;
}

// argv is ignored: the installer takes no arguments.
function run(argv, deps = realDeps) {
  deps.stdout(installWrapper(deps.homeDir()));
  return 0;
}

const realDeps = {
  homeDir: () => os.homedir(),
  stdout: (text) => process.stdout.write(text),
};

module.exports = { installWrapper, buildWrapperSource, run, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
