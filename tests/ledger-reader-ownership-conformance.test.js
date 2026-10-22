'use strict';
// tests/ledger-reader-ownership-conformance.test.js — pins #3687, re-pointed by #3897: ledger
// readers outside wrap-up resolve THIS run's ledger through `hooks.js resolve-ledger` (the
// read-side twin of `delete-ledger`, over `resolveLedgerPath`), never a bare
// `docs/plans/*-ledger.md` glob and never by restating the old probe's `value.files` /
// `unattributedFiles` handling. The verb decides ownership, so the sentence-scan this suite
// once used to approximate it is gone. Live-corpus read (skill-prose-conformance-tests: a
// convention this project enforces); go-red controls run the same assertion function against
// frozen pre-change text.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const flat = (s) => s.replace(/\s+/g, ' ');
const read = (rel) => flat(readText(path.join(SKILLS, rel)));

const PROBE_RESTATEMENT_RE = /value\.files|unattributedFiles|--print ledger/;

function assertRuleNamesVerb(text) {
  assert.ok(text.includes('hooks.js" resolve-ledger --run "{run-dir}"'), 'rule runs hooks.js resolve-ledger');
  for (const report of ['found', 'none', 'ambiguous', 'unattributable']) {
    assert.ok(text.includes('`' + report + '`'), `rule names the \`${report}\` report`);
  }
  assert.match(text, /`other-run:` lines are other runs' ledgers — never read, flipped, or deleted as this run's/);
  assert.match(text, /\*\*Fallback, for a reader only:\*\*/);
  assert.match(text, /check `\{run-dir\}\/ledger\.md` first — if it exists, that is the ledger and the glob is not consulted/);
  assert.match(text, /a caller that flips or deletes ledger rows or files never takes this fallback/);
  assert.doesNotMatch(text, PROBE_RESTATEMENT_RE, 'rule no longer restates the old probe');
}

function assertNoProbeRestatement(files) {
  const offenders = Object.keys(files).filter((rel) => PROBE_RESTATEMENT_RE.test(files[rel]));
  assert.deepStrictEqual(offenders, [], `restates the probe's value.files / unattributedFiles handling: ${offenders.join(', ')}`);
}

function walkMarkdown(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkMarkdown(dir, child));
    else if (entry.name.endsWith('.md')) out.push(child);
  }
  return out;
}

test('AC2.1: ledger-format.md resolves this run\'s ledger through hooks.js resolve-ledger', () => {
  assertRuleNamesVerb(read('_shared/ledger-format.md'));
});

test('go-red: the #3687 probe-based rule fails assertRuleNamesVerb', () => {
  const PRE = flat('**Resolution rule for a caller reading "the active ledger for this run" (#3687):** when a run dir resolves (`$PIPELINE_RUN_DIR` or the most-recent-matching run), run the ownership-aware ledger probe — `node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-pack.js" --run "{run-dir}" --print ledger --json "{run-dir}/wrap-up-pack-ledger.json"` (its own `--json` file, so the `wrap-up-pack.json` another step reads keeps its other probes) — `{run-dir}` is the run dir just resolved, never a bare `$PIPELINE_RUN_DIR` that an inferred run leaves unset — and read its `value.files`.');
  assert.throws(() => assertRuleNamesVerb(PRE), /rule runs hooks\.js resolve-ledger/);
});

test('AC3.1: no ledger reader in plugin/skills outside wrap-up/ restates the probe\'s value.files / unattributedFiles handling', () => {
  const files = {};
  for (const rel of walkMarkdown(SKILLS)) {
    if (rel.startsWith('wrap-up/')) continue;
    files[rel] = flat(readText(path.join(SKILLS, rel)));
  }
  assert.ok(Object.keys(files).length > 0, 'scan found skill files');
  assert.ok('_shared/ledger-format.md' in files && 'ledger/SKILL.md' in files, 'scan reaches the rule and its reader');
  assertNoProbeRestatement(files);
});

test('go-red: a reader restating the probe\'s unattributedFiles handling fails assertNoProbeRestatement', () => {
  assert.throws(
    () => assertNoProbeRestatement({ 'ledger/SKILL.md': flat("then list every other ledger file — the probe's `value.unattributedFiles`, or on the rule's fallback the remaining matches") }),
    /ledger\/SKILL\.md/,
  );
});

const RULE_CITE = "`_shared/ledger-format.md`'s resolution rule";
const READERS = ['ledger/SKILL.md', 'review/code-mode-steps.md', 'wrap-up/auto-merge-short-circuit.md'];

test('AC3.2: every reader cites the resolution rule', () => {
  for (const rel of READERS) {
    assert.ok(read(rel).includes(RULE_CITE), `${rel} cites ${RULE_CITE}`);
  }
});

test('review\'s QA Ledger Check names the verb', () => {
  assert.match(read('review/code-mode-steps.md'), /hooks\.js resolve-ledger/);
});

test('ledger listing marks this run\'s ledger first and each other-run ledger as another run\'s', () => {
  assert.match(read('ledger/SKILL.md'), /list its `this-run:` ledger\(s\) first, marked as this run's, then each `other-run:` ledger, marked as another run's/);
});

test('ledger resolve never defaults to another run\'s ledger when a run dir resolves', () => {
  const text = read('ledger/SKILL.md');
  assert.match(text, /on `none`, report `No ledger found for this run` rather than resolving another run's/);
});

test('ledger resolve with a run dir stops on unattributable or no report line — the gate flips rows', () => {
  assert.match(read('ledger/SKILL.md'), /on `unattributable` or no report line, report the verb's output and stop: the gate flips rows, so it never takes the rule's fallback/);
});

test('auto-merge short-circuit deletes through delete-ledger (the rule\'s writer branch), never a glob', () => {
  const text = read('wrap-up/auto-merge-short-circuit.md');
  assert.ok(text.includes('hooks.js" delete-ledger --run "$RUN_DIR"'));
  assert.match(text, /Handle its printed report exactly as `cleanup-procedures\.md`'s Item 2 paragraph does/);
  assert.match(text, /ownership-aware, never a glob, failing closed on a ledger it cannot attribute to this run/);
});

test('auto-merge short-circuit commits only a tracked deletion and leaves the ledger alone on any other report', () => {
  const text = read('wrap-up/auto-merge-short-circuit.md');
  assert.match(text, /ls-files --error-unmatch -- "\$LEDGER_FILE"/);
  assert.match(text, /Only a tracked `docs\/plans\/` path gets the deletion staged and committed/);
  assert.match(text, /Every other report except `not found` leaves the ledger on disk: commit nothing and log one `SKIP` line/);
});

module.exports = { read };
