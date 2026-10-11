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
  scanJwtValidation,
  scanSecretsLifecycle,
  scanPrivacyPolicyMismatch,
  scanSharedAgentIdentity,
  scanUnauditedDelegation,
  scanUnescapedOutput,
  scanUnrestrictedUpload,
  scanUnverifiedWebhook,
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

test('scanClientSecrets: an unrelated NEXT_PUBLIC_*/pk_live_* token elsewhere in the file does not suppress a real secret on a different line (allowlist-window tightening)', () => {
  const candidates = [];
  const padding = '// filler line to push the two apart\n'.repeat(20); // > 400 chars
  const text = `export const NEXT_PUBLIC_API_URL = "https://api.example.com";\n${padding}const KEY = "${FAKE_STRIPE_SECRET_KEY}";`;
  scanClientSecrets('client/src/config.js', text, candidates);
  assert.strictEqual(candidates.length, 1, 'the real secret must still be flagged despite the unrelated safe-prefix token earlier in the file');
  assert.strictEqual(candidates[0].kind, 'client-secret');
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

// ── JWT validation (#2657): alg-confusion / alg:none / long-lived-token ────

test('scanJwtValidation: flags a verify call with no algorithms allowlist (AC: alg:none / algorithm-confusion)', () => {
  const candidates = [];
  scanJwtValidation('server/routes/auth.js', 'const payload = jwt.verify(req.headers.authorization, SECRET);', candidates);
  const kinds = candidates.map((c) => c.kind);
  assert.ok(kinds.includes('jwt-alg-not-pinned'));
});

test('scanJwtValidation: does not flag a verify call with an explicit algorithms allowlist', () => {
  const candidates = [];
  scanJwtValidation('server/routes/auth.js', 'const payload = jwt.verify(req.headers.authorization, SECRET, { algorithms: ["HS256"] });', candidates);
  assert.strictEqual(candidates.filter((c) => c.kind === 'jwt-alg-not-pinned').length, 0);
});

test('scanJwtValidation: flags a sign call with no expiresIn option (AC: long-lived token)', () => {
  const candidates = [];
  scanJwtValidation('server/routes/auth.js', 'const token = jwt.sign({ userId: user.id }, SECRET);', candidates);
  const kinds = candidates.map((c) => c.kind);
  assert.ok(kinds.includes('jwt-long-lived-token'));
});

test('scanJwtValidation: does not flag a sign call with an expiresIn option (AC: short-lived + refresh flow)', () => {
  const candidates = [];
  scanJwtValidation('server/routes/auth.js', 'const token = jwt.sign({ userId: user.id }, SECRET, { expiresIn: "15m" });', candidates);
  assert.strictEqual(candidates.filter((c) => c.kind === 'jwt-long-lived-token').length, 0);
});

test('scanJwtValidation: a correctly-guarded sample (both algorithms and expiresIn pinned) produces no false positives', () => {
  const candidates = [];
  scanJwtValidation(
    'server/routes/auth.js',
    'const payload = jwt.verify(token, SECRET, { algorithms: ["HS256"] });\nconst fresh = jwt.sign({ userId: 1 }, SECRET, { expiresIn: "15m" });',
    candidates,
  );
  assert.deepStrictEqual(candidates, []);
});

test('scanJwtValidation: does not scan a pure client-dir file', () => {
  const candidates = [];
  scanJwtValidation('client/src/auth.js', 'const payload = jwt.verify(token, SECRET);', candidates);
  assert.strictEqual(candidates.length, 0);
});

// ── Secrets lifecycle (#2666): manager / rotation-procedure / rotation-schedule ─

test('scanSecretsLifecycle: flags credential env access with no secrets-manager SDK import (AC: .env-only app)', () => {
  const candidates = [];
  scanSecretsLifecycle('server/config.js', 'const apiKey = process.env.THIRD_PARTY_API_KEY;', candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'secrets-no-manager');
});

test('scanSecretsLifecycle: does not flag a known-public env var name (e.g. *_PUBLIC_KEY)', () => {
  const candidates = [];
  scanSecretsLifecycle('server/config.js', 'const key = process.env.STRIPE_PUBLISHABLE_KEY;', candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanSecretsLifecycle: a secrets-manager import with no rotation mention flags no-rotation-procedure', () => {
  const candidates = [];
  scanSecretsLifecycle(
    'server/config.js',
    'const { SecretsManagerClient } = require("@aws-sdk/client-secrets-manager");\nconst apiKey = process.env.THIRD_PARTY_API_KEY;',
    candidates,
  );
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'no-rotation-procedure');
});

test('scanSecretsLifecycle: a rotation mention with no automation signal flags no-rotation-schedule', () => {
  const candidates = [];
  scanSecretsLifecycle(
    'server/config.js',
    'const { SecretsManagerClient } = require("@aws-sdk/client-secrets-manager");\nconst apiKey = process.env.THIRD_PARTY_API_KEY;\n// manual dual-key rotation: new key verified, old key revoked',
    candidates,
  );
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'no-rotation-schedule');
});

test('scanSecretsLifecycle: a distant, unrelated automation signal does not suppress a genuinely manual-only rotation (windowed, not whole-file)', () => {
  const candidates = [];
  const text =
    'const { SecretsManagerClient } = require("@aws-sdk/client-secrets-manager");\n' +
    'const apiKey = process.env.THIRD_PARTY_API_KEY;\n' +
    '// Rotation of the API key must be done manually by an on-call engineer.\n' +
    'x'.repeat(500) +
    '\ncron.schedule("0 0 * * *", unrelatedJob);';
  scanSecretsLifecycle('server/config.js', text, candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'no-rotation-schedule');
});

test('scanSecretsLifecycle: a lowercase/camelCase credential-shaped env name is recognized (case-insensitive)', () => {
  const candidates = [];
  scanSecretsLifecycle('server/config.js', 'const apiKey = process.env.thirdPartyApiKey;', candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'secrets-no-manager');
});

test('scanSecretsLifecycle: a sample app with manager + documented + scheduled rotation produces no findings (AC: clean pass)', () => {
  const candidates = [];
  scanSecretsLifecycle(
    'server/config.js',
    'const { SecretsManagerClient } = require("@aws-sdk/client-secrets-manager");\nconst apiKey = process.env.THIRD_PARTY_API_KEY;\n// dual-key rotation runs on a scheduled cron job every 30 days',
    candidates,
  );
  assert.deepStrictEqual(candidates, []);
});

test('scanSecretsLifecycle: does not scan a pure client-dir file', () => {
  const candidates = [];
  scanSecretsLifecycle('client/src/config.js', 'const apiKey = process.env.THIRD_PARTY_API_KEY;', candidates);
  assert.strictEqual(candidates.length, 0);
});

// ── Privacy-policy accuracy (#2663) ─────────────────────────────────────────

test('scanPrivacyPolicyMismatch: flags a third-party service used in code but not named in the privacy policy', () => {
  const root = tmpGitRepo();
  write(root, 'PRIVACY.md', 'We do not sell your data. We use cookies for session management.');
  write(root, 'server/routes/chat.js', 'const mixpanel = require("mixpanel"); mixpanel.track("signup");');
  const candidates = [];
  scanPrivacyPolicyMismatch(['PRIVACY.md', 'server/routes/chat.js'], root, candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'privacy-policy-mismatch');
  assert.match(candidates[0].evidence, /Mixpanel/);
});

test('scanPrivacyPolicyMismatch: produces no false-positive flag when the policy correctly names the integrated service', () => {
  const root = tmpGitRepo();
  write(root, 'PRIVACY.md', 'We use Mixpanel for product analytics.');
  write(root, 'server/routes/chat.js', 'const mixpanel = require("mixpanel"); mixpanel.track("signup");');
  const candidates = [];
  scanPrivacyPolicyMismatch(['PRIVACY.md', 'server/routes/chat.js'], root, candidates);
  assert.deepStrictEqual(candidates, []);
});

test('scanPrivacyPolicyMismatch: no candidate at all when the repo has no privacy-policy file (existence is prelaunch\'s job, not this check\'s)', () => {
  const root = tmpGitRepo();
  write(root, 'server/routes/chat.js', 'const mixpanel = require("mixpanel"); mixpanel.track("signup");');
  const candidates = [];
  scanPrivacyPolicyMismatch(['server/routes/chat.js'], root, candidates);
  assert.deepStrictEqual(candidates, []);
});

// ── End-to-end: all three sibling-record checks surface through scanSecurityHardening ─

test('scanSecurityHardening: a fixture carrying the three new violation patterns flags all three kinds', () => {
  const root = tmpGitRepo();
  write(root, 'server/routes/auth.js', 'const payload = jwt.verify(req.headers.authorization, SECRET);');
  write(root, 'server/config.js', 'const apiKey = process.env.THIRD_PARTY_API_KEY;');
  write(root, 'PRIVACY.md', 'We do not sell your data.');
  write(root, 'server/routes/chat.js', 'const mixpanel = require("mixpanel"); mixpanel.track("signup");');

  const result = scanSecurityHardening(root);
  assert.strictEqual(result.discoveryFailed, false);
  const kinds = new Set(result.candidates.map((c) => c.kind));
  assert.ok(kinds.has('jwt-alg-not-pinned'), 'expected a jwt-alg-not-pinned finding');
  assert.ok(kinds.has('secrets-no-manager'), 'expected a secrets-no-manager finding');
  assert.ok(kinds.has('privacy-policy-mismatch'), 'expected a privacy-policy-mismatch finding');
});

// ── #2751: shared-agent-identity (identity/delegation-audit gaps) ─────────

test('scanSharedAgentIdentity: flags a credential identifier reused across two distinct agent-like call sites', () => {
  const candidates = [];
  scanSharedAgentIdentity('lib/agents.js', `
const AGENT_API_TOKEN = process.env.AGENT_API_TOKEN;
callAgentA(AGENT_API_TOKEN);
callAgentB(AGENT_API_TOKEN);
`, candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'shared-agent-identity');
});

test('scanSharedAgentIdentity: does not flag a credential identifier used at only one call site', () => {
  const candidates = [];
  scanSharedAgentIdentity('lib/agents.js', `
const AGENT_API_TOKEN = process.env.AGENT_API_TOKEN;
callAgentA(AGENT_API_TOKEN);
`, candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanSharedAgentIdentity: does not flag a credential reused across non-agent-like callees', () => {
  const candidates = [];
  scanSharedAgentIdentity('lib/agents.js', `
const AGENT_API_TOKEN = process.env.AGENT_API_TOKEN;
logRequest(AGENT_API_TOKEN);
formatHeader(AGENT_API_TOKEN);
`, candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanUnauditedDelegation: flags a delegation call with no log/trace/audit signal nearby', () => {
  const candidates = [];
  scanUnauditedDelegation('lib/orchestrator.js', "agent.call(subAgentId, payload);", candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'shared-agent-identity');
});

test('scanUnauditedDelegation: does not flag a delegation call with a logger signal nearby', () => {
  const candidates = [];
  scanUnauditedDelegation('lib/orchestrator.js', "logger.info('delegating'); agent.call(subAgentId, payload);", candidates);
  assert.strictEqual(candidates.length, 0);
});

test('AC (#2751): a fixture with a shared-identity pattern produces a shared-agent-identity finding via the full scan', () => {
  const root = tmpGitRepo();
  write(root, 'lib/agents.js', `
const AGENT_API_TOKEN = process.env.AGENT_API_TOKEN;
function callAgentA(token) { return dispatchToAgentA(token); }
function callAgentB(token) { return dispatchToAgentB(token); }
callAgentA(AGENT_API_TOKEN);
callAgentB(AGENT_API_TOKEN);
`);

  const result = scanSecurityHardening(root);
  assert.strictEqual(result.discoveryFailed, false);
  const kinds = new Set(result.candidates.map((c) => c.kind));
  assert.ok(kinds.has('shared-agent-identity'), 'expected a shared-agent-identity finding');
});

// ── #2668: unescaped-output (XSS via unsanitized raw-HTML sinks) ──────────

test('scanUnescapedOutput: flags dangerouslySetInnerHTML with no sanitizer signal nearby', () => {
  const candidates = [];
  scanUnescapedOutput('client/src/Comment.jsx', "function Comment({ body }) { return <div dangerouslySetInnerHTML={{ __html: body }} />; }", candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'unescaped-output');
});

test('scanUnescapedOutput: does not flag dangerouslySetInnerHTML with a DOMPurify sanitizer nearby', () => {
  const candidates = [];
  scanUnescapedOutput('client/src/Comment.jsx', "const clean = DOMPurify.sanitize(body); function Comment() { return <div dangerouslySetInnerHTML={{ __html: clean }} />; }", candidates);
  assert.strictEqual(candidates.length, 0);
});

test('AC (#2668): a vulnerable unescaped-output fixture is flagged and a mitigated one is not', () => {
  const vulnRoot = tmpGitRepo();
  write(vulnRoot, 'client/src/Comment.jsx', `
export function Comment({ body }) {
  return <div dangerouslySetInnerHTML={{ __html: body }} />;
}
`);
  const vulnResult = scanSecurityHardening(vulnRoot);
  assert.ok(new Set(vulnResult.candidates.map((c) => c.kind)).has('unescaped-output'), 'expected an unescaped-output finding');

  const cleanRoot = tmpGitRepo();
  write(cleanRoot, 'client/src/Comment.jsx', `
import DOMPurify from 'dompurify';
export function Comment({ body }) {
  const clean = DOMPurify.sanitize(body);
  return <div dangerouslySetInnerHTML={{ __html: clean }} />;
}
`);
  const cleanResult = scanSecurityHardening(cleanRoot);
  assert.ok(!new Set(cleanResult.candidates.map((c) => c.kind)).has('unescaped-output'), 'sanitized output must not be flagged');
});

// ── #2668: unrestricted-upload (no type/size-limit guard on an upload handler) ─

test('scanUnrestrictedUpload: flags a multer handler with no type/size-limit signal nearby', () => {
  const candidates = [];
  scanUnrestrictedUpload('server/routes/uploads.js', "const upload = multer({ dest: 'uploads/' });", candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'unrestricted-upload');
});

test('scanUnrestrictedUpload: does not flag a multer handler with a fileFilter and limits nearby', () => {
  const candidates = [];
  scanUnrestrictedUpload('server/routes/uploads.js', "const upload = multer({ dest: 'uploads/', fileFilter, limits: { fileSize: 1024 * 1024 } });", candidates);
  assert.strictEqual(candidates.length, 0);
});

test('AC (#2668): a vulnerable unrestricted-upload fixture is flagged and a mitigated one is not', () => {
  const vulnRoot = tmpGitRepo();
  write(vulnRoot, 'server/routes/uploads.js', `
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
router.post('/upload', upload.single('file'), (req, res) => res.sendStatus(200));
`);
  const vulnResult = scanSecurityHardening(vulnRoot);
  assert.ok(new Set(vulnResult.candidates.map((c) => c.kind)).has('unrestricted-upload'), 'expected an unrestricted-upload finding');

  const cleanRoot = tmpGitRepo();
  write(cleanRoot, 'server/routes/uploads.js', `
const multer = require('multer');
const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => cb(null, allowedExtensions.includes(extname(file.originalname))),
  limits: { fileSize: 2 * 1024 * 1024 },
});
router.post('/upload', upload.single('file'), (req, res) => res.sendStatus(200));
`);
  const cleanResult = scanSecurityHardening(cleanRoot);
  assert.ok(!new Set(cleanResult.candidates.map((c) => c.kind)).has('unrestricted-upload'), 'validated upload must not be flagged');
});

// ── #2668: unverified-webhook (no signature-verification signal on a webhook route) ─

test('scanUnverifiedWebhook: flags a webhook-named-file route handler with no signature-verification signal nearby', () => {
  const candidates = [];
  scanUnverifiedWebhook('server/routes/webhooks/stripe.js', "router.post('/webhooks/stripe', async (req, res) => { const event = req.body; res.sendStatus(200); });", candidates);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'unverified-webhook');
});

test('scanUnverifiedWebhook: does not flag a webhook handler with constructEvent signature verification nearby', () => {
  const candidates = [];
  scanUnverifiedWebhook('server/routes/webhooks/stripe.js', "router.post('/webhooks/stripe', async (req, res) => { const event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret); res.sendStatus(200); });", candidates);
  assert.strictEqual(candidates.length, 0);
});

test('scanUnverifiedWebhook: does not scan a file outside any recognized webhook path', () => {
  const candidates = [];
  scanUnverifiedWebhook('server/routes/orders.js', "router.post('/orders', async (req, res) => { res.sendStatus(200); });", candidates);
  assert.strictEqual(candidates.length, 0);
});

test('AC (#2668): a vulnerable unverified-webhook fixture is flagged and a mitigated one is not', () => {
  const vulnRoot = tmpGitRepo();
  write(vulnRoot, 'server/routes/webhooks/stripe.js', `
const router = require('express').Router();
router.post('/webhooks/stripe', async (req, res) => {
  const event = req.body;
  if (event.type === 'payment_intent.succeeded') {
    await markOrderPaid(event.data.object.id);
  }
  res.sendStatus(200);
});
module.exports = router;
`);
  const vulnResult = scanSecurityHardening(vulnRoot);
  assert.ok(new Set(vulnResult.candidates.map((c) => c.kind)).has('unverified-webhook'), 'expected an unverified-webhook finding');

  const cleanRoot = tmpGitRepo();
  write(cleanRoot, 'server/routes/webhooks/stripe.js', `
const router = require('express').Router();
router.post('/webhooks/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.sendStatus(400);
  }
  if (event.type === 'payment_intent.succeeded') {
    await markOrderPaid(event.data.object.id);
  }
  res.sendStatus(200);
});
module.exports = router;
`);
  const cleanResult = scanSecurityHardening(cleanRoot);
  assert.ok(!new Set(cleanResult.candidates.map((c) => c.kind)).has('unverified-webhook'), 'signature-verified webhook must not be flagged');
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
