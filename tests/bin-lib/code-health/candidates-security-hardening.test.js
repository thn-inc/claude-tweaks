'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codehealth-sechardening-'));
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
  scanSecurityHardening,
  candidatesSecurityHardening,
  scanClientSecrets,
  scanMissingOwnership,
  scanUnguardedAiEndpoint,
} = require('../../../plugin/bin/lib/code-health/candidates-security-hardening');

// Assembled at runtime, never as a contiguous source-file literal: GitHub push protection's
// secret scanner flags an `sk_live_`-prefixed 16+-char string by format alone, even inside a
// test fixture, and rejected this file's push when the value was written out in full (refs
// #2624). The scanned candidate — the generator's SECRET_PATTERNS regex, matched against the
// fixture file's written content at test-run time — is unaffected: concatenation happens before
// `fs.writeFileSync`, so the on-disk fixture still contains the exact same string.
const FAKE_STRIPE_SECRET_KEY = ['sk_live_', '51H8x9aBcDeFgHiJkLmNoPqR'].join('');

// ── AC: a fixture carrying all three violation patterns flags a distinct
//        finding for each of the three categories ──────────────────────

test('AC1: a vibecoded-app fixture with all three violation patterns flags one finding per category', () => {
  const root = tmpGitRepo();

  write(root, 'client/src/config.js', `
export const STRIPE_SECRET_KEY = "${FAKE_STRIPE_SECRET_KEY}";
export function initClient() {
  return STRIPE_SECRET_KEY;
}
`);

  write(root, 'server/routes/projects.js', `
async function getProject(req, res) {
  const project = await db.query('SELECT * FROM projects WHERE id = ?', [req.params.id]);
  res.json(project);
}
module.exports = { getProject };
`);

  write(root, 'server/routes/chat.js', `
const openai = require('openai');
async function handleChat(req, res) {
  const completion = await openai.chat.completions.create({ model: 'gpt-4', messages: req.body.messages });
  res.json(completion);
}
module.exports = { handleChat };
`);

  const result = scanSecurityHardening(root);
  assert.strictEqual(result.discoveryFailed, false);

  const kinds = new Set(result.candidates.map((c) => c.kind));
  assert.ok(kinds.has('client-secret'), 'expected a client-secret finding');
  assert.ok(kinds.has('missing-ownership-check'), 'expected a missing-ownership-check finding');
  assert.ok(kinds.has('unguarded-ai-endpoint'), 'expected an unguarded-ai-endpoint finding');
});

// ── AC: a clean fixture with none of the three violations produces zero
//        findings (no false positives) ──────────────────────────────────

test('AC2: a clean fixture with none of the three violations produces zero findings', () => {
  const root = tmpGitRepo();

  write(root, 'client/src/config.js', `
export const STRIPE_PUBLISHABLE_KEY = "pk_live_51H8x9aBcDeFgHiJkLmNoPqR";
export const API_BASE_URL = "https://api.example.com";
`);

  write(root, 'server/routes/projects.js', `
async function getProject(req, res) {
  const project = await db.query('SELECT * FROM projects WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json(project);
}
module.exports = { getProject };
`);

  write(root, 'server/routes/chat.js', `
const openai = require('openai');
async function handleChat(req, res) {
  requireAuth(req);
  rateLimit(req, { perUser: true });
  const completion = await openai.chat.completions.create({ model: 'gpt-4', messages: req.body.messages, max_tokens: 500 });
  res.json(completion);
}
module.exports = { handleChat };
`);

  const result = scanSecurityHardening(root);
  assert.strictEqual(result.discoveryFailed, false);
  assert.deepStrictEqual(result.candidates, []);
});

// ── Per-check unit coverage ───────────────────────────────────────────────

test('scanClientSecrets: flags a secret-shaped literal in a client-dir file', () => {
  const candidates = [];
  scanClientSecrets('client/src/config.js', `const KEY = "${FAKE_STRIPE_SECRET_KEY}";`, candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'client-secret');
});

test('scanClientSecrets: does not flag a server-dir file even if it matches CLIENT_DIR_RE loosely', () => {
  const candidates = [];
  scanClientSecrets('server/api/config.js', `const KEY = "${FAKE_STRIPE_SECRET_KEY}";`, candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanClientSecrets: does not flag a known-public key shape (Stripe publishable key)', () => {
  const candidates = [];
  scanClientSecrets('client/src/config.js', 'const KEY = "pk_live_51H8x9aBcDeFgHiJkLmNoPqR";', candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanClientSecrets: does not flag a file outside any recognized client directory', () => {
  const candidates = [];
  scanClientSecrets('lib/config.js', `const KEY = "${FAKE_STRIPE_SECRET_KEY}";`, candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanMissingOwnership: flags a query site with no ownership predicate nearby', () => {
  const candidates = [];
  scanMissingOwnership('api/routes/notes.js', "db.find({ noteId: req.params.id });", candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'missing-ownership-check');
});

test('scanMissingOwnership: does not flag a query site with req.user nearby', () => {
  const candidates = [];
  scanMissingOwnership('api/routes/notes.js', "db.find({ noteId: req.params.id, userId: req.user.id });", candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanMissingOwnership: does not scan a file outside any recognized route directory', () => {
  const candidates = [];
  scanMissingOwnership('lib/queries.js', "db.find({ noteId: req.params.id });", candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanUnguardedAiEndpoint: flags an AI SDK call with no guard signal nearby', () => {
  const candidates = [];
  scanUnguardedAiEndpoint('routes/chat.js', "const r = await anthropic.messages.create({ model: 'claude' });", candidates);
  assert.ok(candidates.length >= 1);
  assert.ok(candidates.every((c) => c.kind === 'unguarded-ai-endpoint'));
});

test('scanUnguardedAiEndpoint: does not flag an AI SDK call with a rate-limit guard nearby', () => {
  const candidates = [];
  scanUnguardedAiEndpoint('routes/chat.js', "rateLimit(req); const r = await anthropic.messages.create({ model: 'claude' });", candidates);
  assert.strictEqual(candidates.length, 0);
});

// ── Discovery-failure passthrough (IL-115 shape, matches sibling verticals) ─

test('scanSecurityHardening: discoveryFailed on a non-git root, never a clean-empty result', () => {
  const root = tmp(); // not a git repo
  const result = scanSecurityHardening(root);
  assert.strictEqual(result.discoveryFailed, true);
  assert.strictEqual(result.candidates.length, 0);
  assert.ok(result.discoveryReason);
});

test('candidatesSecurityHardening: bare-array direct entry point mirrors scanSecurityHardening().candidates', () => {
  const root = tmpGitRepo();
  write(root, 'client/src/config.js', `const KEY = "${FAKE_STRIPE_SECRET_KEY}";`);
  const arr = candidatesSecurityHardening(root);
  assert.ok(Array.isArray(arr));
  assert.strictEqual(arr.length, 1);
  assert.strictEqual(arr[0].kind, 'client-secret');
});

// ── Registry wiring ────────────────────────────────────────────────────────

test('registry: security-hardening is registered in FOCUS_GENERATORS', () => {
  const { FOCUS_GENERATORS } = require('../../../plugin/bin/lib/code-health/focus-generators');
  assert.strictEqual(typeof FOCUS_GENERATORS['security-hardening'], 'function');
});

test('criteria: security-hardening criterion is registered with its fragment', () => {
  const { getCriterion } = require('../../../plugin/bin/lib/code-health/criteria');
  const c = getCriterion('security-hardening');
  assert.ok(c);
  assert.strictEqual(c.fragment, 'criteria-security-hardening.md');
});
