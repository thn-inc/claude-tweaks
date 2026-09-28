'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  checkAuthRateLimiting,
  checkBotManagement,
  checkWafCustomRules,
  auditCloudflareZone,
  MANUAL_REVIEW_PROMPTS,
} = require('../../plugin/bin/lib/cloudflare-hardening');

// ── AC1: a zone-level-only rate-limiting rule (no path-specific match)
//         flags that auth endpoints aren't specifically covered ──────────

test('AC1: zone-level-only rate-limiting rule flags missing auth-path coverage', () => {
  const result = checkAuthRateLimiting([
    { description: 'blanket zone rate limit', expression: 'true' },
  ]);
  assert.equal(result.check, 'rate-limiting-auth-endpoints');
  assert.equal(result.status, 'fail');
});

test('AC1b: no rate-limiting rules at all also flags missing auth-path coverage', () => {
  const result = checkAuthRateLimiting([]);
  assert.equal(result.status, 'fail');
});

// ── AC2: a rule whose match expression targets /login, /signup, and
//         /password-reset passes without a false-positive flag ──────────

test('AC2: a rule targeting /login, /signup, /password-reset passes', () => {
  const result = checkAuthRateLimiting([
    {
      description: 'auth endpoint rate limit',
      expression: 'http.request.uri.path in {"/login" "/signup" "/password-reset"}',
    },
  ]);
  assert.equal(result.status, 'pass');
});

test('AC2b: equivalent auth-path spellings across separate rules still pass', () => {
  const result = checkAuthRateLimiting([
    { expression: 'http.request.uri.path eq "/login"' },
    { expression: 'http.request.uri.path eq "/sign-up"' },
    { expression: 'http.request.uri.path eq "/reset-password"' },
  ]);
  assert.equal(result.status, 'pass');
});

test('a rule covering only some auth paths does not pass', () => {
  const result = checkAuthRateLimiting([
    { expression: 'http.request.uri.path eq "/login"' },
  ]);
  assert.equal(result.status, 'fail');
  assert.match(result.message, /missing/);
});

test('a rule targeting a non-auth path specifically still fails (no auth coverage)', () => {
  const result = checkAuthRateLimiting([
    { expression: 'http.request.uri.path eq "/api/data"' },
  ]);
  assert.equal(result.status, 'fail');
});

test('a broad wildcard path expression is flagged for human review, not confidently passed or failed', () => {
  const result = checkAuthRateLimiting([
    { expression: 'http.request.uri.path eq "/*"' },
  ]);
  assert.equal(result.status, 'review');
});

test('an unrecognized non-blanket expression shape is flagged for review rather than guessed', () => {
  const result = checkAuthRateLimiting([
    { expression: 'cf.client.bot' },
  ]);
  assert.equal(result.status, 'review');
});

// ── AC3: bot management ────────────────────────────────────────────────

test('AC3a: bot management (Bot Fight Mode) disabled is flagged', () => {
  const result = checkBotManagement({ enabled: false, fightMode: false });
  assert.equal(result.check, 'bot-management');
  assert.equal(result.status, 'fail');
});

test('AC3b: Bot Fight Mode enabled passes', () => {
  const result = checkBotManagement({ fightMode: true });
  assert.equal(result.status, 'pass');
});

test('AC3c: full bot management enabled (snake_case API field) passes', () => {
  const result = checkBotManagement({ fight_mode: true });
  assert.equal(result.status, 'pass');
});

test('bot management settings unavailable is a review verdict, never a silent pass', () => {
  const result = checkBotManagement(null);
  assert.equal(result.status, 'review');
});

// ── AC4: WAF custom rules ──────────────────────────────────────────────

test('AC4a: relying only on the default managed ruleset (no custom rules) is flagged', () => {
  const result = checkWafCustomRules({ customRules: [] });
  assert.equal(result.check, 'waf-custom-rules');
  assert.equal(result.status, 'fail');
});

test('AC4b: at least one custom rule targeting a named attack pattern passes', () => {
  const result = checkWafCustomRules({
    customRules: [{ name: 'block-sqli-login', description: 'Blocks known SQLi payloads on /login' }],
  });
  assert.equal(result.status, 'pass');
});

test('a custom rule with no name or description is flagged for review', () => {
  const result = checkWafCustomRules({ customRules: [{ expression: 'true' }] });
  assert.equal(result.status, 'review');
});

test('WAF configuration unavailable is a review verdict, never a silent pass', () => {
  const result = checkWafCustomRules(undefined);
  assert.equal(result.status, 'review');
});

// ── AC5: no false-positive flags on a fully hardened zone ─────────────

test('AC5: a fully hardened zone configuration produces no fail findings', () => {
  const findings = auditCloudflareZone({
    rateLimitRules: [
      { expression: 'http.request.uri.path in {"/login" "/signup" "/password-reset"}' },
    ],
    botManagement: { enabled: true },
    waf: {
      customRules: [{ name: 'block-credential-stuffing', description: 'Blocks known credential-stuffing UA patterns' }],
    },
  });
  assert.equal(findings.length, 3);
  for (const f of findings) {
    assert.equal(f.status, 'pass', `expected pass for ${f.check}, got ${f.status}: ${f.message}`);
  }
});

test('auditCloudflareZone tolerates a completely empty config without throwing', () => {
  const findings = auditCloudflareZone();
  assert.equal(findings.length, 3);
  assert.deepEqual(findings.map((f) => f.check), [
    'rate-limiting-auth-endpoints',
    'bot-management',
    'waf-custom-rules',
  ]);
});

// ── Manual-review fallback (deliverable 4) ─────────────────────────────

test('every check has a manual-review prompt naming what to look for in the dashboard', () => {
  for (const check of ['rate-limiting-auth-endpoints', 'bot-management', 'waf-custom-rules']) {
    assert.equal(typeof MANUAL_REVIEW_PROMPTS[check], 'string');
    assert.ok(MANUAL_REVIEW_PROMPTS[check].length > 0);
  }
});
