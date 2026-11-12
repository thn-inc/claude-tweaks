'use strict';
// #5227: scenario builders and the one gh answer table both sides of the queue-pull parity
// suite read. `scenario.gh` is a list of entries, each one of:
//   { argv: string[], stdout, stderr?, status?, effect? }  -- matched by exact argv equality
//   { graphql: 'linked'|'native'|'landing'|'foreign', aliases: { <alias>: node }, status?, effect? }
// A graphql entry matches an `api graphql` call whose query is that kind (the signature of the
// query builder in plugin/bin/lib), and answers with only the aliases the query requests; a
// requested alias the entry lacks makes the call a miss (an explicit null is GitHub's not-found). A
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

// The entry's answer to `query`, or null when the query requests an alias the entry does not
// hold as an own key (a miss, never a silently partial response). An explicit `null` value is
// an answer: GitHub's not-found node.
function graphqlAnswer(entry, query) {
  const kind = GRAPHQL_KINDS[entry.graphql];
  const out = {};
  for (const m of query.matchAll(kind.alias)) {
    if (!Object.prototype.hasOwnProperty.call(entry.aliases, m[1])) return null;
    out[m[1]] = entry.aliases[m[1]];
  }
  return JSON.stringify({ data: kind.inRepository ? { repository: out } : out }) + '\n';
}

// (entries, argv) -> { stdout, stderr, status, effect } | null. The one matcher the PATH shim
// and fakeRun share: an exact-argv entry first, then the first graphql entry of the query's
// kind that answers every alias the query requests.
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
    for (const entry of entries || []) {
      if (!entry.graphql || !GRAPHQL_KINDS[entry.graphql].query.test(query)) continue;
      const stdout = graphqlAnswer(entry, query);
      if (stdout !== null) return { stdout, stderr: '', status: entry.status || 0, effect: entry.effect || null };
    }
  }
  return null;
}

// Git's leading global options, as the git shim and fakeRun both skip them. `-C` and `-c`
// take a value; the rest stand alone. `--version` is a subcommand here, not an option.
const GIT_VALUE_OPTIONS = new Set(['-C', '-c']);
const GIT_FLAG_OPTIONS = new Set(['--no-optional-locks', '--no-pager', '--literal-pathspecs']);

// argv -> { dirs: the -C values in order, configs: the -c values, sub: the argv from the
// subcommand on, unknown: the first other leading option (or null) }.
function gitSubArgv(argv) {
  const dirs = [];
  const configs = [];
  let i = 0;
  while (i < argv.length && argv[i].startsWith('-') && argv[i] !== '--version') {
    if (GIT_VALUE_OPTIONS.has(argv[i])) {
      (argv[i] === '-C' ? dirs : configs).push(argv[i + 1] === undefined ? '' : argv[i + 1]);
      i += 2;
    } else if (GIT_FLAG_OPTIONS.has(argv[i])) {
      i += 1;
    } else {
      return { dirs, configs, sub: argv.slice(i), unknown: argv[i] };
    }
  }
  return { dirs, configs, sub: argv.slice(i), unknown: null };
}

// True when the subcommand argv starts with one of the table's injected-failure prefixes.
function gitFailMatch(failPrefixes, sub) {
  return failPrefixes.some((prefix) => prefix.every((a, k) => sub[k] === a));
}

const isGetUrlOrigin = (sub) => sub.length === 3 && sub[0] === 'remote' && sub[1] === 'get-url' && sub[2] === 'origin';

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
      const { sub } = gitSubArgv(args);
      if (gitFailMatch(table.git.fail, sub)) {
        throw fakeFailure(args, { status: 128, stdout: '', stderr: `git-shim: injected failure: ${sub.join(' ')}\n` });
      }
      if (isGetUrlOrigin(sub)) return table.git.remoteUrl + '\n';
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

// The scenario's non-queue answers: everything the rest of the fence asks for over a queue of
// `numbers` that all survive to the open-PR pass.
function tailGh(numbers) {
  const aliases = Object.fromEntries(numbers.map((n) => [`i${n}`, { number: n, state: 'OPEN', closedByPullRequestsReferences: { nodes: [] }, timelineItems: { nodes: [] } }]));
  return [
    { argv: ['--version'], stdout: 'gh version 2.99.0 (qp-shim)\n' },
    { graphql: 'linked', aliases },
    { argv: ['issue', 'list', '--label', 'bot:in-progress', '--state', 'open', '--json', 'number,title,body,labels', '--limit', '200'], stdout: '[]\n' },
    { argv: ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], stdout: 'fixture-owner/fixture-repo\n' },
    { argv: ['pr', 'list', '--state', 'open', '--json', 'number,files,closingIssuesReferences', '--limit', '100'], stdout: '[]\n' },
  ];
}

const DEP_SEARCH_8000 = ['issue', 'list', '--search', '#8000', '--state', 'all', '--json', 'number,updatedAt,state', '--limit', '500'];

const withBody = (n, extra) => SPEC_BODY.replace('plugin/bin/oracle-fixture.js', `plugin/bin/fixture-${n}.js`) + (extra || '');

// S1: #9001 and #9003 plain; #9002 declares `Blocked by #8000` and #8000 is open, so the blocked
// pass holds it. Body-text repo, default guard and bundle cap.
function S1() {
  const records = [
    ghRecord(9001, { body: withBody(9001) }),
    ghRecord(9002, { body: `Blocked by #8000\n\n${withBody(9002)}` }),
    ghRecord(9003, { body: withBody(9003) }),
  ];
  return {
    name: 'S1',
    policy: { 'work-links': 'body-text' },
    origin: { branches: { main: {} } },
    gh: [
      { argv: QUEUE_ARGV, stdout: JSON.stringify(records) + '\n' },
      { argv: ['issue', 'list', '--state', 'open', '--json', 'number', '--limit', '200'], stdout: '[{"number":9001},{"number":9002},{"number":9003},{"number":8000}]\n' },
      { argv: DEP_SEARCH_8000, stdout: '[{"number":8000,"updatedAt":"2026-11-09T10:00:00Z","state":"OPEN"}]\n' },
      ...tailGh([9001, 9003]),
    ],
  };
}

// SFast: three fast-lane singletons with disjoint Key Files and a guard of 2, so they bundle into
// one group of 3 that is over the guard.
function SFast() {
  const labels = ['auto:build', 'ready', 'ceremony:fast-lane'];
  const records = [9101, 9102, 9103].map((n) => ghRecord(n, { body: withBody(n), labels }));
  return {
    name: 'SFast',
    policy: { 'work-links': 'body-text', 'dispatch-group-size-guard': '2', 'dispatch-fastlane-bundle-cap': '3' },
    origin: { branches: { main: {} } },
    gh: [
      { argv: QUEUE_ARGV, stdout: JSON.stringify(records) + '\n' },
      { argv: ['issue', 'list', '--state', 'open', '--json', 'number', '--limit', '200'], stdout: '[{"number":9101},{"number":9102},{"number":9103}]\n' },
      ...tailGh([9101, 9102, 9103]),
    ],
  };
}

// The in-process twin of the policy / blocker CLIs the passes spawn: resolve-policy.js answers
// scenario.policy (unset keys read as the empty line); any other CLI needs an override, a result
// object or (args, opts) => result. The returned function records `.calls` ({name, args}).
function fakeSpawnCli(scenario, overrides = {}) {
  const calls = [];
  const spawnCli = (name, args, opts) => {
    calls.push({ name, args });
    if (Object.prototype.hasOwnProperty.call(overrides, name)) {
      const o = overrides[name];
      return typeof o === 'function' ? o(args, opts) : o;
    }
    if (name === 'resolve-policy.js') {
      const key = args[args.indexOf('--values') + 1];
      const value = (scenario.policy || {})[key];
      return { status: 0, stdout: `${value === undefined ? '' : value}\n`, stderr: '' };
    }
    throw new Error(`unexpected spawnCli ${name} ${args.join(' ')}`);
  };
  spawnCli.calls = calls;
  return spawnCli;
}

module.exports = {
  DEFAULT_REMOTE_URL, GRAPHQL_KINDS, ghAnswer, applyEffect, gitSubArgv, gitFailMatch, isGetUrlOrigin, shimTable, fakeRun,
  ghLabel, ghRecord, SPEC_BODY, QUEUE_ARGV, DEP_SEARCH_8000, withBody, S0, S1, SFast, fakeSpawnCli,
};
