'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../../plugin/bin/stage-item');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicli-'));
  const main = path.join(root, 'main');
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-08-20T090000-spec-12');
  const shadow = path.join(main, '.claude', 'worktrees', 'flow-spec-12', '.claude-tweaks', 'pipelines', '2026-08-20T090000-spec-12');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(shadow, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  fs.writeFileSync(path.join(main, '.claude', 'worktrees', 'flow-spec-12', '.git'), 'gitdir: ../../../.git/worktrees/flow-spec-12\n');
  const sourceFile = path.join(root, 'proposal.patch');
  fs.writeFileSync(sourceFile, 'diff --git a b\n+x\n');
  return { main, runDir, shadow, sourceFile };
}

function fakeDeps(cwd) {
  const out = []; const err = [];
  return {
    deps: {
      cwd: () => cwd,
      readFile: (p) => fs.readFileSync(p),
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    },
    out, err,
  };
}

test('cli: success path writes staged/<id><ext> and prints the file path', () => {
  const { main, runDir, sourceFile } = fixture();
  const { deps, out } = fakeDeps(main);
  const code = run(['--run', runDir, '--id', 'review-2', '--file', sourceFile], deps);
  assert.equal(code, 0);
  const written = path.join(runDir, 'staged', 'review-2.patch');
  assert.equal(fs.readFileSync(written, 'utf8'), 'diff --git a b\n+x\n');
  assert.ok(out.join('').includes(written));
});

test('cli: missing --run, --id, or --file is a malformed invocation (exit 2)', () => {
  const { main, runDir, sourceFile } = fixture();
  const { deps: d1 } = fakeDeps(main);
  assert.equal(run(['--id', 'review-2', '--file', sourceFile], d1), 2);
  const { deps: d2 } = fakeDeps(main);
  assert.equal(run(['--run', runDir, '--file', sourceFile], d2), 2);
  const { deps: d3 } = fakeDeps(main);
  assert.equal(run(['--run', runDir, '--id', 'review-2'], d3), 2);
});

test('cli: unsafe --id (path traversal) is rejected (exit 2), nothing written', () => {
  const { main, runDir, sourceFile } = fixture();
  const { deps } = fakeDeps(main);
  const code = run(['--run', runDir, '--id', '../../etc/passwd', '--file', sourceFile], deps);
  assert.equal(code, 2);
  // Where the id would have landed had it reached writeStagedItem:
  // path.join(runDir, 'staged', '../../etc/passwd' + '.patch').
  assert.equal(fs.existsSync(path.join(runDir, '..', 'etc', 'passwd.patch')), false);
  assert.equal(fs.existsSync(path.join(runDir, 'staged')), false);
});

test('cli: a source file that does not exist is a malformed invocation (exit 2)', () => {
  const { main, runDir } = fixture();
  const { deps } = fakeDeps(main);
  const code = run(['--run', runDir, '--id', 'review-2', '--file', '/no/such/file.patch'], deps);
  assert.equal(code, 2);
});

test('cli: --run resolving to a worktree-local shadow is refused (exit 3), nothing written', () => {
  const { shadow, sourceFile } = fixture();
  const { deps } = fakeDeps(path.dirname(shadow));
  const code = run(['--run', shadow, '--id', 'review-2', '--file', sourceFile], deps);
  assert.equal(code, 3);
  assert.equal(fs.existsSync(path.join(shadow, 'staged')), false);
});

test('cli: --json writes staged/<id>.json alongside staged/<id><ext> and prints both paths', () => {
  const { main, runDir, sourceFile } = fixture();
  const jsonFile = path.join(main, 'sidecar.json');
  fs.writeFileSync(jsonFile, JSON.stringify([{ tag: 'claim', record: 1, title: 't', action: 'a', command: 'c' }]));
  const { deps, out } = fakeDeps(main);
  const code = run(['--run', runDir, '--id', 'review-2', '--file', sourceFile, '--json', jsonFile], deps);
  assert.equal(code, 0);
  const written = path.join(runDir, 'staged', 'review-2.patch');
  const writtenJson = path.join(runDir, 'staged', 'review-2.json');
  assert.equal(fs.readFileSync(written, 'utf8'), 'diff --git a b\n+x\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(writtenJson, 'utf8')), [{ tag: 'claim', record: 1, title: 't', action: 'a', command: 'c' }]);
  const printed = out.join('');
  assert.ok(printed.includes(written));
  assert.ok(printed.includes(writtenJson));
});

test('cli: --json content that is not a JSON array is a malformed invocation (exit 2), nothing written', () => {
  const { main, runDir, sourceFile } = fixture();
  const jsonFile = path.join(main, 'sidecar.json');
  fs.writeFileSync(jsonFile, JSON.stringify({ tag: 'claim' }));
  const { deps } = fakeDeps(main);
  const code = run(['--run', runDir, '--id', 'review-2', '--file', sourceFile, '--json', jsonFile], deps);
  assert.equal(code, 2);
  assert.equal(fs.existsSync(path.join(runDir, 'staged')), false);
});

test('cli: --json content that is not valid JSON is a malformed invocation (exit 2)', () => {
  const { main, runDir, sourceFile } = fixture();
  const jsonFile = path.join(main, 'sidecar.json');
  fs.writeFileSync(jsonFile, 'not json');
  const { deps } = fakeDeps(main);
  const code = run(['--run', runDir, '--id', 'review-2', '--file', sourceFile, '--json', jsonFile], deps);
  assert.equal(code, 2);
  assert.equal(fs.existsSync(path.join(runDir, 'staged')), false);
});

test('cli: --allocate on a numbered-kind --id collision reallocates and reports the adjusted name on stdout (#2770)', () => {
  const { main, runDir, sourceFile } = fixture();
  const { deps: d1 } = fakeDeps(main);
  const firstCode = run(['--run', runDir, '--id', 'build-deviation-1', '--file', sourceFile, '--allocate'], d1);
  assert.equal(firstCode, 0);

  const secondSource = path.join(main, 'proposal-2.patch');
  fs.writeFileSync(secondSource, 'diff --git a b\n+y\n');
  const { deps: d2, out } = fakeDeps(main);
  const secondCode = run(['--run', runDir, '--id', 'build-deviation-1', '--file', secondSource, '--allocate'], d2);
  assert.equal(secondCode, 0);

  const firstFile = path.join(runDir, 'staged', 'build-deviation-1.patch');
  const secondFile = path.join(runDir, 'staged', 'build-deviation-2.patch');
  assert.equal(fs.readFileSync(firstFile, 'utf8'), 'diff --git a b\n+x\n');
  assert.equal(fs.readFileSync(secondFile, 'utf8'), 'diff --git a b\n+y\n');
  const printed = out.join('');
  assert.ok(printed.includes(secondFile), 'prints the actually-written (adjusted) path');
  assert.match(printed, /--id build-deviation-1 already exists in staged\/ — wrote build-deviation-2 instead/);
});

test('cli: without --allocate, a numbered-kind --id collision keeps overwriting in place — no reallocation note', () => {
  const { main, runDir, sourceFile } = fixture();
  const { deps: d1 } = fakeDeps(main);
  run(['--run', runDir, '--id', 'build-deviation-1', '--file', sourceFile], d1);

  const secondSource = path.join(main, 'proposal-2.patch');
  fs.writeFileSync(secondSource, 'diff --git a b\n+y\n');
  const { deps: d2, out } = fakeDeps(main);
  const code = run(['--run', runDir, '--id', 'build-deviation-1', '--file', secondSource], d2);
  assert.equal(code, 0);

  const file = path.join(runDir, 'staged', 'build-deviation-1.patch');
  assert.equal(fs.readFileSync(file, 'utf8'), 'diff --git a b\n+y\n');
  assert.ok(!out.join('').includes('already exists'));
});

test('cli: a bare/slug --id collision keeps overwriting in place — no reallocation note', () => {
  const { main, runDir, sourceFile } = fixture();
  const { deps: d1 } = fakeDeps(main);
  run(['--run', runDir, '--id', 'leftover-my-slug', '--file', sourceFile], d1);

  const secondSource = path.join(main, 'proposal-2.patch');
  fs.writeFileSync(secondSource, 'diff --git a b\n+y\n');
  const { deps: d2, out } = fakeDeps(main);
  const code = run(['--run', runDir, '--id', 'leftover-my-slug', '--file', secondSource], d2);
  assert.equal(code, 0);

  const file = path.join(runDir, 'staged', 'leftover-my-slug.patch');
  assert.equal(fs.readFileSync(file, 'utf8'), 'diff --git a b\n+y\n');
  assert.ok(!out.join('').includes('already exists'));
});

test('cli: --allocate with a bare/slug --id is a malformed invocation (exit 2), nothing written', () => {
  const { main, runDir, sourceFile } = fixture();
  const { deps } = fakeDeps(main);
  const code = run(['--run', runDir, '--id', 'leftover-my-slug', '--file', sourceFile, '--allocate'], deps);
  assert.equal(code, 2);
  assert.equal(fs.existsSync(path.join(runDir, 'staged')), false);
});

test('cli: --help prints usage and exits 0 without touching the filesystem', () => {
  const { main } = fixture();
  const { deps, out } = fakeDeps(main);
  const code = run(['--help'], deps);
  assert.equal(code, 0);
  assert.match(out.join(''), /usage: stage-item\.js/);
});
