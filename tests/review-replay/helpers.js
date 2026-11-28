'use strict';
// Shared fixtures and fake deps for the review-replay tests.

const assert = require('node:assert/strict');
const fs = require('fs');
const { scratchDir } = require('../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { run } = require('../../tools/review-replay');
const { armLabel } = require('../../tools/review-replay/schema');

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'review-replay');
const ARCHIVE = path.join(FIXTURES, 'archive');
const TREE = path.join(FIXTURES, 'tree');
const HEAD_A = 'a'.repeat(40);
const BASE_A = 'b'.repeat(40);
const HEAD_C = 'c'.repeat(40);

// The files of the fixture tree, as `git ls-tree -r --name-only` lists them.
const listTree = (dir, prefix = '') => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? listTree(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]));
const TREE_FILES = listTree(TREE).sort().join('\n');

// What the fake git answers, keyed by the space-joined args.
const GIT_TABLE = {
  'log -1 --format=%ct 1111111': '100\n',
  [`rev-parse 1111111^`]: `${HEAD_A}\n`,
  'log -1 --format=%ct 2222222': '200\n',
  [`rev-parse 2222222^`]: `${HEAD_C}\n`,
  [`cat-file -e ${HEAD_A}^{commit}`]: '',
  [`cat-file -e ${HEAD_C}^{commit}`]: '',
  // src/gamma.js is in no tree: the run-a finding that points at it is absent at head.
  [`ls-tree -r --name-only ${HEAD_A}`]: `${TREE_FILES}\n`,
  [`ls-tree -r --name-only ${HEAD_C}`]: `${TREE_FILES}\n`,
};

// run-bad's decisions.md is a plain file the deps' fs refuses to read, as a permission-denied file would be. A directory
// in its place would break every repo-wide scan that reads tests/**/*.md.
const UNREADABLE = path.join(ARCHIVE, 'run-bad', 'decisions.md');
const depsFs = {
  ...fs,
  readFileSync: (file, ...rest) => {
    if (path.resolve(String(file)) === UNREADABLE) {
      throw Object.assign(new Error(`EACCES: permission denied, open '${file}'`), { code: 'EACCES' });
    }
    return fs.readFileSync(file, ...rest);
  },
};

// Deps for run(): the real fs (bar run-bad's decisions.md), a git that answers from a table (and throws on anything
// else), a writeTree that copies the fixture tree, and captured log and err lines.
function makeDeps({ gitTable, ...overrides } = {}) {
  const logs = [];
  const errs = [];
  const gitCalls = [];
  const table = { ...GIT_TABLE, ...(gitTable || {}) };
  const deps = {
    fs: depsFs,
    git: (args) => {
      const key = args.join(' ');
      gitCalls.push(key);
      if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
      throw new Error(`fake git: no answer for ${key}`);
    },
    writeTree: (head, destDir) => {
      fs.mkdirSync(destDir, { recursive: true });
      fs.cpSync(TREE, destDir, { recursive: true });
    },
    log: (line) => logs.push(line),
    err: (line) => errs.push(line),
    pluginRoot: path.join(__dirname, '..', '..', 'plugin'),
  };
  return Object.assign(deps, overrides, { logs, errs, gitCalls });
}

const ARMS = ['--arm', 'name=one,chunk=1,profile=fast', '--arm', 'name=eight,chunk=8,profile=fast'];

// The four replayable findings and the line and quote each tree file is rewritten to hold, so a reply can verify.
const FINDINGS = {
  a1: { id: 'aaaaaaaaaaa1', run: 'run-a', file: 'src/alpha.js', line: 10, quote: 'const alpha_marker = 1;' },
  a2: { id: 'aaaaaaaaaaa2', run: 'run-a', file: 'src/beta.js', line: 20, quote: 'const beta_marker = 2;' },
  b1: { id: 'bbbbbbbbbbb1', run: 'run-b', file: 'lib/one.js', line: 7, quote: 'const one_marker = 3;' },
  b2: { id: 'bbbbbbbbbbb2', run: 'run-b', file: 'lib/two.js', line: 8, quote: 'const two_marker = 4;' },
};

// A reply for one finding: the lines tiebreak.js parses, citing the file as the judge would.
function reply(key, verdict, { status = 'DONE', evidencePath = FINDINGS[key].file, last = true } = {}) {
  const f = FINDINGS[key];
  const lines = [`Verdict: ${verdict}`, `Evidence: ${evidencePath}:${f.line} "${f.quote}"`, 'Severity: medium', 'Recommendation: file'];
  if (last) lines.push(`STATUS: ${status}`);
  return lines.join('\n');
}
const chunkReply = (parts, status = 'DONE') => `${parts.map(([key, text]) => `Id: ${FINDINGS[key].id}\n${text}`).join('\n\n')}\n\nSTATUS: ${status}`;

// Runs extract into a fresh dir and rewrites the tree files; returns paths and the writers for journal and transcripts.
// promptFor(label) is the text an agent's first user message holds (default: just the identity line).
async function setup({ promptFor = (label) => `Replay judge ${label}.\n\nThe finding follows.`, arms = ARMS } = {}) {
  const root = scratchDir('rr-score-');
  const out = path.join(root, 'out');
  const transcripts = path.join(root, 'workflow');
  fs.mkdirSync(transcripts);
  const deps = makeDeps();
  const code = await run({ argv: ['extract', '--runs', ARCHIVE, '--out', out, ...arms], deps });
  assert.equal(code, 0, deps.errs.join('\n'));
  for (const f of Object.values(FINDINGS)) {
    const body = Array.from({ length: f.line - 1 }, (_, i) => `// pad ${i + 1}`);
    body.push(f.quote);
    fs.writeFileSync(path.join(out, 'trees', f.run, f.file), `${body.join('\n')}\n`);
  }
  const jsonl = (file, entries) => fs.writeFileSync(file, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);

  // An agent's transcript: the identity prompt first, then assistant messages [id, output, cacheRead, cacheCreate], each
  // preceded by a streamed partial of the same id carrying a smaller output count.
  // `effort` / `perTurnEffort` become the top-level fields a real transcript writes on each assistant entry: a string for
  // every entry, or an array per entry (undefined omits the field); perTurnEffort defaults to the effort value.
  function agent(agentId, label, { messages = [], seconds = 0, identity = true, effort, perTurnEffort = effort, synthetic = 0 } = {}) {
    const pick = (v, i) => (Array.isArray(v) ? v[i] : v);
    const fields = (j) => ({ ...(pick(effort, j) === undefined ? {} : { effort: pick(effort, j) }), ...(pick(perTurnEffort, j) === undefined ? {} : { perTurnEffort: pick(perTurnEffort, j) }) });
    const t0 = Date.parse('2026-01-01T00:00:00Z');
    const text = promptFor(label);
    const entries = [{ type: 'user', timestamp: new Date(t0).toISOString(), message: { role: 'user', content: identity ? text : 'no identity here' } }];
    messages.forEach(([id, o, cr, cc], i) => {
      const at = new Date(t0 + (i + 1) * seconds * 1000 / Math.max(messages.length, 1)).toISOString();
      entries.push({ type: 'assistant', ...fields(2 * i), timestamp: at, message: { id, usage: { output_tokens: 1, cache_read_input_tokens: cr, cache_creation_input_tokens: cc } } });
      entries.push({ type: 'assistant', ...fields(2 * i + 1), timestamp: at, message: { id, usage: { output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: cc } } });
    });
    // `synthetic` appends that many Claude Code error entries: model <synthetic>, isApiErrorMessage, a perTurnEffort, no effort.
    for (let k = 0; k < synthetic; k += 1) entries.push({ type: 'assistant', perTurnEffort: 'low', isApiErrorMessage: true, message: { id: `syn-${k}`, model: '<synthetic>', usage: { output_tokens: 0 } } });
    jsonl(path.join(transcripts, `agent-${agentId}.jsonl`), entries);
  }
  const journal = (startedIds, results) => jsonl(path.join(transcripts, 'journal.jsonl'), [
    ...startedIds.map((agentId) => ({ type: 'started', agentId })),
    ...Object.entries(results).map(([agentId, result]) => ({ type: 'result', agentId, result })),
  ]);
  const score = async (extra = [], overrides = {}) => {
    const d = makeDeps(overrides);
    const code = await run({ argv: ['score', '--out', out, '--transcripts', transcripts, ...extra], deps: d });
    return { code, deps: d, json: d.logs.length > 0 ? JSON.parse(d.logs.join('\n')) : null };
  };
  const tree = (name) => path.join(out, 'trees', name);
  return { root, out, transcripts, agent, journal, score, tree, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const MSGS_ONE = [['m1', 10, 100, 1000], ['m2', 5, 200, 0]];
const MSGS_EIGHT = [['m1', 20, 50, 500], ['m2', 7, 60, 0]];

// The full happy-path set: four single-finding judges for arm one, two chunk judges for arm eight.
function fullSet(s, overrides = {}) {
  const judges = {
    'ag-1': { label: armLabel('one', 1, 'run-a--0'), reply: reply('a1', 'confirmed'), messages: MSGS_ONE, seconds: 10 },
    'ag-2': { label: armLabel('one', 1, 'run-a--1'), reply: reply('a2', 'confirmed'), messages: MSGS_ONE, seconds: 10 },
    'ag-3': { label: armLabel('one', 1, 'run-b--0'), reply: reply('b1', 'confirmed'), messages: MSGS_ONE, seconds: 10 },
    'ag-4': { label: armLabel('one', 1, 'run-b--1'), reply: reply('b2', 'refuted'), messages: MSGS_ONE, seconds: 10 },
    'ag-5': { label: armLabel('eight', 1, 'run-a--0'), reply: chunkReply([['a1', reply('a1', 'confirmed', { last: false })], ['a2', reply('a2', 'refuted', { last: false })]]), messages: MSGS_EIGHT, seconds: 30 },
    'ag-6': { label: armLabel('eight', 1, 'run-b--0'), reply: chunkReply([['b1', reply('b1', 'refuted', { last: false })], ['b2', reply('b2', 'cant-tell', { last: false })]]), messages: MSGS_EIGHT, seconds: 30 },
    ...overrides,
  };
  const results = {};
  for (const [id, j] of Object.entries(judges)) {
    if (j === null) continue;
    s.agent(id, j.label, j);
    if (j.reply !== undefined) results[id] = j.reply;
  }
  s.journal(Object.keys(judges).filter((id) => judges[id] !== null), results);
}

const WORKFLOW = path.join(__dirname, '..', '..', 'tools', 'review-replay', 'replay.workflow.js');
const workflowSource = () => fs.readFileSync(WORKFLOW, 'utf8').split(/\r?\n/).join('\n');

// Runs the workflow script the way the Workflow tool does, with the manifest as args and a recording agent; resolves to
// the agent calls (prompt and options) and the script's return value.
async function runWorkflow(manifest) {
  const calls = [];
  const agent = (prompt, opts) => {
    calls.push({ prompt, opts });
    return Promise.resolve(`reply for ${opts.label}`);
  };
  const parallel = (thunks) => Promise.all(thunks.map((t) => t()));
  const body = workflowSource().replace('export const meta =', 'const meta =');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const result = await new AsyncFunction('args', 'agent', 'parallel', body)(manifest, agent, parallel);
  return { calls, result };
}

module.exports = {
  WORKFLOW, workflowSource, runWorkflow,
  FIXTURES, ARCHIVE, TREE, HEAD_A, BASE_A, HEAD_C, GIT_TABLE, makeDeps,
  ARMS, FINDINGS, reply, chunkReply, setup, MSGS_ONE, MSGS_EIGHT, fullSet,
};
