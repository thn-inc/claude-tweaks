// tests/session-tmp-root-migration.test.js
//
// Pins #266's migration: the 4 named skill families (specify, dispatch,
// backlog, assess-agent-autonomy) plus the two directly-chained backlog
// files (attention-mode.md, trust-signal.md) discovered by reference during
// the build, no longer hardcode an unscoped /tmp/{skill}-*.{json,md,txt}
// path -- every one resolves through bin/lib/session-tmp.js's
// sessionTmpPath, citing _shared/session-tmp-root.md. _shared/trust-table.md
// itself (#1386's follow-up migration) is also pinned here now, alongside the
// backlog/trust-signal.md consumer that reads its intermediate files.
//
// AC1's grep is repo-wide (`skills/`); this test scopes to the files each
// migration record actually touched. #923 closed the follow-up named above
// -- the four health-sweep skills, wrap-up/*, tidy/capture/help/init, and
// the remaining shared _shared/ scan-procedure files -- so their migrated
// files are pinned here too, alongside #266's original set.

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..', 'plugin', 'skills');

const MIGRATED_FILES = [
  'specify/decomposition-mode.md',
  'specify/record-creation.md',
  'specify/record-creation-subissues.md', // #1346 split record-creation.md; carries its own session-tmp usage
  'specify/shaping-mode-stamping.md', // #1346 split shaping-mode.md; the session-tmp usage landed here
  'dispatch/queue-pull-script.md',
  '_shared/headless-self-report.md',
  'dispatch/settle-and-merge.md',
  'dispatch/SKILL.md',
  'backlog/overview-mode.md',
  'backlog/refine-mode.md',
  'backlog/refine-lanes.md',
  'backlog/refine-headless.md',
  'backlog/attention-mode.md',
  'backlog/trust-signal.md',
  'assess-agent-autonomy/grant-check.md',
  '_shared/trust-table.md',
  // #923's remaining skills/** sweep:
  '_shared/github-pr-scan-acceptance.md',
  '_shared/github-pr-scan.md',
  '_shared/harness-health-analysis.md',
  '_shared/label-bootstrap.md',
  'capture/SKILL.md',
  'code-health/SKILL.md',
  'code-health/filing.md',
  'code-health/focus-mode.md',
  'docs-health/SKILL.md',
  'harness-health/SKILL.md',
  'harness-health/filing.md',
  'harness-health/judge-procedure.md',
  'help/status-scan.md',
  'init/bootstrap/step-14-cloud-routine-parity.md',
  'journey-health/SKILL.md',
  'specify/next-mode.md',
  'tidy/step-1-records.md',
  'wrap-up/SKILL.md',
  'wrap-up/docs-health-integration.md',
  'wrap-up/leftover-routing.md',
  'wrap-up/unblocked-records.md',
  'wrap-up/verification-brief-parent-gate.md',
];

// Matches a literal, unscoped /tmp/{prefix}-*.{ext} path -- the shape this
// record eliminates. Excludes the sanctioned os.tmpdir()-based degrade
// fallback (no literal '/tmp/' substring appears there at all) and the
// unrelated session-snapshot path (ct-records-{session-id}.json, already
// session-scoped by construction, not this record's concern).
//
// #1511: each hyphen-joined segment also tolerates a `{placeholder}` token
// (e.g. `{issue}`, `{n}`) via the `(?:[a-z0-9-]|\{[a-zA-Z0-9]+\})` alternation
// -- a plain `[a-z0-9-]*` class can't span the `{`/`}` characters, so it broke
// the match (and never re-synchronized to the extension past the token) on a
// literal like `/tmp/backlog-needs-decision-{issue}.md`, letting it ship
// undetected in a MIGRATED_FILES entry. The required literal `-` between the
// two segments, the `(?!ct-)` exclusion, and the required leading `[a-z]` are
// all unchanged, so this only widens what a segment's own characters can be,
// not which paths qualify as candidates in the first place.
const LITERAL_TMP_RE = /\/tmp\/(?!ct-)[a-z](?:[a-z0-9-]|\{[a-zA-Z0-9]+\})*-(?:[a-z0-9-]|\{[a-zA-Z0-9]+\})*\.(json|md|txt|graphql|err|jsonl)/;

test('every migrated file cites _shared/session-tmp-root.md', () => {
  for (const rel of MIGRATED_FILES) {
    const text = readText(path.join(ROOT, rel));
    assert.match(text, /session-tmp-root\.md/, `${rel} must cite _shared/session-tmp-root.md`);
  }
});

// backlog/trust-signal.md previously referenced two /tmp/trust-table-*.{json,txt} paths
// that _shared/trust-table.md's Fetch section itself owns and writes (shared across many
// consumers beyond backlog: /tidy, /visualize, /capture, ...). That follow-up (#1386) has
// since migrated trust-table.md's own Fetch section, and trust-signal.md along with it, so
// no exception is needed here any more -- both files resolve every intermediate path
// through the session scratchpad.

test('no migrated file retains a literal unscoped /tmp/{prefix}-*.{ext} path', () => {
  const offenders = [];
  for (const rel of MIGRATED_FILES) {
    const text = readText(path.join(ROOT, rel));
    const m = text.match(LITERAL_TMP_RE);
    if (m) offenders.push(`${rel}: ${m[0]}`);
  }
  assert.deepEqual(offenders, [], 'migrated files must carry zero literal unscoped /tmp paths');
});

// #1511: LITERAL_TMP_RE couldn't span a {placeholder} token, so a migrated
// file could carry one indefinitely undetected -- the exact shape that
// shipped (undetected) in backlog/refine-lanes.md's needs-decision and
// flag-back lanes before #1488's review caught and fixed both by hand.
// Proves detection against fixture file content mirroring the loop above's
// own read-and-match mechanism, without polluting the real MIGRATED_FILES
// corpus with a deliberate violation.
test('LITERAL_TMP_RE catches a bare /tmp path containing a {placeholder} token (#1511 regression)', () => {
  const os = require('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-session-tmp-migration-fixture-'));
  try {
    const cases = [
      ['/tmp/backlog-needs-decision-{issue}.md', '/tmp/backlog-needs-decision-{issue}.md'],
      ['/tmp/backlog-refine-flagback-{issue}.md', '/tmp/backlog-refine-flagback-{issue}.md'],
      ['/tmp/some-thing-{placeholder}.md', '/tmp/some-thing-{placeholder}.md'],
    ];
    for (const [literal, expected] of cases) {
      const fixturePath = path.join(tmpDir, 'fixture.md');
      fs.writeFileSync(fixturePath, `See ${literal} for details.\n`);
      const text = fs.readFileSync(fixturePath, 'utf8');
      const m = text.match(LITERAL_TMP_RE);
      assert.ok(m, `${literal} must be caught as a bare unscoped /tmp path`);
      assert.equal(m[0], expected);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Negative controls alongside the positive fixture above: the widening must
// not loosen what counts as a candidate path in the first place.
test('LITERAL_TMP_RE still rejects legitimate session-scoped and ct-prefixed paths after the #1511 widening', () => {
  assert.equal(LITERAL_TMP_RE.test('/tmp/ct-records-{session-id}.json'), false, 'ct-prefixed paths stay excluded');
  assert.equal(LITERAL_TMP_RE.test('/tmp/${SESSION_TMP_ROOT}/foo-{n}.md'), false, '$VAR-based session-scoped paths stay excluded');
  assert.equal(LITERAL_TMP_RE.test('See _shared/session-tmp-root.md for the scratchpad convention.'), false, 'ordinary prose with no /tmp literal stays excluded');
});

test('_shared/session-tmp-root.md documents the degrade rule and the record-suffix composition rule', () => {
  const text = readText(path.join(ROOT, '_shared', 'session-tmp-root.md'));
  assert.match(text, /Degrade rule/, 'must document the no-session-id fallback');
  assert.match(text, /Record-suffixed callers keep both suffixes/, 'must document combining session root with an existing record suffix');
});

test('bin/lib/session-tmp.js is a pure module (no gh/MCP/network calls)', () => {
  const text = readText(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'session-tmp.js'));
  assert.doesNotMatch(text, /execFileSync|execSync|spawn|fetch\(/, 'must stay pure filesystem helpers, no network/process calls');
});
