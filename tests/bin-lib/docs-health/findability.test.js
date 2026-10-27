'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { computeInboundReferences } = require('../../../plugin/bin/lib/docs-health/findability');

function makeTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'docs-health-findability-'));
}

test('counts zero references for an orphan doc', () => {
  const root = makeTmpRoot();
  fs.mkdirSync(path.join(root, 'docs', 'guides'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'guides', 'orphan.md'), '# Orphan\n\nNo one links here.\n');
  const result = computeInboundReferences('guides/orphan', root);
  assert.strictEqual(result.count, 0);
  assert.deepStrictEqual(result.referencedBy, []);
});

test('counts a reference from another doc', () => {
  const root = makeTmpRoot();
  fs.mkdirSync(path.join(root, 'docs', 'guides'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'guides', 'target.md'), '# Target\n');
  fs.writeFileSync(path.join(root, 'docs', 'guides', 'index.md'), '# Guides\n\nSee [target](target.md).\n');
  const result = computeInboundReferences('guides/target', root);
  assert.strictEqual(result.count, 1);
  assert.deepStrictEqual(result.referencedBy, ['docs/guides/index.md']);
});

test('counts a reference from README.md', () => {
  const root = makeTmpRoot();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'setup.md'), '# Setup\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'See [setup](docs/setup.md) for details.\n');
  const result = computeInboundReferences('setup', root);
  assert.strictEqual(result.count, 1);
  assert.deepStrictEqual(result.referencedBy, ['README.md']);
});

test('counts a reference from CLAUDE.md', () => {
  const root = makeTmpRoot();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'conventions.md'), '# Conventions\n');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'See docs/conventions.md for details.\n');
  const result = computeInboundReferences('conventions', root);
  assert.strictEqual(result.count, 1);
  assert.deepStrictEqual(result.referencedBy, ['CLAUDE.md']);
});

test('excludes the doc itself from its own reference count', () => {
  const root = makeTmpRoot();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'self.md'), '# Self\n\nself.md is this file.\n');
  const result = computeInboundReferences('self', root);
  assert.strictEqual(result.count, 0);
});

test('counts references from multiple files', () => {
  const root = makeTmpRoot();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'target.md'), '# Target\n');
  fs.writeFileSync(path.join(root, 'docs', 'a.md'), 'Link to [target](target.md).\n');
  fs.writeFileSync(path.join(root, 'docs', 'b.md'), 'Also see [target](target.md).\n');
  const result = computeInboundReferences('target', root);
  assert.strictEqual(result.count, 2);
});

test('returns zero when docs/ does not exist yet', () => {
  const root = makeTmpRoot();
  fs.writeFileSync(path.join(root, 'README.md'), 'Nothing here yet.\n');
  const result = computeInboundReferences('missing-doc', root);
  assert.strictEqual(result.count, 0);
});

test('does NOT count a doc as referenced when only a same-named doc in a DIFFERENT directory is linked', () => {
  // docs/api/config.md and docs/db/config.md share a filename. README.md
  // links only to docs/db/config.md ("see db/config.md") — a bare-basename
  // substring check would wrongly count docs/api/config.md as referenced
  // too, since 'db/config.md'.includes('config.md') is true.
  const root = makeTmpRoot();
  fs.mkdirSync(path.join(root, 'docs', 'api'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'db'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'api', 'config.md'), '# API Config\n');
  fs.writeFileSync(path.join(root, 'docs', 'db', 'config.md'), '# DB Config\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'See db/config.md for database settings.\n');

  const apiResult = computeInboundReferences('api/config', root);
  assert.strictEqual(apiResult.count, 0, 'docs/api/config.md is never linked and must be reported as orphaned');
  assert.deepStrictEqual(apiResult.referencedBy, []);

  const dbResult = computeInboundReferences('db/config', root);
  assert.strictEqual(dbResult.count, 1, 'docs/db/config.md IS linked from README.md and must be counted');
  assert.deepStrictEqual(dbResult.referencedBy, ['README.md']);
});

test('counts a reference via a nested relative link ("../config.md") from a sibling subdirectory', () => {
  const root = makeTmpRoot();
  fs.mkdirSync(path.join(root, 'docs', 'api'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'api', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'api', 'config.md'), '# API Config\n');
  fs.writeFileSync(path.join(root, 'docs', 'api', 'sub', 'other.md'), 'See [config](../config.md).\n');
  const result = computeInboundReferences('api/config', root);
  assert.strictEqual(result.count, 1);
  assert.deepStrictEqual(result.referencedBy, ['docs/api/sub/other.md']);
});

test('does NOT count a top-level doc as referenced when only a same-named doc in a NESTED subdirectory is linked', () => {
  // docs/config.md (top-level, docId 'config') and docs/sub/config.md (docId
  // 'sub/config') share a basename. README.md links only to
  // docs/sub/config.md. A bare-basename qualifiedPath for the top-level
  // docId ('config.md', since docId has no subdirectory of its own) must not
  // substring-match inside "docs/sub/config.md" -- that's the same failure
  // shape as the cross-directory collision above, but for the no-subdirectory
  // docId case, which degenerates qualifiedPath back to a bare basename.
  const root = makeTmpRoot();
  fs.mkdirSync(path.join(root, 'docs', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'config.md'), '# Top-level Config\n');
  fs.writeFileSync(path.join(root, 'docs', 'sub', 'config.md'), '# Sub Config\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'See docs/sub/config.md for details.\n');

  const topResult = computeInboundReferences('config', root);
  assert.strictEqual(topResult.count, 0, 'docs/config.md is never linked and must be reported as orphaned');
  assert.deepStrictEqual(topResult.referencedBy, []);

  const subResult = computeInboundReferences('sub/config', root);
  assert.strictEqual(subResult.count, 1, 'docs/sub/config.md IS linked from README.md and must be counted');
  assert.deepStrictEqual(subResult.referencedBy, ['README.md']);
});

test('AC1.1: referencedBy entries are / display IDs under path.win32 (#3315)', () => {
  const root = makeTmpRoot();
  fs.mkdirSync(path.join(root, 'docs', 'api'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'guide'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'api', 'config.md'), '# API Config\n');
  fs.writeFileSync(path.join(root, 'docs', 'guide', 'howto.md'), 'See [config](../api/config.md).\n');
  // Counting wrapper: native and plain path.win32 `relative` both yield `/` for
  // these fixtures on a POSIX host, so only a recorded call proves the call site
  // routes the display ID through the injected pathImpl.
  const calls = [];
  const pathImpl = { ...path.win32, relative: (a, b) => (calls.push([a, b]), path.win32.relative(a, b)) };
  const r = computeInboundReferences('api/config', root, { pathImpl });
  assert.deepStrictEqual(r.referencedBy, ['docs/guide/howto.md']);
  assert.strictEqual(r.count, 1);
  assert.ok(calls.length > 0, 'pathImpl.relative must be used for the display ID');
});
