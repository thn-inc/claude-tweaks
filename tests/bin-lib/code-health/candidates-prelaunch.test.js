'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codehealth-prelaunch-'));
}

function tmpGitRepo() {
  const root = tmp();
  execFileSync('git', ['-C', root, 'init', '-q']);
  return root;
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const {
  scanPrelaunch,
  candidatesPrelaunch,
  CHECKLIST_ITEMS,
  IMAGE_SIZE_LIMIT_BYTES,
  listPageFiles,
} = require('../../../plugin/bin/lib/code-health/candidates-prelaunch');

// ── AC: a sample site reports a status for every checklist item ────────────

test('AC: a sample site reports a status for every checklist item, with every automated gap flagged', () => {
  const root = tmpGitRepo();

  write(root, 'public/index.html', `
<html><head><title>Home</title><meta name="description" content="home page"></head>
<body><img src="x.png"></body></html>
`);
  write(root, 'public/about.html', `
<html><head></head><body><p>about</p></body></html>
`);
  write(root, 'public/logo.png', Buffer.alloc(600 * 1024));

  const result = scanPrelaunch(root);

  assert.strictEqual(result.checklist.length, 17);
  assert.deepStrictEqual(result.checklist.map((r) => r.id), CHECKLIST_ITEMS.map((i) => i.id));
  for (const row of result.checklist) {
    assert.ok(['pass', 'fail', 'manual'].includes(row.status), `unexpected status for ${row.id}: ${row.status}`);
  }

  const statusById = Object.fromEntries(result.checklist.map((r) => [r.id, r.status]));
  for (const id of ['sitemap', 'robots', 'favicon', 'custom-404', 'og-image', 'meta-title', 'meta-description', 'alt-text', 'image-size']) {
    assert.strictEqual(statusById[id], 'fail', `expected ${id} to be fail`);
  }

  const manualIds = CHECKLIST_ITEMS.filter((i) => i.group === 'manual').map((i) => i.id);
  assert.strictEqual(manualIds.length, 8);
  for (const id of manualIds) {
    assert.strictEqual(statusById[id], 'manual', `expected ${id} to be manual`);
  }
});

// ── A complete site passes every automated item ─────────────────────────────

test('a complete site passes every automated item with zero candidates', () => {
  const root = tmpGitRepo();

  write(root, 'public/index.html', `
<html><head>
<title>Home</title>
<meta name="description" content="home page">
<meta property="og:image" content="/og.png">
<link rel="icon" href="/favicon.ico">
</head>
<body><img src="a.png" alt="x"></body></html>
`);
  write(root, 'public/404.html', `
<html><head><title>Not found</title><meta name="description" content="not found"></head>
<body>gone</body></html>
`);
  write(root, 'public/robots.txt', 'User-agent: *\nAllow: /\n');
  write(root, 'public/sitemap.xml', '<?xml version="1.0"?><urlset></urlset>');

  const result = scanPrelaunch(root);

  const statusById = Object.fromEntries(result.checklist.map((r) => [r.id, r.status]));
  const automatedIds = CHECKLIST_ITEMS.filter((i) => i.group === 'automated').map((i) => i.id);
  for (const id of automatedIds) {
    assert.strictEqual(statusById[id], 'pass', `expected ${id} to be pass`);
  }
  assert.deepStrictEqual(result.candidates, []);
});

// ── A repo with no web pages is not applicable ──────────────────────────────

test('a repo with no web pages is not applicable', () => {
  const root = tmpGitRepo();
  write(root, 'lib/util.js', 'module.exports = {};\n');

  const result = scanPrelaunch(root);

  assert.strictEqual(result.notApplicable, true);
  assert.strictEqual(result.notApplicableReason, 'no web pages detected');
  assert.deepStrictEqual(result.candidates, []);
  for (const row of result.checklist) {
    assert.strictEqual(row.status, 'n/a', `expected ${row.id} to be n/a`);
  }
});

test('a repo whose only HTML is test fixtures and a standalone template is not applicable', () => {
  const root = tmpGitRepo();
  write(root, 'tests/fixtures/impeccable-cli/clean.html', '<html><body><img src=x></body></html>');
  write(root, 'test/__fixtures__/page.html', '<html></html>');
  write(root, 'plugin/skills/compare-shell/template.html', '<html><body></body></html>');
  write(root, 'lib/util.js', 'module.exports = {};\n');

  const result = scanPrelaunch(root);

  assert.strictEqual(result.notApplicable, true);
  assert.deepStrictEqual(result.candidates, []);
  assert.deepStrictEqual(listPageFiles([
    'tests/fixtures/impeccable-cli/clean.html',
    'plugin/skills/compare-shell/template.html',
  ]), []);
});

test('a real site does not flag images or pages that live under test or fixture directories', () => {
  const root = tmpGitRepo();
  write(root, 'public/index.html', '<html><head><title>Home</title><meta name="description" content="d"></head><body></body></html>');
  write(root, 'public/about.html', '<html><head><title>About</title><meta name="description" content="d"></head><body></body></html>');
  write(root, 'tests/fixtures/big.png', Buffer.alloc(600 * 1024));
  write(root, 'tests/fixtures/untitled.html', '<html><body><img src=x></body></html>');

  const result = scanPrelaunch(root);

  assert.strictEqual(result.notApplicable, false);
  assert.deepStrictEqual(listPageFiles(['public/index.html', 'public/about.html', 'tests/fixtures/untitled.html']), ['public/index.html', 'public/about.html']);
  const offending = result.candidates.filter((c) => c.file.startsWith('tests/'));
  assert.deepStrictEqual(offending, []);
});

test('a site-level file that exists only under a fixture directory does not satisfy the site', () => {
  const root = tmpGitRepo();
  write(root, 'public/index.html', '<html><head><title>Home</title></head><body></body></html>');
  write(root, 'tests/fixtures/robots.txt', 'User-agent: *\n');

  const result = scanPrelaunch(root);

  const robots = result.checklist.find((r) => r.id === 'robots');
  assert.strictEqual(robots.status, 'fail');
  const desc = result.candidates.find((c) => c.kind === 'missing-meta-description');
  assert.match(desc.evidence, /no description signal/);
  assert.ok(!result.candidates.some((c) => c.kind === 'missing-meta-title'));
});

// ── An App Router page inherits title and description from an ancestor layout

test('an App Router page inherits title and description from an ancestor layout', () => {
  const root = tmpGitRepo();
  write(root, 'app/layout.tsx', `
export const metadata = { title: 'X', description: 'Y' };
export default function RootLayout({ children }) { return children; }
`);
  write(root, 'app/blog/page.tsx', `
export default function BlogPage() { return null; }
`);

  const result = scanPrelaunch(root);

  const kinds = result.candidates.map((c) => `${c.kind}:${c.file}`);
  assert.ok(!kinds.includes('missing-meta-title:app/blog/page.tsx'), 'expected no missing-meta-title for app/blog/page.tsx');
  assert.ok(!kinds.includes('missing-meta-description:app/blog/page.tsx'), 'expected no missing-meta-description for app/blog/page.tsx');
});

// ── A JSX alt expression counts as alt ──────────────────────────────────────

test('a JSX alt expression (not a string literal) counts as having alt', () => {
  const root = tmpGitRepo();
  write(root, 'app/page.tsx', `
export default function Page({ s, caption }) {
  return <Image src={s} alt={caption} />;
}
`);

  const result = scanPrelaunch(root);

  assert.ok(!result.candidates.some((c) => c.kind === 'img-missing-alt'), 'expected no img-missing-alt candidate');
});

// ── Image size threshold ────────────────────────────────────────────────────

test('an image under the size limit is not flagged; one over the limit is', () => {
  const root = tmpGitRepo();
  write(root, 'public/index.html', '<html><head><title>Home</title><meta name="description" content="d"></head><body></body></html>');
  write(root, 'public/small.png', Buffer.alloc(100 * 1024));
  write(root, 'public/big.png', Buffer.alloc(600 * 1024));

  const result = scanPrelaunch(root);

  const oversized = result.candidates.filter((c) => c.kind === 'oversized-image');
  assert.strictEqual(oversized.length, 1);
  assert.strictEqual(oversized[0].file, 'public/big.png');
  assert.ok(600 * 1024 > IMAGE_SIZE_LIMIT_BYTES);
  assert.ok(100 * 1024 < IMAGE_SIZE_LIMIT_BYTES);
});

// ── Registry ─────────────────────────────────────────────────────────────────

test('registry: prelaunch is registered in FOCUS_GENERATORS and is scanPrelaunch itself', () => {
  const { FOCUS_GENERATORS } = require('../../../plugin/bin/lib/code-health/focus-generators');
  assert.strictEqual(FOCUS_GENERATORS['prelaunch'], scanPrelaunch);
});

// ── listTrackedFiles / listTrackedSourceFiles refactor ──────────────────────

test('listTrackedFiles returns non-source files too; listTrackedSourceFiles still excludes them', () => {
  const { listTrackedFiles, listTrackedSourceFiles } = require('../../../plugin/bin/lib/code-health/candidates-dead-code');
  const root = tmpGitRepo();
  write(root, 'robots.txt', 'User-agent: *\n');
  write(root, 'lib/a.js', 'module.exports = {};\n');

  const all = listTrackedFiles(root);
  assert.deepStrictEqual(all.files, ['lib/a.js', 'robots.txt']);
  assert.strictEqual(all.discoveryFailed, false);

  const sourceOnly = listTrackedSourceFiles(root);
  assert.deepStrictEqual(sourceOnly.files, ['lib/a.js']);
  assert.strictEqual(sourceOnly.discoveryFailed, false);
});

// ── Discovery-failure passthrough ────────────────────────────────────────────

test('scanPrelaunch: discoveryFailed on a non-git root, every checklist row n/a', () => {
  const root = tmp(); // not a git repo
  const result = scanPrelaunch(root);
  assert.strictEqual(result.discoveryFailed, true);
  assert.strictEqual(result.candidates.length, 0);
  assert.ok(result.discoveryReason);
  assert.strictEqual(result.notApplicable, false);
  for (const row of result.checklist) {
    assert.strictEqual(row.status, 'n/a');
  }
});

// ── Bare-array entry point ───────────────────────────────────────────────────

test('candidatesPrelaunch: bare-array direct entry point mirrors scanPrelaunch().candidates', () => {
  const root = tmpGitRepo();
  write(root, 'public/index.html', '<html><head></head><body></body></html>');
  const arr = candidatesPrelaunch(root);
  const full = scanPrelaunch(root);
  assert.deepStrictEqual(arr, full.candidates);
});
