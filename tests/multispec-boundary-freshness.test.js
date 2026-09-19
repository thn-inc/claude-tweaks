// tests/multispec-boundary-freshness.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FLOW_DIR = path.join(__dirname, '..', 'plugin', 'skills', 'flow');
const FRESHNESS = path.join(FLOW_DIR, 'multispec-freshness.md');
const MULTI_SPEC = path.join(FLOW_DIR, 'multi-spec.md');
const CURATION = path.join(FLOW_DIR, 'multispec-batch-curation.md');

// Every backtick-delimited code region — inline spans and fences alike.
function codeRegions(text) {
  const fences = text.match(/```[\s\S]*?```/g) ?? [];
  const stripped = text.replace(/```[\s\S]*?```/g, '');
  const spans = stripped.match(/`[^`\n]+`/g) ?? [];
  return [...fences, ...spans];
}

test('multispec-freshness.md exists and cites the canonical fragments', () => {
  const text = fs.readFileSync(FRESHNESS, 'utf8');
  assert.match(text, /integration-branch\.md/, 'must cite the integration-branch ladder');
  assert.match(text, /_shared\/worktree-setup\.md/, 'must cite worktree-setup.md for merge mechanics');
  assert.match(text, /auto-mode-contract\.md/, 'must anchor the gate in the auto-mode contract');
});

test('multispec-freshness.md never hardcodes origin/main in a code region', () => {
  const text = fs.readFileSync(FRESHNESS, 'utf8');
  const offenders = codeRegions(text).filter((r) => r.includes('origin/main'));
  assert.deepStrictEqual(offenders, [], 'command text must use {integration-branch}, not a hardcoded origin/main');
});

test('multispec-freshness.md states the HARD-GATE auto-mode and keep-going contract', () => {
  const text = fs.readFileSync(FRESHNESS, 'utf8');
  assert.match(text, /HARD-GATE/);
  assert.match(text, /fires even in `auto` mode/);
  assert.match(text, /`MULTISPEC_KEEP_GOING` does not bypass/);
});

test('multispec-freshness.md states the fetch-failure skip rule and best-effort oracle', () => {
  const text = fs.readFileSync(FRESHNESS, 'utf8');
  assert.match(text, /skip this boundary's check entirely/i);
  assert.match(text, /best-effort/);
});

test('multi-spec.md Execution section cites multispec-freshness.md exactly once, spec 2 onward, before the scaffold step', () => {
  const text = fs.readFileSync(MULTI_SPEC, 'utf8');
  const start = text.indexOf('## Execution');
  assert.notStrictEqual(start, -1);
  const rest = text.slice(start);
  const nextH2 = rest.slice(2).search(/\n## [^#]/);
  const section = nextH2 === -1 ? rest : rest.slice(0, nextH2 + 2);
  const mentions = section.match(/multispec-freshness\.md/g) ?? [];
  assert.strictEqual(mentions.length, 1, `expected exactly one citation in Execution, got ${mentions.length}`);
  const citeAt = section.indexOf('multispec-freshness.md');
  const scaffoldAt = section.indexOf('Scaffold the per-spec subdirectory before exporting');
  assert.ok(scaffoldAt !== -1 && citeAt < scaffoldAt, 'boundary check must be ordered before the per-spec scaffold step');
  assert.match(section, /spec 2 onward/i);
});

test('multispec-batch-curation.md derives its batch diff base from git merge-base at both sites', () => {
  const text = fs.readFileSync(CURATION, 'utf8');
  const scopeLine = text.split('\n').find((l) => l.includes('**Scope**'));
  assert.ok(scopeLine, 'Scope bullet must exist');
  assert.match(scopeLine, /merge-base/, 'Scope bullet must derive from merge-base');
  const fence = (text.match(/```[\s\S]*?```/g) ?? []).find((f) => f.includes('wrap-up-engine.js'));
  assert.ok(fence, 'engine-call fence must exist');
  assert.match(fence, /--base "\$\(git merge-base /, '--base must come from git merge-base');
  assert.doesNotMatch(text, /yq '\.multispec\.baseSha'/, 'the baseSha yq read must be gone');
});

test('multispec-freshness.md states an autonomy:unattended default before the AskUserQuestion call', () => {
  const text = fs.readFileSync(FRESHNESS, 'utf8');
  const escalationStart = text.indexOf('## Escalation');
  assert.notStrictEqual(escalationStart, -1, 'Escalation section must exist');
  const askAt = text.indexOf('Call `AskUserQuestion`', escalationStart);
  assert.notStrictEqual(askAt, -1, 'AskUserQuestion call must exist in Escalation section');
  const unattendedAt = text.indexOf('**Unattended default.**', escalationStart);
  assert.notStrictEqual(unattendedAt, -1, 'Unattended default subsection must exist');
  assert.ok(unattendedAt < askAt, 'Unattended default subsection must precede the AskUserQuestion call');
});

test('multispec-freshness.md unattended default resolves the autonomy policy and gates on unattended only', () => {
  const text = fs.readFileSync(FRESHNESS, 'utf8');
  assert.match(text, /resolve-policy\.js"\s+--values autonomy/, 'must resolve the autonomy policy value');
  assert.match(text, /autonomy: unattended/, 'must name the unattended tier explicitly');
  assert.match(text, /`supervised`\/`trusted`.*fall through to `AskUserQuestion`/, 'must state supervised/trusted are unaffected');
});

test('multispec-freshness.md unattended default reuses the existing overlap sets, never a fresh computation', () => {
  const text = fs.readFileSync(FRESHNESS, 'utf8');
  const escalationStart = text.indexOf('## Escalation');
  const section = text.slice(escalationStart);
  assert.match(section, /incoming.*remaining-Key-Files/, 'must test incoming against remaining-Key-Files');
  assert.match(section, /never a fresh, independently-derived computation/, 'must disclaim a fresh computation');
});

test('multispec-freshness.md unattended default auto-applies option 1 and logs a distinct AUTO line on clean, non-overlapping merges', () => {
  const text = fs.readFileSync(FRESHNESS, 'utf8');
  assert.match(text, /auto-selected option 1 under autonomy:unattended/, 'must log a distinct AUTO entry naming the auto-select');
  assert.match(text, /no `AskUserQuestion` for this boundary/, 'must state no AskUserQuestion fires on the auto-select path');
});

test('multispec-freshness.md unattended default still stops for a remaining-spec overlap, a merge conflict, or a broken premise', () => {
  const text = fs.readFileSync(FRESHNESS, 'utf8');
  const escalationStart = text.indexOf('## Escalation');
  const section = text.slice(escalationStart);
  assert.match(section, /overlap reaches a remaining spec's `### Key Files`/, 'must still escalate on remaining-spec overlap');
  assert.match(section, /or the merge conflicts/, 'must still escalate on merge conflict');
  assert.match(section, /git merge --abort/, 'a conflicting auto-attempt must abort to restore the clean tree');
  assert.match(section, /[Ss]omething broke.*fall through to `AskUserQuestion`/, 'a broken premise found during auto-revalidation must still escalate');
});
