'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCliSync, spawnCli } = require('../../helpers/run-cli');
const { run } = require('../../../plugin/bin/implementer-tier');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'implementer-tier.js');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

// resolvePolicy starts `git rev-parse --show-toplevel` with this env.
const ENV = { PATH: process.env.PATH, ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }) };

const madeTmpDirs = [];
function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-tier-'));
  madeTmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (madeTmpDirs.length) fs.rmSync(madeTmpDirs.pop(), { recursive: true, force: true });
});

// materialize.js's layout: header lines, a blank-free frontmatter close, then the body.
const spec = ({ header, keyFiles = [] }) =>
  `---\nrecord: 1\n${header}---\n# 1: Title\n\n## Overview\n\ntext\n\n### Key Files\n\n${keyFiles.map((f) => `- \`${f}\``).join('\n')}\n`;

function writeSpec(text) {
  const file = path.join(tmpDir(), 'spec.md');
  fs.writeFileSync(file, text);
  return file;
}

// A scratch project: a tmp dir (not a git repo) holding .claude-tweaks/policy.yml.
function scratchProject(policyText) {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), policyText);
  return dir;
}

const call = (args, cwd = tmpDir()) => runCliSync(CLI, args, { env: ENV, cwd });

function ok(args, cwd) {
  const res = call(args, cwd);
  assert.strictEqual(res.code, 0, res.stderr);
  return JSON.parse(res.stdout);
}

function refused(args, code, substring, cwd) {
  const res = call(args, cwd);
  assert.strictEqual(res.code, code, res.stderr);
  assert.strictEqual(res.stdout, '');
  assert.ok(res.stderr.includes(substring), `stderr ${JSON.stringify(res.stderr)} lacks ${JSON.stringify(substring)}`);
}

const LOW_TWO = () => writeSpec(spec({ header: 'size: low\n', keyFiles: ['a.js', 'b.js'] }));

test('AC6.1: size low + two Key Files under record steps down to fast', () => {
  const out = ok(['--spec-file', LOW_TWO(), '--rule', 'record']);
  assert.strictEqual(out.profile, 'fast');
  assert.strictEqual(out.stepUp, 'standard');
});

test('AC6.2: the same fixture under lane is fast', () => {
  assert.strictEqual(ok(['--spec-file', LOW_TWO(), '--rule', 'lane']).profile, 'fast');
});

test('AC6.3: size high under lane is capable with no step-up', () => {
  const file = writeSpec(spec({ header: 'size: high\n', keyFiles: ['a.js', 'b.js'] }));
  const out = ok(['--spec-file', file, '--rule', 'lane']);
  assert.strictEqual(out.profile, 'capable');
  assert.strictEqual(out.stepUp, null);
});

test('AC7.1: a missing spec file exits 1 and names the path', () => {
  const missing = path.join(tmpDir(), 'missing.md');
  refused(['--spec-file', missing, '--rule', 'lane'], 1, missing);
});

test('AC7.2: an invalid size exits 1 naming the value', () => {
  const file = writeSpec(spec({ header: 'size: huge\n' }));
  refused(['--spec-file', file, '--rule', 'lane'], 1, 'huge');
});

test('AC7.2: an invalid policy.yml implementer-tier exits 1 naming the value', () => {
  const project = scratchProject('implementer-tier: sometimes\n');
  refused(['--spec-file', LOW_TWO()], 1, 'sometimes', project);
});

test('AC8.1: in this repository the unset-flag rule is record', () => {
  assert.strictEqual(ok(['--spec-file', LOW_TWO()], REPO_ROOT).rule, 'record');
});

test('AC8.2: a project with the key unset resolves lane', () => {
  assert.strictEqual(ok(['--spec-file', LOW_TWO()], scratchProject('')).rule, 'lane');
});

test('AC8.3: a run config.yml beats the project policy', () => {
  const project = scratchProject('implementer-tier: record\n');
  const runDir = tmpDir();
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'implementer-tier: lane\n');
  assert.strictEqual(ok(['--spec-file', LOW_TWO(), '--run', runDir], project).rule, 'lane');
});

test('AC11.1: the pre-rename effort line stands in for size', () => {
  const file = writeSpec(spec({ header: 'effort: low\n', keyFiles: ['a.js'] }));
  const out = ok(['--spec-file', file, '--rule', 'lane']);
  assert.strictEqual(out.size, 'low');
  assert.strictEqual(out.profile, 'fast');
});

test('AC11.2: --from replaces the step-up base', () => {
  const file = writeSpec(spec({ header: 'effort: low\n', keyFiles: ['a.js'] }));
  assert.strictEqual(ok(['--spec-file', file, '--rule', 'lane', '--from', 'capable']).stepUp, null);
  const fast = ok(['--spec-file', file, '--rule', 'lane', '--from', 'fast']);
  assert.strictEqual(fast.stepUp, 'standard');
  assert.strictEqual(fast.profile, 'fast');
});

test('no size and no effort: lane gives nulls, record gives standard', () => {
  const file = writeSpec(spec({ header: '', keyFiles: ['a.js'] }));
  assert.deepStrictEqual(ok(['--spec-file', file, '--rule', 'lane']), { profile: null, stepUp: null, rule: 'lane', size: null, keyFileCount: 1 });
  assert.strictEqual(ok(['--spec-file', file, '--rule', 'record']).profile, 'standard');
});

test('two size lines exit 1 naming size', () => {
  const file = writeSpec(spec({ header: 'size: low\nsize: high\n' }));
  refused(['--spec-file', file, '--rule', 'lane'], 1, 'given more than once');
});

test('a blank line ends the header: a size line after it is not read', () => {
  const file = writeSpec('---\nrecord: 1\n\nsize: high\n---\n# 1: Title\n');
  assert.strictEqual(ok(['--spec-file', file, '--rule', 'lane']).size, null);
});

test('a CRLF header reads its size and still ends at the CRLF blank line', () => {
  const file = writeSpec('---\r\nrecord: 1\r\nsize: low\r\n\r\nsize: high\r\n# 1: Title\r\n');
  assert.strictEqual(ok(['--spec-file', file, '--rule', 'lane']).size, 'low');
});

test('trailing spaces on the size value are trimmed', () => {
  const file = writeSpec(spec({ header: 'size: low  \n', keyFiles: ['a.js'] }));
  assert.strictEqual(ok(['--spec-file', file, '--rule', 'lane']).size, 'low');
});

test('a size line below the header is not read', () => {
  const file = writeSpec(`${spec({ header: 'size: low\n', keyFiles: ['a.js'] })}\nsize: high\n`);
  assert.strictEqual(ok(['--spec-file', file, '--rule', 'lane']).size, 'low');
});

test('a relative --spec-file resolves against the injected cwd', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'spec.md'), spec({ header: 'size: low\n', keyFiles: ['a.js'] }));
  assert.strictEqual(ok(['--spec-file', 'spec.md', '--rule', 'lane'], dir).size, 'low');
});

test('a missing relative spec file is named as typed', () => {
  refused(['--spec-file', 'nope.md', '--rule', 'lane'], 1, 'nope.md', tmpDir());
});

test('a --run that does not exist exits 2 with no --rule', () => {
  const missing = path.join(tmpDir(), 'no-such-run');
  refused(['--spec-file', LOW_TWO(), '--run', missing], 2, 'does not exist');
});

test('AC12.1: --run is validated even when --rule skips the policy value', () => {
  const missing = path.join(tmpDir(), 'no-such-run');
  refused(['--spec-file', LOW_TWO(), '--rule', 'lane', '--run', missing], 2, missing);
});

test('AC12.2: a repeated flag exits 2 naming it', () => {
  const file = LOW_TWO();
  refused(['--spec-file', file, '--rule', 'lane', '--rule', 'record'], 2, '--rule given more than once');
  refused(['--spec-file', file, '--spec-file', file, '--rule', 'lane'], 2, '--spec-file given more than once');
  refused(['--spec-file', file, '--rule', 'lane', '--run', tmpDir(), '--run', tmpDir()], 2, '--run given more than once');
  refused(['--spec-file', file, '--rule', 'lane', '--from', 'fast', '--from', 'fast'], 2, '--from given more than once');
});

test('an invalid implementer-tier value in the run config.yml exits 1 naming the value', () => {
  const project = scratchProject('');
  const runDir = tmpDir();
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'implementer-tier: bogus\n');
  refused(['--spec-file', LOW_TWO(), '--run', runDir], 1, 'bogus', project);
});

test('a relative --run resolves against the injected cwd', () => {
  const dir = scratchProject('implementer-tier: record\n');
  fs.mkdirSync(path.join(dir, 'run2'));
  fs.writeFileSync(path.join(dir, 'run2', 'config.yml'), 'implementer-tier: lane\n');
  const out = ok(['--spec-file', LOW_TWO(), '--run', 'run2'], dir);
  assert.strictEqual(out.rule, 'lane');
  refused(['--spec-file', LOW_TWO(), '--run', 'no-such-run'], 2, 'does not exist', dir);
});

test('a valid --run passes and --rule still wins', () => {
  const runDir = tmpDir();
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'implementer-tier: record\n');
  assert.strictEqual(ok(['--spec-file', LOW_TWO(), '--rule', 'lane', '--run', runDir]).rule, 'lane');
});

test('--rule passed: an invalid policy.yml value does not fail the call', () => {
  const project = scratchProject('implementer-tier: sometimes\n');
  const runDir = tmpDir();
  assert.strictEqual(ok(['--spec-file', LOW_TWO(), '--rule', 'record', '--run', runDir], project).rule, 'record');
});

test('invocation errors exit 2 with no stdout', () => {
  const file = LOW_TWO();
  refused(['--rule', 'lane'], 2, '--spec-file');
  refused(['--spec-file', file, '--rule', 'sometimes'], 2, 'sometimes');
  refused(['--spec-file', file, '--rule', 'lane', '--from', 'huge'], 2, 'huge');
  refused(['--spec-file', file, '--bogus'], 2, '--bogus');
  refused(['--spec-file', file, '--rule'], 2, '--rule requires a value');
  refused(['--spec-file', file, '--rule', '--run'], 2, '--rule requires a value');
  refused(['--spec-file', file, '--rule', '  '], 2, '--rule requires a value');
  refused(['--spec-file', '  ', '--rule', 'lane'], 2, '--spec-file requires a value');
  refused(['--spec-file', '--rule', 'lane'], 2, '--spec-file requires a value');
  refused(['--spec-file', file, '--rule', 'lane', '--run', '  '], 2, '--run requires a value');
  refused(['--spec-file', file, '--rule', 'lane', '--from', '--run'], 2, '--from requires a value');
});

test('a glob Key Files entry counts like a directory', () => {
  const file = writeSpec(spec({ header: 'size: low\n', keyFiles: ['src/*.js'] }));
  const out = ok(['--spec-file', file, '--rule', 'record']);
  assert.strictEqual(out.keyFileCount, 3);
  assert.strictEqual(out.profile, 'standard');
});

test('script entry: exact stdout bytes, exit 0, empty stderr', () => {
  const res = spawnCli(CLI, ['--spec-file', LOW_TWO(), '--rule', 'lane'], { env: ENV, cwd: tmpDir() });
  assert.strictEqual(res.code, 0);
  assert.strictEqual(res.stderr, '');
  assert.strictEqual(res.stdout, '{"profile":"fast","stepUp":"standard","rule":"lane","size":"low","keyFileCount":2}\n');
});

test('run() calls no fs mutation API, for success, refusal and --run calls', () => {
  const { run, realDeps } = require(CLI);
  const MUTATORS = ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rm', 'rmdir', 'unlink', 'rename', 'copyFile', 'cp', 'symlink', 'link', 'truncate', 'open', 'createWriteStream'];
  const project = scratchProject('implementer-tier: record\n');
  const runDir = tmpDir();
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'implementer-tier: lane\n');
  const file = LOW_TWO();
  const calls = [];
  const restores = [];
  const trap = (obj, name, label) => {
    if (typeof obj[name] !== 'function') return;
    const original = obj[name];
    obj[name] = () => { calls.push(label); throw new Error(`fs mutation ${label} during run()`); };
    restores.push(() => { obj[name] = original; });
  };
  for (const name of MUTATORS) {
    trap(fs, name, `fs.${name}`);
    trap(fs, `${name}Sync`, `fs.${name}Sync`);
    trap(fs.promises, name, `fs.promises.${name}`);
  }
  const codes = [];
  try {
    const deps = { ...realDeps, stdout: () => {}, stderr: () => {}, cwd: () => project, env: ENV };
    codes.push(run(['--spec-file', file, '--rule', 'lane'], deps));
    codes.push(run(['--spec-file', file], deps));
    codes.push(run(['--spec-file', file, '--run', runDir], deps));
    codes.push(run(['--spec-file', path.join(project, 'missing.md')], deps));
    codes.push(run(['--bogus'], deps));
  } finally {
    for (const restore of restores) restore();
  }
  assert.deepStrictEqual(calls, []);
  assert.deepStrictEqual(codes, [0, 0, 0, 1, 2]);
});

test('size: wins over effort: when the header carries both', () => {
  const file = writeSpec(spec({ header: 'size: high\neffort: low\n', keyFiles: ['a.js'] }));
  const out = ok(['--spec-file', file, '--rule', 'lane']);
  assert.strictEqual(out.size, 'high');
  assert.strictEqual(out.profile, 'capable');
});

test('an invalid effort: value with no size: line exits 1 naming the value', () => {
  const file = writeSpec(spec({ header: 'effort: huge\n' }));
  refused(['--spec-file', file, '--rule', 'lane'], 1, 'huge');
});

test('an absolute readable --spec-file never reads cwd(), so a deleted working directory does not fail it', () => {
  const file = LOW_TWO();
  const out = [];
  const err = [];
  const deps = {
    cwd: () => {
      throw new Error('ENOENT: no such file or directory, uv_cwd');
    },
    stdout: (m) => out.push(m),
    stderr: (m) => err.push(m),
  };
  assert.strictEqual(run(['--spec-file', file, '--rule', 'lane'], deps), 0, err.join(''));
  assert.strictEqual(JSON.parse(out.join('')).profile, 'fast');
});
