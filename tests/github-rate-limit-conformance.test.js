// tests/github-rate-limit-conformance.test.js
// Pins plugin/skills/_shared/github-rate-limit.md's taxonomy/burst-shape text and each
// of its seven consumers' citation of it. Deliberately does not re-pin any
// consumer's own degradation outcome wording — that stays owned by each
// consumer's existing pin suites (or is untested prose where no suite exists).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(REPO_ROOT, rel));

const CONTRACT_PATH = 'plugin/skills/_shared/github-rate-limit.md';
const CONTRACT = read(CONTRACT_PATH);

// --- the three taxonomy signatures ---

const TAXONOMY_ANCHORS = [
  'Secondary / abuse limit',
  'Primary exhaustion',
  'Plain 403 (catchall)',
];

for (const anchor of TAXONOMY_ANCHORS) {
  test(`github-rate-limit.md states the "${anchor}" taxonomy row`, () => {
    assert.ok(CONTRACT.includes(anchor), anchor);
  });
}

test('github-rate-limit.md names the primary-vs-secondary probe mechanism', () => {
  assert.ok(CONTRACT.includes('gh api rate_limit'));
  assert.ok(CONTRACT.includes('remaining: 0'));
});

// --- response policy ---

test('github-rate-limit.md response policy names Retry-After, a bounded retry count, and the wall-clock bound', () => {
  assert.ok(CONTRACT.includes('Retry-After'));
  assert.ok(CONTRACT.includes('At most 2 retries'));
  assert.ok(CONTRACT.includes('~5 minutes'));
});

test('github-rate-limit.md states the auto-mode log-stage-continue shape', () => {
  assert.ok(CONTRACT.includes('$PIPELINE_RUN_DIR'));
  assert.ok(CONTRACT.includes('decisions.md'));
  assert.ok(CONTRACT.includes('standalone invocation'));
});

// --- codified fallbacks ---

test('github-rate-limit.md codifies the contents-API git read fallback', () => {
  assert.ok(CONTRACT.includes("git show 'ref:path'"));
});

test('github-rate-limit.md restricts the protocol swap to primary exhaustion only', () => {
  assert.ok(CONTRACT.includes('Protocol swap (primary exhaustion only)'));
});

// --- the two burst-shape rules ---

const BURST_SHAPE_ANCHORS = [
  'at least 1 second between scripted mutative calls',
  'single call carrying the full label list',
];

for (const anchor of BURST_SHAPE_ANCHORS) {
  test(`github-rate-limit.md states the burst-shape rule "${anchor}"`, () => {
    assert.ok(CONTRACT.includes(anchor), anchor);
  });
}

// --- each consumer cites the contract (case-insensitive, content-anchored) ---
// Paired with a whitespace-spanning control scan per the spec's Gotchas: a
// literal-string grep can miss a citation that wraps mid-line in prose, so
// each consumer is also checked with all whitespace collapsed.

const CONSUMER_FILES = [
  'plugin/skills/_shared/forge-detection.md',
  'plugin/skills/_shared/pr-run-comments.md',
  'plugin/skills/tidy/scan-procedures.md',
  'plugin/skills/_shared/issue-claims.md',
  'plugin/skills/assess-agent-autonomy/failure-check.md',
  'plugin/skills/_shared/github-write-transport.md',
  '.claude/skills/gh-api-module-pattern/SKILL.md',
];

function collapseWhitespace(s) {
  return s.replace(/\s+/g, ' ');
}

for (const rel of CONSUMER_FILES) {
  test(`${rel} cites _shared/github-rate-limit.md (case-insensitive)`, () => {
    const content = read(rel);
    assert.match(content, /_shared\/github-rate-limit\.md/i, rel);
  });

  test(`${rel} cites _shared/github-rate-limit.md (whitespace-spanning control)`, () => {
    const collapsed = collapseWhitespace(read(rel));
    assert.match(collapsed, /_shared\/github-rate-limit\.md/i, rel);
  });
}

// --- the six skill-prose consumers no longer carry their own standalone
// recognition wording (deliberately excludes github-write-transport.md and
// gh-api-module-pattern/SKILL.md, which never carried a standalone clause to
// begin with — their tasks were purely additive) ---

const RETIRED_CLAUSES = {
  'plugin/skills/_shared/forge-detection.md': '(rate limit, network, transient API errors)',
  'plugin/skills/_shared/pr-run-comments.md': '(network, auth, rate limit)',
  'plugin/skills/tidy/scan-procedures.md': '(rate limit, transient',
  'plugin/skills/assess-agent-autonomy/failure-check.md': 'rate-limit (HTTP 429) responses, network timeouts',
};

for (const [rel, retired] of Object.entries(RETIRED_CLAUSES)) {
  test(`${rel} no longer carries its retired standalone rate-limit clause`, () => {
    assert.ok(!read(rel).includes(retired), rel);
  });

  test(`${rel} no longer carries its retired standalone rate-limit clause (whitespace-spanning control)`, () => {
    const collapsed = collapseWhitespace(read(rel));
    const collapsedRetired = collapseWhitespace(retired);
    assert.ok(!collapsed.includes(collapsedRetired), rel);
  });
}

// --- outcome wording survives verbatim (the sweep's target phrases from the
// spec's AC 2 — this is the "consumers' outcome wording stays owned by each
// consumer" half made concrete, not a second copy of any existing pin) ---

test('forge-detection.md keeps its DONE_WITH_CONCERNS outcome', () => {
  assert.ok(read('plugin/skills/_shared/forge-detection.md').includes('DONE_WITH_CONCERNS'));
});

test('pr-run-comments.md keeps its log-to-decisions retryable-failure outcome', () => {
  assert.ok(read('plugin/skills/_shared/pr-run-comments.md').includes('as a retryable failure per the gate section above'));
});

test('scan-procedures.md keeps its skip-the-sweep-step outcome', () => {
  assert.ok(read('plugin/skills/tidy/scan-procedures.md').includes('skip the rest of this step and note it in the report'));
});

test('issue-claims.md keeps its retry-once and TTL-backstop outcome wording verbatim', () => {
  const content = read('plugin/skills/_shared/issue-claims.md');
  assert.ok(content.includes('retry the comment once, warn, proceed; claim stands either way'));
  assert.ok(content.includes('Log; TTL is the backstop'));
});

// --- skill-graph edges exist and no SKILL.md restates the contract ---

test('docs/skill-graph.md carries edges to the new contract from at least four skill sections', () => {
  const graph = read('docs/skill-graph.md');
  const matches = graph.match(/_shared\/github-rate-limit\.md/g) || [];
  assert.ok(matches.length >= 4, `found ${matches.length} edges, expected >= 4`);
});

test('no plugin/skills/**/SKILL.md restates the taxonomy row names', () => {
  const skillsDir = path.join(REPO_ROOT, 'plugin', 'skills');
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'SKILL.md') {
        const c = fs.readFileSync(p, 'utf8');
        if (c.includes('Secondary / abuse limit') && c.includes('Plain 403 (catchall)')) {
          offenders.push(path.relative(REPO_ROOT, p));
        }
      }
    }
  };
  walk(skillsDir);
  assert.deepEqual(offenders, []);
});
