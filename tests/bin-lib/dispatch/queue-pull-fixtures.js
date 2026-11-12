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

// The files a scenario's origin holds on `branch` (the sandbox's own seed: main always carries
// README.md and .gitignore), or null when origin has no such branch.
function originBranchFiles(scenario, branch) {
  const spec = (scenario.origin && scenario.origin.branches) || {};
  if (branch === 'main') return { 'README.md': 'fixture\n', '.gitignore': '.claude-tweaks/pipelines/\n', ...(spec.main || {}) };
  return Object.prototype.hasOwnProperty.call(spec, branch) ? spec[branch] : null;
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
      if (sub.length === 3 && sub[0] === 'remote' && sub[1] === 'show' && sub[2] === 'origin') {
        return `* remote origin\n  Fetch URL: ${table.git.remoteUrl}\n  HEAD branch: ${scenario.headBranch || 'main'}\n`;
      }
      if (sub.length === 3 && sub[0] === 'cat-file' && sub[1] === '-e') {
        const colon = sub[2].indexOf(':');
        const ref = sub[2].slice(0, colon);
        const files = originBranchFiles(scenario, ref.replace(/^origin\//, ''));
        if (files && Object.prototype.hasOwnProperty.call(files, sub[2].slice(colon + 1))) return '';
        throw fakeFailure(args, { status: 128, stdout: '', stderr: `fatal: path '${sub[2].slice(colon + 1)}' does not exist in '${ref}'\n` });
      }
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
const REPO_SLUG = 'fixture-owner/fixture-repo';

// A linked-PR GraphQL node (the oracle's gh table) for record `n`; `spec` is scenario.linked[n]:
// { openPR, mentions: [{ number, title, merged, mergedAt, createdAt }] }.
function linkedNode(n, spec = {}) {
  const mentions = spec.mentions || [];
  return {
    number: n,
    state: 'OPEN',
    closedByPullRequestsReferences: { nodes: spec.openPR ? [{ number: spec.openPR, state: 'OPEN' }] : [] },
    timelineItems: { nodes: mentions.map((m) => ({ source: {
      number: m.number, title: m.title, state: m.merged ? 'MERGED' : 'OPEN', merged: m.merged, mergedAt: m.mergedAt || null, createdAt: m.createdAt || null, repository: { nameWithOwner: REPO_SLUG },
    } })) },
  };
}

// What bin/resolve-linked-prs.js prints for `numbers` over scenario.linked: openPR, mentions and
// hasClosingPRReference only (the CLI drops fetchLinkedPRs' issueState).
function linkedOutput(linked, numbers) {
  const out = {};
  for (const n of numbers) {
    const spec = (linked || {})[n] || {};
    out[n] = {
      openPR: spec.openPR || null,
      mentions: (spec.mentions || []).map((m) => ({ number: m.number, title: m.title, state: m.merged ? 'MERGED' : 'OPEN', merged: !!m.merged, mergedAt: m.mergedAt || null, createdAt: m.createdAt || null })),
      hasClosingPRReference: Boolean(spec.openPR),
    };
  }
  return out;
}

function tailGh(numbers, linked = {}, { inFlight = [], openPrs = [] } = {}) {
  const aliases = Object.fromEntries(numbers.map((n) => [`i${n}`, linkedNode(n, linked[n])]));
  return [
    { argv: ['--version'], stdout: 'gh version 2.99.0 (qp-shim)\n' },
    { graphql: 'linked', aliases },
    { argv: ['issue', 'list', '--label', 'bot:in-progress', '--state', 'open', '--json', 'number,title,body,labels', '--limit', '200'], stdout: JSON.stringify(inFlight) + '\n' },
    { argv: ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], stdout: 'fixture-owner/fixture-repo\n' },
    { argv: ['pr', 'list', '--state', 'open', '--json', 'number,files,closingIssuesReferences', '--limit', '100'], stdout: JSON.stringify(openPrs) + '\n' },
  ];
}

const DEP_SEARCH_8000 = ['issue', 'list', '--search', '#8000', '--state', 'all', '--json', 'number,updatedAt,state', '--limit', '500'];

const withBody = (n, extra) => SPEC_BODY.replace('plugin/bin/oracle-fixture.js', `plugin/bin/fixture-${n}.js`) + (extra || '');

// S1: #9001 and #9003 plain; #9002 declares `Blocked by #8000` and #8000 is open, so the blocked
// pass holds it. Body-text repo, default guard and bundle cap.
//
// S1({ full: true }) adds the spec-shape, open-PR, target-missing and shipped candidates (the
// Task 4 passes). Each qualifies for the passes its comment names; the first pass to run wins:
//   #9004 docs-health, not spec-shaped (no sections), and also: open PR #78, named target
//         docs/gone4.md absent, strong shipped mention  -> only not-spec-shaped
//   #9005 open PR #79 and a strong shipped mention        -> only open-pr
//   #9006 docs-health, named target docs/gone6.md absent and a strong mention -> only target-missing
//   #9007 spec body without Acceptance Criteria           -> not-spec-shaped
//   #9008 open PR #77                                     -> open-pr
//   #9009 docs-health, named target docs/gone.md absent   -> target-missing (+ staged Close proposal)
//   #9010 strong mention (title match)                    -> shipped (+ staged Close proposal)
//   #9016 weak mention (unrelated title, probed files miss) -> stays, weak AUTO line
const MERGED_AT = '2026-11-06T10:00:00Z';
const PR_OPENED_AT = '2026-11-05T10:00:00Z';
const mention = (number, title) => ({ number, title, merged: true, mergedAt: MERGED_AT, createdAt: PR_OPENED_AT });
const WEAK_PR_FILES = ['plugin/bin/unrelated.js'];

//
// S1({ pipeline: true }) is full plus the Task 5 candidates (the blocker-landing, neighbour,
// overlap and near-duplicate passes), each qualifying only for its own pass:
//   #9011 Blocked by closed #8001 whose closing commit never reached the integration branch -> unlanded-blocker
//   #9012 Blocked by #0 (no valid issue number)                                            -> malformed-blocker
//   #9013 shares a Key File with in-flight #7001 (a live claim in the tests)               -> neighbour-in-flight
//   #9014 / #9015 two cross-group records naming the same two Current State anchors        -> a strong near-duplicate pair
// and an open PR #41 (closing nothing) that touches #9001's Key File, for the cross-PR overlap report.
// dispatch-unlanded-blockers.js is the in-process tests' canned CLI (see CANNED_LANDING in the suite).
const IN_FLIGHT_7001 = {
  number: 7001, title: 'Tune the harness cache eviction', body: withBody(9013), labels: [ghLabel('bot:in-progress')],
};
const OPEN_PR_41 = { number: 41, files: [{ path: 'plugin/bin/fixture-9001.js' }], closingIssuesReferences: [] };
const LIVE_CLAIM = JSON.stringify({ claimedAt: '2026-11-12T11:55:00.000Z', runId: 'qp-fixture' });
const DEP_SEARCH_PIPELINE = ['issue', 'list', '--search', '#8000 #8001 #0', '--state', 'all', '--json', 'number,updatedAt,state', '--limit', '500'];

const DEP_SEARCH_PIPELINE_HIT = ['issue', 'list', '--search', '#8000 #8001', '--state', 'all', '--json', 'number,updatedAt,state', '--limit', '500'];
const DEP_FRESHNESS_PIPELINE = '[{"number":8000,"updatedAt":"2026-11-09T10:00:00Z","state":"OPEN"},{"number":8001,"updatedAt":"2026-11-08T10:00:00Z","state":"CLOSED"}]\n';

function S1({ full = false, pipeline = false } = {}) {
  full = full || pipeline;
  const docsHealth = ['auto:build', 'ready', 'by:docs-health'];
  const header = (doc) => `**Doc:** ${doc} | **Section:** fixture\n\n`;
  const records = [
    ghRecord(9001, { body: withBody(9001) }),
    ghRecord(9002, { body: `Blocked by #8000\n\n${withBody(9002)}` }),
    ghRecord(9003, { body: withBody(9003) }),
  ];
  const linked = {};
  const survivors = [9001, 9003];
  if (full) {
    records.push(
      ghRecord(9004, { body: `${header('docs/gone4.md')}No spec sections in this body.\n`, labels: docsHealth }),
      ghRecord(9005, { body: withBody(9005) }),
      ghRecord(9006, { body: header('docs/gone6.md') + withBody(9006), labels: docsHealth }),
      ghRecord(9007, { body: withBody(9007).replace(/## Acceptance Criteria\n\n- \[ \] Fixture criterion\.\n\n/, '') }),
      ghRecord(9008, { body: withBody(9008) }),
      ghRecord(9009, { body: header('docs/gone.md') + withBody(9009), labels: docsHealth }),
      ghRecord(9010, { body: withBody(9010) }),
      ghRecord(9016, { body: withBody(9016) }),
    );
    Object.assign(linked, {
      9004: { openPR: 78, mentions: [mention(5004, 'Fixture record 9004')] },
      9005: { openPR: 79, mentions: [mention(5005, 'Fixture record 9005')] },
      9006: { mentions: [mention(5006, 'Fixture record 9006')] },
      9008: { openPR: 77 },
      9010: { mentions: [mention(5010, 'Fixture record 9010')] },
      9016: { mentions: [mention(5016, 'Unrelated cleanup of the build output')] },
    });
    survivors.push(9004, 9005, 9006, 9007, 9008, 9009, 9010, 9016);
  }
  if (pipeline) {
    const widget = (n, title) => ghRecord(n, {
      title,
      body: withBody(n).replace('Fixture current state.', 'The `WidgetScheduler.flush` path and `schedulerCache.evict` disagree on ordering.'),
    });
    records.push(
      ghRecord(9011, { body: `Blocked by #8001\n\n${withBody(9011)}` }),
      ghRecord(9012, { body: `Blocked by #0\n\n${withBody(9012)}` }),
      ghRecord(9013, { body: withBody(9013) }),
      widget(9014, 'Rework the widget scheduler cache'),
      widget(9015, 'Rework the widget scheduler cache layer'),
    );
    survivors.push(9011, 9012, 9013, 9014, 9015);
  }
  const openNumbers = [...records.map((r) => r.number), 8000].map((number) => ({ number }));
  return {
    name: 'S1',
    policy: { 'work-links': 'body-text' },
    origin: { branches: { main: {} } },
    linked,
    gh: [
      { argv: QUEUE_ARGV, stdout: JSON.stringify(records) + '\n' },
      { argv: ['issue', 'list', '--state', 'open', '--json', 'number', '--limit', '200'], stdout: JSON.stringify(openNumbers) + '\n' },
      ...(pipeline ? [
        // #8001 is closed (not an open blocker); #0 is no issue at all, so its state read fails.
        { argv: ['issue', 'view', '8001', '--json', 'state', '-q', '.state'], stdout: 'CLOSED\n' },
        { argv: ['issue', 'view', '0', '--json', 'state', '-q', '.state'], stdout: '', status: 1 },
        { argv: DEP_SEARCH_PIPELINE, stdout: DEP_FRESHNESS_PIPELINE },
        // A queue-order cache hit refetches only the dependencies the blob's freshness signal holds (#0 has no record).
        { argv: DEP_SEARCH_PIPELINE_HIT, stdout: DEP_FRESHNESS_PIPELINE },
      ] : [{ argv: DEP_SEARCH_8000, stdout: '[{"number":8000,"updatedAt":"2026-11-09T10:00:00Z","state":"OPEN"}]\n' }]),
      ...(full ? [{ argv: ['pr', 'view', '5016', '--json', 'files', '-q', '[.files[].path]'], stdout: JSON.stringify(WEAK_PR_FILES) + '\n' }] : []),
      ...tailGh(survivors, linked, pipeline ? { inFlight: [IN_FLIGHT_7001], openPrs: [OPEN_PR_41] } : {}),
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
    if (name === 'resolve-linked-prs.js') {
      return { status: 0, stdout: JSON.stringify(linkedOutput(scenario.linked, args[0].split(',').map(Number))) + '\n', stderr: '' };
    }
    throw new Error(`unexpected spawnCli ${name} ${args.join(' ')}`);
  };
  spawnCli.calls = calls;
  return spawnCli;
}

module.exports = {
  DEFAULT_REMOTE_URL, GRAPHQL_KINDS, ghAnswer, applyEffect, gitSubArgv, gitFailMatch, isGetUrlOrigin, shimTable, fakeRun,
  ghLabel, ghRecord, SPEC_BODY, QUEUE_ARGV, DEP_SEARCH_8000, withBody, S0, S1, SFast, fakeSpawnCli,
  REPO_SLUG, linkedNode, linkedOutput, mention, WEAK_PR_FILES, tailGh, IN_FLIGHT_7001, OPEN_PR_41, LIVE_CLAIM,
};
