'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #2727: an invocation whose every write is a forge-API call (backlog refine,
// a github-issues capture, tidy's scan batch) was being pushed into a full
// worktree under worktree-always — create, catch-up merge, then a hand-proved
// ancestry check before teardown — for zero repository-file writes. The
// worktree-always PreToolUse gate never intercepted gh; only the prose did.

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const SETUP = readText(path.join(SKILLS, '_shared', 'worktree-setup.md'));
const ANCHOR = '**Forge-API-only invocations need no worktree.**';
const CITE = 'Forge-API-only invocations need no worktree';

function section(heading) {
  const start = SETUP.indexOf(heading);
  assert.notStrictEqual(start, -1, `${heading} heading missing`);
  const end = SETUP.indexOf('\n## ', start + 1);
  return SETUP.slice(start, end === -1 ? undefined : end);
}

function paragraph() {
  const s = section('## Adopt-or-create');
  const at = s.indexOf(ANCHOR);
  assert.notStrictEqual(at, -1, 'carve-out paragraph missing from Adopt-or-create');
  const end = s.indexOf('\n\n', at);
  return s.slice(at, end === -1 ? undefined : end);
}

test('worktree-setup.md: carve-out sits in Adopt-or-create, before the Already-isolated branch', () => {
  const s = section('## Adopt-or-create');
  const anchor = s.indexOf(ANCHOR);
  const isolated = s.indexOf('**Already isolated:**');
  assert.ok(anchor !== -1 && isolated !== -1, 'anchor or Already-isolated branch missing');
  assert.ok(anchor < isolated, `expected carve-out(${anchor}) before Already isolated(${isolated})`);
});

test('worktree-setup.md: carve-out names forge-API writes, cites the gate block, and ends at the first working-tree write', () => {
  const p = paragraph();
  assert.match(p, /forge-API call/, 'must name forge-API calls as the qualifying write');
  assert.match(p, /policy-schema-coverage\.md/, 'must cite the gate-coverage block for exemptions');
  assert.match(p, /first working-tree write/, 'carve-out must end at the first working-tree write');
  assert.match(p, /at that point/, 'Adopt-or-create runs at that point, not never');
  assert.match(p, /own exceptions/, 'each qualifying skill states its own exceptions');
});

test('worktree-setup.md: carve-out does not restate the gate coverage list', () => {
  const p = paragraph();
  assert.doesNotMatch(p, /NotebookEdit|`truncate`|`dd`|`update-ref`/, 'cite policy-schema-coverage.md, never re-list its tools (IL-93)');
});

test('worktree-setup.md: Post-creation catch-up cross-references the carve-out before the guard note', () => {
  const s = section('## Post-creation catch-up');
  const xref = s.indexOf('forge-API-only carve-out');
  const guard = s.indexOf("harness's Bash-shape guard");
  assert.ok(xref !== -1, 'catch-up must name the forge-API-only carve-out');
  assert.ok(xref < guard, `expected cross-reference(${xref}) before guard note(${guard})`);
  assert.match(s.slice(Math.max(0, xref - 200), xref + 200), /never reaches this section/);
});

function skill(...parts) {
  return readText(path.join(SKILLS, ...parts));
}

function note(text, label) {
  const at = text.indexOf(CITE);
  assert.notStrictEqual(at, -1, `${label} must cite "${CITE}"`);
  const start = text.lastIndexOf('\n\n', at);
  const end = text.indexOf('\n\n', at);
  return text.slice(start === -1 ? 0 : start, end === -1 ? undefined : end);
}

test('backlog refine-headless.md: carve-out scoped to the grant chain, labeling lanes keep the unsynced and local-files exceptions', () => {
  const n = note(skill('backlog', 'refine-headless.md'), 'refine-headless.md');
  assert.match(n, /worktree-setup\.md/);
  assert.match(n, /local-files/);
  assert.match(n, /unsynced/);
});

test('backlog refine-mode.md: names the unsynced-record and local-files exceptions', () => {
  const n = note(skill('backlog', 'refine-mode.md'), 'refine-mode.md');
  assert.match(n, /worktree-setup\.md/);
  assert.match(n, /unsynced/);
  assert.match(n, /local-files/);
  assert.match(n, /writeRecord/);
});

test('capture SKILL.md: names the gh-failure fallback and brainstorm route exceptions', () => {
  const n = note(skill('capture', 'SKILL.md'), 'capture/SKILL.md');
  assert.match(n, /worktree-setup\.md/);
  assert.match(n, /fallback/);
  assert.match(n, /brainstorm/);
  assert.match(n, /local-files/);
});

test('tidy scan-execution.md: scan batch is read-only; the only worktree is Step 7.5', () => {
  const n = note(skill('tidy', 'scan-execution.md'), 'tidy/scan-execution.md');
  assert.match(n, /worktree-setup\.md/);
  assert.match(n, /Step 7\.5/);
  assert.match(n, /only read/);
});

function assertStep75Gate(text) {
  const n = note(text, 'tidy/step-7-5-worktree-always.md');
  assert.match(n, /worktree-setup\.md/, 'must cite the canonical carve-out file');
  assert.match(n, /working-tree write/, 'must name the working-tree-write condition');
  assert.match(n, /record-file/, 'record-file edits count as working-tree writes');
  assert.match(n, /docs\/REGISTRY\.md/, 'REGISTRY.md Fix-now edits count as working-tree writes');
  assert.match(n, /Status: specified/, 'a design-doc stamp counts even under github-issues');
  assert.match(n, /provision no worktree/, 'all-forge set provisions nothing');
  assert.match(n, /skip the commit/, 'all-forge set makes no commit and opens no PR');
  assert.match(n, /local-files/, 'local-files provisioning unchanged');
  assert.match(text, /resolves `true` and the approved Step 7 set holds at least one working-tree write/,
    'the provisioning sentence itself must carry the condition');
}

test('AC1.1 AC2.1 AC3.1: tidy step-7-5 gates provisioning on a working-tree write and cites the carve-out', () => {
  assertStep75Gate(skill('tidy', 'step-7-5-worktree-always.md'));
});

test('go-red: dropping the provisioning condition fails the Step 7.5 gate assertions', () => {
  const original = skill('tidy', 'step-7-5-worktree-always.md');
  const text = original.replace(' and the approved Step 7 set holds at least one working-tree write', '');
  assert.notStrictEqual(text, original, 'mutation must apply');
  assert.throws(() => assertStep75Gate(text), { message: /provisioning sentence itself must carry the condition/ });
});

test('go-red: dropping the carve-out citation fails the Step 7.5 gate assertions', () => {
  const original = skill('tidy', 'step-7-5-worktree-always.md');
  const text = original.replace('_shared/worktree-setup.md', '_shared/elsewhere.md');
  assert.notStrictEqual(text, original, 'mutation must apply');
  assert.throws(() => assertStep75Gate(text), { message: /must cite the canonical carve-out file/ });
});
