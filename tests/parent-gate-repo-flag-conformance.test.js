// tests/parent-gate-repo-flag-conformance.test.js
//
// Conformance for #4824: every `gh issue` line in the Parent-Gate Procedure passes
// `--repo "{parent-repo}"` (the verdict's `repo`), and an empty value stops before any write. The
// prose is the contract (an agent runs these fences), so the live file is read; each assertion is
// a function the test also runs on a mutated copy of the live text to prove it can go red.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readText } = require('./helpers/read-skill');
const { escapeRegExp } = require('../plugin/bin/lib/shared-primitives');

const GATE = path.join(__dirname, '..', 'plugin', 'skills', 'wrap-up', 'verification-brief-parent-gate.md');
const live = readText(GATE);

const REPO_FLAG = '--repo "{parent-repo}"';
const STOP_RULE =
  "When `repo` is `null` or empty, run none of the `gh` lines below and report the entry as a failing `gh` call: a `--repo \"\"` sends the write to `gh`'s default repository.";
const RUN_CLI = '## Run the gate CLI';
const MSG_PRESENT = 'the stop rule appears exactly once in the parent gate';
const MSG_PLACED = 'the stop rule sits in the Run the gate CLI section';
const MSG_ORDER = 'the stop rule precedes the first fenced gh issue line';
// The sentence that scopes the rule to the gh path, so the null cases above it (local-files, the MCP path) are not read as failures.
const SCOPE = 'The rule below binds the `gh` path only.';
const MSG_SCOPE_PRESENT = 'the scope sentence appears exactly once in the parent gate';
const MSG_SCOPE_ORDER = 'the scope sentence comes before the stop rule';
const MSG_GREP = 'every line the AC grep matches carries --repo';

const collapse = (s) => s.replace(/\s+/g, ' ');
const occurrences = (text, phrase) => text.split(phrase).length - 1;
// A phrase as it may sit in the raw file: hard-wrapped, so any run of whitespace stands for a space.
const wrapTolerant = (phrase) => new RegExp(escapeRegExp(phrase).replace(/ /g, '\\s+'));
const RULE_RE = wrapTolerant(STOP_RULE);
const SCOPE_RE = wrapTolerant(SCOPE);

// Every fenced `gh issue <verb>` line of `text`, with its 0-based line number.
function fencedGhIssueLines(text) {
  const out = [];
  let fenced = false;
  text.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return; }
    if (fenced && /\bgh issue [a-z]+\b/.test(line)) out.push({ i, line });
  });
  return out;
}

// The fenced `gh issue` lines that do not pass the flag straight after $PARENT_NUM.
const flaglessGhLines = (text) => fencedGhIssueLines(text).filter(({ line }) => !line.includes(`$PARENT_NUM ${REPO_FLAG}`)).map(({ line }) => line);

// Replace one line (by its number) of `text` with fn(line).
function mapLine(text, n, fn) {
  const lines = text.split('\n');
  lines[n] = fn(lines[n]);
  return lines.join('\n');
}

// The text from RUN_CLI up to the next `## ` heading.
function runSection(text) {
  const start = text.indexOf(RUN_CLI);
  assert.ok(start !== -1, `heading not found: ${RUN_CLI}`);
  const end = text.indexOf('\n## ', start + RUN_CLI.length);
  return text.slice(start, end === -1 ? undefined : end);
}

// The stop rule is present once, sits in the Run the gate CLI section, and comes before the first gh issue fence.
function assertStopRuleBeforeGhLines(text) {
  const flat = collapse(text);
  assert.ok(occurrences(flat, STOP_RULE) === 1, MSG_PRESENT);
  assert.ok(occurrences(flat, SCOPE) === 1, MSG_SCOPE_PRESENT);
  assert.ok(flat.includes(`${SCOPE} ${STOP_RULE}`), MSG_SCOPE_ORDER); // adjacent: the sentence introduces the rule, not merely precedes it
  assert.ok(collapse(runSection(text)).includes(STOP_RULE), MSG_PLACED);
  const firstGh = text.split('\n').slice(0, fencedGhIssueLines(text)[0].i).join('\n').length; // raw index of that line's start (less the newline)
  const rule = RULE_RE.exec(text);
  assert.ok(text.indexOf(RUN_CLI) < firstGh && rule && rule.index < firstGh, MSG_ORDER);
}

const AC_GREP = /gh issue (comment|close)/;

// The lines `grep -nE "gh issue (comment|close)"` lists must all carry --repo.
function assertGrepHitsCarryRepo(text) {
  const hits = text.split('\n').filter((l) => AC_GREP.test(l));
  assert.ok(hits.length >= 5, 'the AC grep still matches at least 5 lines');
  assert.ok(hits.every((l) => l.includes('--repo')), MSG_GREP);
}

test('AC1.1: every line the AC grep matches in the parent gate contains --repo', () => {
  assertGrepHitsCarryRepo(live);
});

test('AC1.1 go-red: removing --repo from any grep hit is caught', () => {
  const hitLines = live.split('\n').flatMap((l, i) => (AC_GREP.test(l) ? [i] : []));
  assert.ok(hitLines.length >= 5, 'five or more grep hits to mutate');
  for (const n of hitLines) {
    const mutated = mapLine(live, n, (l) => l.split('--repo').join(''));
    assert.notEqual(mutated, live);
    assert.throws(() => assertGrepHitsCarryRepo(mutated), { message: MSG_GREP }, `line ${n + 1}`);
  }
});

test('AC2.1: every fenced gh issue line in the parent gate carries --repo "{parent-repo}"', () => {
  assert.deepEqual(flaglessGhLines(live), []);
  assert.ok(fencedGhIssueLines(live).length >= 6, 'six fenced gh issue lines (three close fences, three apply lines) — an empty scan cannot pass');
});

test('AC2.1 go-red: removing the flag from one fence is caught', () => {
  for (const { i, line } of fencedGhIssueLines(live)) {
    const mutated = mapLine(live, i, (l) => l.replace(` ${REPO_FLAG}`, ''));
    assert.notEqual(mutated, live);
    assert.deepEqual(flaglessGhLines(mutated), [line.replace(` ${REPO_FLAG}`, '')], `line ${i + 1}`);
  }
});

test('empty-value go-red: a shell-variable --repo is caught', () => {
  for (const { i, line } of fencedGhIssueLines(live)) {
    const mutated = mapLine(live, i, (l) => l.replace(REPO_FLAG, '--repo "$PARENT_REPO"'));
    assert.notEqual(mutated, live);
    assert.deepEqual(flaglessGhLines(mutated), [line.replace(REPO_FLAG, '--repo "$PARENT_REPO"')], `line ${i + 1}: nothing assigns PARENT_REPO, so it expands empty`);
  }
});

test('empty-value: the stop rule precedes every gh line', () => {
  assertStopRuleBeforeGhLines(live);
  // go-red: absent from a copy.
  const absent = live.replace(RULE_RE, '');
  assert.notEqual(absent, live);
  assert.throws(() => assertStopRuleBeforeGhLines(absent), { message: MSG_PRESENT }, 'go-red: deleting the rule fails presence');
  // go-red: stated twice.
  const twice = live.replace(RULE_RE, (m) => `${m}\n\n${m}`);
  assert.notEqual(twice, live);
  assert.throws(() => assertStopRuleBeforeGhLines(twice), { message: MSG_PRESENT }, 'go-red: a second copy fails "exactly once"');
  // go-red: the scope sentence deleted, and moved after the rule.
  const unscoped = live.replace(SCOPE_RE, '');
  assert.notEqual(unscoped, live);
  assert.throws(() => assertStopRuleBeforeGhLines(unscoped), { message: MSG_SCOPE_PRESENT }, 'go-red: deleting the scope sentence fails presence');
  const scopeAfter = unscoped.replace(RULE_RE, (m) => `${m} ${SCOPE}`);
  assert.notEqual(scopeAfter, unscoped);
  assert.throws(() => assertStopRuleBeforeGhLines(scopeAfter), { message: MSG_SCOPE_ORDER }, 'go-red: the scope sentence after the rule fails order');
  // go-red: the scope sentence moved to the file's top still precedes the rule, but no longer introduces it.
  const scopeAtTop = `${SCOPE}\n\n${unscoped}`;
  assert.notEqual(scopeAtTop, live);
  const scopeAtTopFlat = collapse(scopeAtTop);
  assert.ok(scopeAtTopFlat.indexOf(SCOPE) < scopeAtTopFlat.indexOf(STOP_RULE), 'the mutated copy keeps the scope sentence before the rule, so an order-only check would pass it');
  assert.throws(() => assertStopRuleBeforeGhLines(scopeAtTop), { message: MSG_SCOPE_ORDER }, 'go-red: a scope sentence away from the rule fails adjacency');
  // go-red: moved into the Close section, below its first fence.
  const closeAnchor = 'Close with `--reason completed` only when at least one sub-issue closed `COMPLETED`';
  assert.ok(live.includes(closeAnchor), 'anchor for the placement control');
  const moved = absent.replace(SCOPE_RE, '').replace(closeAnchor, `${SCOPE} ${STOP_RULE}\n\n${closeAnchor}`); // the scope sentence travels with the rule, so only placement is under test
  assert.notEqual(moved, absent);
  assert.throws(() => assertStopRuleBeforeGhLines(moved), { message: MSG_PLACED }, 'go-red: the rule below the first fence fails placement');
  // go-red: the whole Run the gate CLI section (rule included) moved below the Close fences.
  const runAt = live.indexOf(RUN_CLI);
  const evalAt = live.indexOf('## Evaluate the gate');
  assert.ok(runAt !== -1 && evalAt > runAt, 'sections found for the order control');
  const without = live.slice(0, runAt) + live.slice(evalAt);
  const composeAt = without.indexOf('## Compose the parent brief');
  const reordered = without.slice(0, composeAt) + live.slice(runAt, evalAt) + without.slice(composeAt);
  assert.notEqual(reordered, live);
  assert.throws(() => assertStopRuleBeforeGhLines(reordered), { message: MSG_ORDER }, 'go-red: the section below the first fence fails order');
});

test('the scanner ignores prose and toggles on fences', () => {
  const text = ['run gh issue close 1 in prose', '```bash', 'gh issue close 2', 'gh issue close $PARENT_NUM --repo "{parent-repo}" --reason completed', '```', 'gh issue close 3'].join('\n');
  assert.deepEqual(flaglessGhLines(text), ['gh issue close 2']);
});

test('wrapped-span guard: no prose line ends mid gh issue pair', () => {
  const wrapped = (text) => {
    let fenced = false;
    return text.split('\n').filter((l) => {
      if (/^\s*```/.test(l)) { fenced = !fenced; return false; }
      return !fenced && /\bgh( issue)?\s*$/.test(l);
    });
  };
  assert.deepEqual(wrapped(live), []);
  assert.deepEqual(wrapped('see gh\nissue close\nsee gh issue\ncomment\n```\ngh\n```'), ['see gh', 'see gh issue']);
});

test('the Apply inline read carries the flag too', () => {
  const span = '`gh issue view $PARENT_NUM --repo "{parent-repo}" --json comments`';
  assert.ok(live.split('\n').some((l) => l.includes(span)), 'the comment read passes --repo on one line');
});

// The verdict's repo bullet, the `{parent-repo}` it fills, and the MCP-path note.
const BINDING = 'the `{parent-repo}` every `gh` line below passes as `--repo`, filled in from the verdict';
const MCP_CLAUSE = "the `gh`-absent path's MCP calls take no `{parent-repo}`";
function assertVerdictRepo(text) {
  const cli = collapse(runSection(text));
  assert.ok(cli.includes('- `repo` —'), 'the verdict list has a repo bullet');
  assert.ok(cli.includes(BINDING), 'the repo bullet binds {parent-repo} to the --repo of every gh line');
  assert.ok(cli.includes(MCP_CLAUSE), 'the repo bullet says the MCP path takes no {parent-repo}');
}

test('the verdict list names repo as {parent-repo}', () => {
  assertVerdictRepo(live);
  const cuts = [
    ['- `repo` —', 'the verdict list has a repo bullet', (t) => t.split('- `repo` —').join('- repo —')],
    [BINDING, 'the repo bullet binds {parent-repo} to the --repo of every gh line', (t) => t.replace(wrapTolerant(BINDING), '')],
    [MCP_CLAUSE, 'the repo bullet says the MCP path takes no {parent-repo}', (t) => t.replace(wrapTolerant(MCP_CLAUSE), '')],
  ];
  for (const [lit, message, mutate] of cuts) {
    const mutated = mutate(live);
    assert.notEqual(mutated, live, `the control for ${lit} changed something`);
    assert.throws(() => assertVerdictRepo(mutated), { message }, `go-red: ${lit}`);
  }
});

// The Apply partial-state paragraph: the bootstrap runs against gh's default repository.
function assertPartialStateNote(text) {
  const start = text.indexOf('**Partial-state note.**');
  assert.ok(start !== -1, 'Partial-state note paragraph found');
  const end = text.indexOf('\n\n', start);
  const note = collapse(text.slice(start, end === -1 ? undefined : end));
  assert.ok(note.includes("against `gh`'s default repository"), 'the note names the gh-default bootstrap');
  assert.ok(!note.includes('specifically impossible'), 'the note no longer calls a missing-label failure impossible');
}

test('the Apply partial-state note names the gh-default bootstrap', () => {
  assertPartialStateNote(live);
  const noDefault = live.replace(/against\s+`gh`'s\s+default\s+repository/, 'against the repository');
  assert.notEqual(noDefault, live);
  assert.throws(() => assertPartialStateNote(noDefault), { message: 'the note names the gh-default bootstrap' }, 'go-red: dropping the gh-default clause');
  const impossible = live.replace('**Partial-state note.**', '**Partial-state note.** A missing-label failure is specifically impossible.');
  assert.notEqual(impossible, live);
  assert.throws(() => assertPartialStateNote(impossible), { message: 'the note no longer calls a missing-label failure impossible' }, 'go-red: the old claim returning');
});
