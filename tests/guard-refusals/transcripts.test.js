'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { scanStore } = require('../../tools/guard-refusals/transcripts');
const { copyStore, WINDOW, STORE_MTIME, FIXTURE_STORE } = require('../helpers/guard-refusals-store');

// #4028: the classifier's fixtures are real transcript lines (tests/fixtures/guard-refusals/store/README.md
// names each source file and line), so every shape here is one the live store produced.

const FORK_ID = 'toolu_01XkSC9UVprFoENL2rvy1y3K'; // a refusal replayed into a fork's transcript
const ECHO_ID = 'toolu_01JM1m9AVMDyXEHcrSARNzJJ'; // a refusal echoed by api-request-blob entries
const AGENT_ID = 'toolu_01WwVPLzbmUMbBV7gXPeLS5P'; // a "This agent is isolated" refusal
const THERE_ID = 'toolu_01Ckr3XmdLaFcEhvWuwfd2KW'; // a "Refusing to run it there" refusal
const SUB_ID = 'toolu_0176G197jqpvZGg3mLLburTV'; // a subagent refusal whose parent session names the run
const QUOTE_FILE = '0f9d7830-4cc7-451b-a9d3-e5114a9d62a0.jsonl'; // a successful result that quotes the refusal text

function occurrences(file, needle) {
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.includes(needle)).length;
}

function fixtureFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
  }(dir));
  return out.sort();
}

const enoent = (p) => Object.assign(new Error(`ENOENT: no such file or directory, ${p}`), { code: 'ENOENT' });

test('scanStore counts a refusal once across a fork replay and an api-request-blob echo', () => {
  // The fixture must really hold the duplicates, or the assertion below proves nothing.
  const files = fixtureFiles(FIXTURE_STORE);
  const forkResults = files.reduce((n, f) => n + occurrences(f, `"tool_use_id":"${FORK_ID}"`), 0);
  const echoResults = files.reduce((n, f) => n + occurrences(f, `"tool_use_id":"${ECHO_ID}"`), 0);
  assert.ok(forkResults >= 2, `fork replay fixture holds ${forkResults} results for ${FORK_ID}`);
  assert.ok(echoResults >= 2,`echo fixture holds ${echoResults} results for ${ECHO_ID}`);

  const dir = copyStore();
  const scan = scanStore({ projectsDir: dir, ...WINDOW });
  assert.equal(scan.refusals.filter((r) => r.toolUseId === FORK_ID).length, 1);
  assert.equal(scan.refusals.filter((r) => r.toolUseId === ECHO_ID).length, 1);
  const ids = scan.refusals.map((r) => r.toolUseId);
  assert.equal(new Set(ids).size, ids.length, 'every refusal is unique by toolUseId');
  assert.equal(scan.refusals.length, 8);
  // Bash and Write tool_use ids, once each: the echo repeats the Write and the Bash call, the fork the Bash call.
  assert.equal(scan.calls, 12);
});

test('scanStore counts This agent and This session refusals, and the Refusing to run there variant', () => {
  const dir = copyStore();
  const scan = scanStore({ projectsDir: dir, ...WINDOW });
  const byId = Object.fromEntries(scan.refusals.map((r) => [r.toolUseId, r]));
  const sourceOf = (id) => fs.readFileSync(byId[id].file, 'utf8');
  assert.match(sourceOf(AGENT_ID), /This agent is isolated in the worktree/);
  assert.match(sourceOf(ECHO_ID), /This session is isolated in the worktree/);
  assert.match(sourceOf(THERE_ID), /Refusing to run it there/);
  assert.ok(byId[AGENT_ID] && byId[ECHO_ID] && byId[THERE_ID], 'all three wordings are refusals');
  assert.equal(byId[AGENT_ID].tool, 'Bash');
  assert.match(byId[AGENT_ID].command, /^cd "\/Users\//, 'the refusal carries the refused command');
  assert.match(byId[THERE_ID].refusalText, /^ is isolated in the worktree /);
});

test('scanStore treats a vanished file (ENOENT) and a truncated JSON line as unreadable, never throws', () => {
  const dir = copyStore();
  // The truncated line alone: one unparseable line, nothing else lost.
  const whole = scanStore({ projectsDir: dir, ...WINDOW });
  assert.equal(whole.unreadable, 1);
  assert.equal(whole.files, 11);

  // A store that changes mid-walk: one file vanishes between the listing and its stat, another between
  // the stat and its open.
  const statGone = 'agent-ab1ce6ebd797a6f56.jsonl';
  const openGone = 'agent-a05018134f5ee897f.jsonl';
  const flaky = {
    ...fs,
    statSync: (p, ...rest) => {
      if (String(p).endsWith(statGone)) throw enoent(p);
      return fs.statSync(p, ...rest);
    },
    openSync: (p, ...rest) => {
      if (String(p).endsWith(openGone)) throw enoent(p);
      return fs.openSync(p, ...rest);
    },
  };
  let scan;
  assert.doesNotThrow(() => { scan = scanStore({ projectsDir: dir, ...WINDOW, fs: flaky }); });
  assert.equal(scan.unreadable, 3, 'truncated line + stat ENOENT + open ENOENT');
  assert.equal(scan.files, 10, 'the file that vanished before its stat is not a scanned file');
  const ids = scan.refusals.map((r) => r.toolUseId);
  assert.ok(!ids.includes(AGENT_ID) && !ids.includes(THERE_ID), 'refusals in lost files are not invented');
  assert.ok(ids.includes(ECHO_ID) && ids.includes(FORK_ID), 'the rest of the store is still scanned');

  // A project directory that cannot be listed counts, it does not abort the walk.
  const noList = { ...fs, readdirSync: (p, ...rest) => {
    if (String(p).endsWith('-Users-me-adhoc')) throw enoent(p);
    return fs.readdirSync(p, ...rest);
  } };
  const partial = scanStore({ projectsDir: dir, ...WINDOW, fs: noList });
  assert.equal(partial.unreadable, 2, 'truncated line + unlistable project directory');
  assert.equal(partial.refusals.length, 7);
});

test('scanStore throws when projectsDir itself cannot be listed', () => {
  assert.throws(() => scanStore({ projectsDir: path.join(copyStore(), 'nope'), ...WINDOW }), /ENOENT/);
});

test('scanStore attributes a refusal to the nearest preceding run id in its file', () => {
  const dir = copyStore();
  const scan = scanStore({ projectsDir: dir, ...WINDOW });
  const runOf = Object.fromEntries(scan.refusals.map((r) => [r.toolUseId, r.runId]));
  assert.equal(runOf[ECHO_ID], '2026-10-24T110909-spec-4039');
  assert.equal(runOf[FORK_ID], '2026-10-16T194718-record-2970');
  // One file, two refusals, two runs: each takes the run named before it, not the file's first.
  assert.equal(runOf.toolu_01VKBRmA6qouLJf1MV2XJgsH, '2026-10-19T185709-record-3498');
  assert.equal(runOf.toolu_01PWhnRZ15MT8L7KxhqnshBf, '2026-10-19T200655-record-3350');
  // No run id named earlier in the file.
  assert.equal(runOf[AGENT_ID], null);
  assert.equal(runOf[THERE_ID], null);
});

test('scanStore keeps a file only when since <= mtime < until, and filters projects by --match', () => {
  const dir = copyStore();
  assert.equal(scanStore({ projectsDir: dir, since: STORE_MTIME, until: STORE_MTIME + 1 }).files, 11, 'since is inclusive');
  assert.equal(scanStore({ projectsDir: dir, since: STORE_MTIME - 1, until: STORE_MTIME }).files, 0, 'until is exclusive');
  assert.equal(scanStore({ projectsDir: dir, since: 0, until: STORE_MTIME - 1 }).files, 0);
  const adhoc = scanStore({ projectsDir: dir, ...WINDOW, match: 'adhoc' });
  assert.equal(adhoc.files, 1);
  assert.deepEqual(adhoc.refusals.map((r) => r.toolUseId), [AGENT_ID]);
});

test('scanStore counts only Bash and Write calls, and only refusals whose call is one of them', () => {
  const dir = copyStore();
  const file = fixtureFiles(dir).find((f) => f.endsWith('agent-ab1ce6ebd797a6f56.jsonl'));
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  for (const entry of lines) for (const b of entry.message.content) if (b.type === 'tool_use') b.name = 'Read';
  fs.writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  fs.utimesSync(file, STORE_MTIME / 1000, STORE_MTIME / 1000);
  const scan = scanStore({ projectsDir: dir, ...WINDOW });
  assert.equal(scan.calls, 11);
  assert.ok(!scan.refusals.some((r) => r.toolUseId === AGENT_ID));
  assert.equal(scan.refusals.length, 7);
});

test('scanStore attributes a subagent refusal through its parent session, by the parent run in force at dispatch', () => {
  const dir = copyStore();
  const scan = scanStore({ projectsDir: dir, ...WINDOW });
  const sub = scan.refusals.find((r) => r.toolUseId === SUB_ID);
  assert.match(sub.file, /closeout-session[\\/].*subagents[\\/]agent-ab3414151093704cd\.jsonl$/);
  // The parent named record-3431 until the subagent's first entry (2026-10-19T19:14:19Z) and
  // record-3457 only much later: the run in force at dispatch wins over the parent's last run.
  assert.equal(sub.runId, '2026-10-19T185805-record-3431');
  assert.ok(scan.referencedRuns.includes('2026-10-19T185533-record-3457'), 'the parent\'s later run is referenced');
  const parentLines = fs.readFileSync(path.join(path.dirname(path.dirname(sub.file)), '..', 'a45494c1-ee1b-457b-886a-274896a61fbe.jsonl'), 'utf8');
  assert.ok(parentLines.includes('record-3431') && parentLines.includes('record-3457'), 'the fixture parent names both runs');
  const subSource = fs.readFileSync(sub.file, 'utf8');
  assert.ok(!/pipelines\/20/.test(subSource.split('\n').filter((l) => l.includes('"tool_use"')).join('\n')), 'the subagent names no run in its own tool calls');
  // A subagent whose parent session file is not in the store stays unattributed.
  assert.equal(scan.refusals.find((r) => r.toolUseId === THERE_ID).runId, null);
});

test('scanStore lists every run a Bash or Write call names, refused or not', () => {
  const scan = scanStore({ projectsDir: copyStore(), ...WINDOW });
  assert.deepEqual(scan.referencedRuns, [
    '2026-10-16T194718-record-2970',
    '2026-10-19T185533-record-3457', // named by the parent session, never refused
    '2026-10-19T185709-record-3498',
    '2026-10-19T200655-record-3350',
    '2026-10-24T110909-spec-4039',
  ]);
});

test('scanStore counts only is_error results: a successful result that quotes the refusal text is not a refusal', () => {
  const dir = copyStore();
  const file = fixtureFiles(dir).find((f) => f.endsWith(QUOTE_FILE));
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const result = lines.flatMap((l) => l.message.content).find((b) => b.type === 'tool_result');
  const text = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
  assert.ok(text.includes(' is isolated in the worktree ') && text.indexOf('Refusing to run', text.indexOf(' is isolated in the worktree ')) !== -1, 'the fixture really quotes the refusal');
  assert.notEqual(result.is_error, true);
  const scan = scanStore({ projectsDir: dir, ...WINDOW });
  assert.ok(!scan.refusals.some((r) => r.toolUseId === result.tool_use_id));
  assert.equal(scan.refusals.length, 8);

  // The same refusal with is_error cleared is dropped too, so the flag is what decides.
  const refused = fixtureFiles(dir).find((f) => f.endsWith('0c44b2b9-5474-4ec3-be09-bf547e54aa66.jsonl'));
  const rewritten = fs.readFileSync(refused, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  for (const entry of rewritten) for (const b of entry.message.content) if (b.type === 'tool_result') delete b.is_error;
  fs.writeFileSync(refused, `${rewritten.map((l) => JSON.stringify(l)).join('\n')}\n`);
  fs.utimesSync(refused, STORE_MTIME / 1000, STORE_MTIME / 1000);
  assert.equal(scanStore({ projectsDir: dir, ...WINDOW }).refusals.length, 6);
});

test('scanStore attributes a call to the last run id when one input names several', () => {
  const dir = copyStore();
  const file = fixtureFiles(dir).find((f) => f.endsWith('0c44b2b9-5474-4ec3-be09-bf547e54aa66.jsonl'));
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const use = lines.flatMap((l) => l.message.content).find((b) => b.type === 'tool_use' && b.input.command.includes('record-3498'));
  assert.ok(use, 'the fixture input names a run');
  use.input.command += ' --also /r/.claude-tweaks/pipelines/2026-10-19T210000-record-9999/x';
  fs.writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  fs.utimesSync(file, STORE_MTIME / 1000, STORE_MTIME / 1000);
  const scan = scanStore({ projectsDir: dir, ...WINDOW });
  assert.equal(scan.refusals.find((r) => r.toolUseId === 'toolu_01VKBRmA6qouLJf1MV2XJgsH').runId, '2026-10-19T210000-record-9999');
  assert.ok(scan.referencedRuns.includes('2026-10-19T185709-record-3498') && scan.referencedRuns.includes('2026-10-19T210000-record-9999'));
});
