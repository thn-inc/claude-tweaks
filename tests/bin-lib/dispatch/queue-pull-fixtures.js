'use strict';
// #5227: scenario builders and the one gh answer table both sides of the queue-pull parity
// suite read. `scenario.gh` is a list of entries, each one of:
//   { argv: string[], stdout, stderr?, status?, effect? }  -- matched by exact argv equality
//   { graphql: 'linked'|'native'|'landing'|'foreign', aliases: { <alias>: node }, status?, effect? }
// A graphql entry matches an `api graphql` call whose query is that kind (the signature of the
// query builder in plugin/bin/lib), and answers with only the aliases the query requests. A
// non-zero `status` injects a failure after the output is written, as gh does on a partial
// GraphQL error. `effect` mutates a session file before the answer: `corrupt-exclusions`,
// `corrupt-groups` or `delete-session-file:<name>`.
// An unmatched call fails on both sides: the PATH shim exits 97 with
// `gh-shim: no canned response for: …`, and fakeRun throws 'unexpected gh ' + args.join(' ').
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_REMOTE_URL = 'https://github.com/fixture-owner/fixture-repo.git';

const GRAPHQL_KINDS = {
  linked: { query: /CROSS_REFERENCED_EVENT/, alias: /\b(i\d+)\s*:\s*issue\(/g, inRepository: true },
  native: { query: /blockedBy\(first:/, alias: /\b(i\d+)\s*:\s*issue\(/g, inRepository: true },
  landing: { query: /CLOSED_EVENT/, alias: /\b(b\d+)\s*:\s*issue\(/g, inRepository: true },
  foreign: { query: /\bc\d+\s*:\s*repository\(/, alias: /\b(c\d+)\s*:\s*repository\(/g, inRepository: false },
};

function validateEntry(entry, i) {
  if (entry && Array.isArray(entry.argv) && entry.argv.every((a) => typeof a === 'string')) return;
  if (entry && Object.prototype.hasOwnProperty.call(GRAPHQL_KINDS, entry.graphql) && entry.aliases && typeof entry.aliases === 'object') return;
  throw new TypeError(`scenario.gh[${i}] is neither {argv: string[], stdout} nor {graphql: ${Object.keys(GRAPHQL_KINDS).join('|')}, aliases}`);
}

function graphqlAnswer(entry, query) {
  const kind = GRAPHQL_KINDS[entry.graphql];
  const out = {};
  for (const m of query.matchAll(kind.alias)) {
    if (Object.prototype.hasOwnProperty.call(entry.aliases, m[1])) out[m[1]] = entry.aliases[m[1]];
  }
  return JSON.stringify({ data: kind.inRepository ? { repository: out } : out }) + '\n';
}

// (entries, argv) -> { stdout, stderr, status, effect } | null. The one matcher the PATH shim
// and fakeRun share: an exact-argv entry first, then a graphql entry of the query's kind.
function ghAnswer(entries, argv) {
  (entries || []).forEach(validateEntry);
  const exact = (entries || []).find((e) => Array.isArray(e.argv)
    && e.argv.length === argv.length && e.argv.every((a, i) => a === argv[i]));
  if (exact) {
    return { stdout: exact.stdout || '', stderr: exact.stderr || '', status: exact.status || 0, effect: exact.effect || null };
  }
  if (argv[0] === 'api' && argv[1] === 'graphql') {
    const queryArg = argv.find((a) => a.startsWith('query=')) || '';
    const query = queryArg.slice('query='.length);
    const entry = (entries || []).find((e) => e.graphql && GRAPHQL_KINDS[e.graphql].query.test(query));
    if (entry) return { stdout: graphqlAnswer(entry, query), stderr: '', status: entry.status || 0, effect: entry.effect || null };
  }
  return null;
}

// Applies an entry's `effect` to the session dir it names files in.
function applyEffect(effect, sessionDir) {
  if (!effect) return;
  if (!sessionDir) throw new Error(`gh effect ${effect}: no session dir to apply it to`);
  if (effect === 'corrupt-exclusions') return fs.writeFileSync(path.join(sessionDir, 'dispatch-exclusions.json'), '{corrupt');
  if (effect === 'corrupt-groups') return fs.writeFileSync(path.join(sessionDir, 'dispatch-groups.json'), '{corrupt');
  if (effect.startsWith('delete-session-file:')) {
    return fs.rmSync(path.join(sessionDir, effect.slice('delete-session-file:'.length)), { force: true });
  }
  throw new Error(`unknown gh effect: ${effect}`);
}

// The shim table a sandbox writes to QP_SHIM_TABLE: the gh answers plus the git shim's
// canned origin URL and injected failures (argv prefixes after the global options).
function shimTable(scenario) {
  (scenario.gh || []).forEach(validateEntry);
  return {
    gh: scenario.gh || [],
    git: { remoteUrl: scenario.remoteUrl || DEFAULT_REMOTE_URL, fail: scenario.gitFail || [] },
  };
}

function fakeFailure(args, answer) {
  const err = new Error(`gh ${args.join(' ')} exited ${answer.status}`);
  Object.assign(err, { status: answer.status, stdout: answer.stdout, stderr: answer.stderr });
  return err;
}

// The in-process twin of the shims: run(cmd, args) -> stdout, throwing {status, stdout, stderr}
// on an injected failure and 'unexpected <cmd> …' on anything the scenario does not answer.
function fakeRun(scenario, { sessionDir } = {}) {
  const table = shimTable(scenario);
  return function run(cmd, args) {
    if (cmd === 'gh') {
      const answer = ghAnswer(table.gh, args);
      if (!answer) throw new Error('unexpected gh ' + args.join(' '));
      applyEffect(answer.effect, sessionDir);
      if (answer.status !== 0) throw fakeFailure(args, answer);
      return answer.stdout;
    }
    if (cmd === 'git') {
      let i = 0;
      while (args[i] === '-C') i += 2;
      const sub = args.slice(i);
      if (table.git.fail.some((prefix) => prefix.every((a, k) => sub[k] === a))) {
        throw fakeFailure(args, { status: 128, stdout: '', stderr: `git-shim: injected failure: ${sub.join(' ')}\n` });
      }
      if (sub.join(' ') === 'remote get-url origin') return table.git.remoteUrl + '\n';
    }
    throw new Error(`unexpected ${cmd} ${args.join(' ')}`);
  };
}

// --- records ------------------------------------------------------------------

const ghLabel = (name) => ({ id: 'L_' + name, name, description: '', color: 'ededed' });

const SPEC_BODY = [
  '## Current State', '', 'Fixture current state.', '',
  '## Deliverables', '', 'Fixture deliverable.', '', '### Key Files', '', '- `plugin/bin/oracle-fixture.js`', '',
  '## Acceptance Criteria', '', '- [ ] Fixture criterion.', '',
  '## Release Note', '', 'Fixture release note.',
].join('\n');

function ghRecord(number, { title = `Fixture record ${number}`, body = SPEC_BODY, labels = ['auto:build', 'ready'] } = {}) {
  return {
    number, title, body, labels: labels.map(ghLabel),
    createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-10T10:00:00Z', state: 'OPEN',
  };
}

const QUEUE_ARGV = ['issue', 'list', '--label', 'auto:build', '--state', 'open', '--json',
  'number,title,body,labels,createdAt,updatedAt,state', '--limit', '500'];

// S0: one spec-shaped auto:build record, #9001, on a body-text repo with no integration-branch
// key (so the fence resolves the branch through `git remote show origin`). Built by running the
// oracle over an empty table and answering each UNHANDLED argv in turn.
function S0() {
  return {
    name: 'S0',
    policy: { 'work-links': 'body-text' },
    origin: { branches: { main: {} } },
    gh: [
      { argv: QUEUE_ARGV, stdout: JSON.stringify([ghRecord(9001)]) + '\n' },
      { argv: ['issue', 'list', '--state', 'open', '--json', 'number', '--limit', '200'], stdout: '[{"number":9001}]\n' },
      { argv: ['--version'], stdout: 'gh version 2.99.0 (qp-shim)\n' },
      {
        graphql: 'linked',
        aliases: { i9001: { number: 9001, state: 'OPEN', closedByPullRequestsReferences: { nodes: [] }, timelineItems: { nodes: [] } } },
      },
      { argv: ['issue', 'list', '--label', 'bot:in-progress', '--state', 'open', '--json', 'number,title,body,labels', '--limit', '200'], stdout: '[]\n' },
      { argv: ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], stdout: 'fixture-owner/fixture-repo\n' },
      { argv: ['pr', 'list', '--state', 'open', '--json', 'number,files,closingIssuesReferences', '--limit', '100'], stdout: '[]\n' },
    ],
  };
}

module.exports = {
  DEFAULT_REMOTE_URL, GRAPHQL_KINDS, ghAnswer, applyEffect, shimTable, fakeRun, ghLabel, ghRecord, SPEC_BODY, S0,
};
