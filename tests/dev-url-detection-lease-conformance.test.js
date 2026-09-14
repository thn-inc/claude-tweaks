'use strict';
// Pins #1795's lease-first dev-url-detection rewrite — a prose test per
// skill-prose-conformance-tests: each assertion pins a literal substring or
// ordering that would go red if the corresponding edit were ever reverted.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

const DOC = 'plugin/skills/_shared/dev-url-detection.md';

// AC1
test('Step 0.5 heading invokes bin/ports.js env and states the Steps 1-2.7 skip rule on a responding leased port', () => {
  const doc = read(DOC);
  const idx = doc.indexOf('### Step 0.5: Lease-First Probe');
  assert.notEqual(idx, -1, 'Step 0.5 heading not found');
  const step1Idx = doc.indexOf('### Step 1: Probe Common Ports');
  assert.ok(idx < step1Idx, 'Step 0.5 must come before Step 1');
  const body = doc.slice(idx, step1Idx);
  assert.ok(body.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/ports.js" env'));
  assert.match(body, /Skip Steps 1 through 2\.7 entirely/);
});

// AC2
test("Step 2.7's MATCH rule is stated in LEASE_PORTS terms, and lsof sits inside an explicit no-lease branch labelled POSIX-only with the Windows outcome", () => {
  const doc = read(DOC);
  const idx = doc.indexOf('### Step 2.7: Worktree Awareness');
  const step3Idx = doc.indexOf('### Step 3: Resolve');
  assert.ok(idx !== -1 && step3Idx !== -1 && idx < step3Idx);
  const body = doc.slice(idx, step3Idx);

  assert.match(body, /\*\*With a lease\*\*[\s\S]*MATCH.*—.*member of `LEASE_PORTS`/);
  assert.match(body, /\*\*With no lease:\*\*[\s\S]*POSIX-only/);
  const leaseIdx = body.indexOf('**With a lease**');
  const lsofIdx = body.indexOf('lsof');
  assert.ok(leaseIdx !== -1 && lsofIdx !== -1 && lsofIdx > leaseIdx, 'lsof must appear only inside the no-lease branch, after the lease-membership rule');
  assert.match(body, /Windows outcome/);
  assert.match(body, /always `FOREIGN`.*always start a fresh ephemeral server|FOREIGN.*ephemeral/s);
});

// AC3
test('Ephemeral server start names the managed env pass-through and no longer says "probe upward" for the leased case', () => {
  const doc = read(DOC);
  const idx = doc.indexOf('#### Ephemeral server start');
  const outputIdx = doc.indexOf('### Output');
  assert.ok(idx !== -1 && outputIdx !== -1 && idx < outputIdx);
  const body = doc.slice(idx, outputIdx);

  assert.match(body, /\*\*with a lease:\*\*/i);
  assert.match(body, /pass every printed `KEY=value` line into the spawned server's environment verbatim/);
  assert.match(body, /\*\*Without a lease:\*\*.*probe upward/is);
  const leasedClauseEnd = body.indexOf('**Without a lease:**');
  const leasedClause = body.slice(0, leasedClauseEnd);
  assert.doesNotMatch(leasedClause, /probe upward/i, 'the leased branch must not say "probe upward"');
});

// AC5: the Output section (APP_URL / SERVER_STARTED) must be byte-identical to
// what it was before this unit's edits.
test('the Output section is unchanged: APP_URL and SERVER_STARTED, exact table', () => {
  const doc = read(DOC);
  const idx = doc.indexOf('### Output');
  const step4Idx = doc.indexOf('### Step 4: Persist Result');
  assert.ok(idx !== -1 && step4Idx !== -1 && idx < step4Idx);
  const body = doc.slice(idx, step4Idx).replace(/\r\n/g, '\n').trimEnd();
  const expected = [
    '### Output',
    '',
    'This procedure sets two variables for the calling skill:',
    '',
    '| Variable | Value |',
    '|----------|-------|',
    '| `APP_URL` | The detected or user-provided URL (e.g., `http://localhost:3000`) |',
    '| `SERVER_STARTED` | `true` if this procedure started the server, `false` otherwise |',
  ].join('\n');
  assert.equal(body, expected, 'the Output section must be byte-identical to before #1795');
});

// AC6
// Per-file 40 KB pin on dev-url-detection.md retired by #1997 — the
// per-file tier is a warning since #1990 and this file has no compose call
// site; removal condition in docs/incident-log.md [IL-153].

// AC4
test("wrap-up cleanup-procedures-execution.md Section D qualifies the lsof fallback as no-lease-only", () => {
  const wrapup = read('plugin/skills/wrap-up/cleanup-procedures-execution.md');
  const idx = wrapup.indexOf('## D. Ephemeral dev server');
  assert.notEqual(idx, -1);
  const body = wrapup.slice(idx, idx + 1500);
  assert.match(body, /no-lease\/POSIX-only/);
  assert.match(body, /kill \{pid\}.*with a port-isolation lease/s);
});

// Deliverable: Step 0's persisted-URL acceptance follows the same lease-first rule.
test("Step 0's persisted-URL acceptance is lease-aware and discards a foreign URL rather than trusting it", () => {
  const doc = read(DOC);
  const idx = doc.indexOf('### Step 0: Check Persisted Config');
  const step05Idx = doc.indexOf('### Step 0.5:');
  assert.ok(idx !== -1 && step05Idx !== -1 && idx < step05Idx);
  const body = doc.slice(idx, step05Idx);
  assert.match(body, /member of `LEASE_PORTS`/);
  assert.match(body, /discard it, and fall through to Step 1/);
});

// Consumer citation sweep (Technical Approach) — none of the five consumers
// restates the retired lsof/probe-upward mechanics; they cite Step 2.7 by
// reference only.
test('consumers cite Step 2.7 by reference only, never restating lsof/probe-upward mechanics', () => {
  const consumers = [
    'plugin/skills/visual-review/SKILL.md',
  ];
  for (const file of consumers) {
    const content = read(file);
    assert.doesNotMatch(content, /lsof -nP -iTCP|lsof -a -p .PID. -d cwd/, `${file} must not restate the lsof PID/cwd mechanics`);
  }
});

// #1937 — dispatch two-call hand-off: ownership, detach, and the fourth
// record-line field.
test('Ephemeral server start states the ownership rule (background task dies with the spawning turn) and the POSIX/Windows detach split', () => {
  const doc = read(DOC);
  const idx = doc.indexOf('#### Ephemeral server start');
  const whenStartingIdx = doc.indexOf('When starting a server');
  assert.ok(idx !== -1 && whenStartingIdx !== -1 && idx < whenStartingIdx);
  const body = doc.slice(idx, whenStartingIdx);

  assert.match(body, /\*\*Ownership\.\*\*/);
  assert.match(body, /belongs to the agent turn that spawned it/);
  assert.match(body, /\*\*POSIX:\*\*.*setsid/s);
  assert.match(body, /Record `detached: yes`/);
  assert.match(body, /\*\*Windows:\*\*.*Record `detached: no`/s);
});

test("Ephemeral server start's record line names a fourth `detached:{yes|no}` field", () => {
  const doc = read(DOC);
  const idx = doc.indexOf('#### Ephemeral server start');
  const outputIdx = doc.indexOf('### Output');
  assert.ok(idx !== -1 && outputIdx !== -1 && idx < outputIdx);
  const body = doc.slice(idx, outputIdx);
  assert.match(body, /`\{pid\} \{port\} \{worktree-root\} detached:\{yes\|no\}`/);
});

test("Step 4's record line is called the liveness handle, not a promise the server is up", () => {
  const doc = read(DOC);
  const idx = doc.indexOf('#### Ephemeral server start');
  const outputIdx = doc.indexOf('### Output');
  const body = doc.slice(idx, outputIdx);
  assert.match(body, /\*\*liveness handle\*\*/);
  assert.match(body, /not a promise that it is/);
});

test('the Cleanup section reads whatever ephemeral-server.txt currently names, not the value recorded at start time', () => {
  const doc = read(DOC);
  const idx = doc.indexOf('### Cleanup');
  assert.notEqual(idx, -1);
  const body = doc.slice(idx);
  assert.match(body, /liveness-handle rule/);
  assert.match(body, /not necessarily the value recorded at start time/);
});
