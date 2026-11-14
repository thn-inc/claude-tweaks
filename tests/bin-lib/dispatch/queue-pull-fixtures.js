'use strict';
// #5227: scenario builders and the one gh answer table both sides of the queue-pull parity
// suite read. `scenario.gh` is a list of entries, each one of:
//   { argv: string[], stdout, stderr?, status?, effect? }  -- matched by exact argv equality
//   { graphql: 'linked'|'native'|'landing'|'foreign', aliases: { <alias>: node }, status?, stdout?, stderr?, effect? }
// A graphql entry matches an `api graphql` call whose query is that kind (the signature of the
// query builder in plugin/bin/lib), and answers with only the aliases the query requests; a
// requested alias the entry lacks makes the call a miss (an explicit null is GitHub's not-found). A
// non-zero `status` injects a failure after the output is written, as gh does on a partial
// GraphQL error; a graphql entry's own `stdout` (and `stderr`) replaces that output, so a fault can
// fail the call with no data at all. `effect` mutates a session file before the answer: `corrupt-exclusions`,
// `corrupt-groups` or `delete-session-file:<name>`.
// The PATH shim is a sh script generated from this table (queue-pull-oracle.js's ghShimScript): it
// answers an exact, effect-free entry itself and hands graphql calls, effect entries and misses
// to its node fallback, which answers through ghAnswer. An unmatched call fails on both sides: the
// fallback exits 97 with `gh-shim: no canned response for: …`, and fakeRun throws
// 'unexpected gh ' + args.join(' ').
//
// The parity tables were filled by running each pair over the table and answering every UNHANDLED
// argv in turn (Task 1's loop). The final gh argv each pair makes, both sides, all answered (a
// graphql call shown as <kind: aliases> and its -f variables; [injected] is a fixtured failure;
// the files configs make none, their PATH holding no gh):
//   common  issue list --label auto:build ... --limit 500 | issue list --state open --json number --limit 200
//           --version | issue list --label bot:in-progress ... --limit 200 | repo view --json nameWithOwner -q .nameWithOwner
//           pr list --state open --json number,files,closingIssuesReferences --limit 100
//   S1 (parity; miss and hit)  issue view 8001 | [injected] issue view 0 | issue list --search #8000 #8001 #0 (miss)
//           issue list --search #8000 #8001 (hit) | <linked: i9005,i9006,i9008,i9009,i9010,i9011,i9012,i9013,i9014,
//           i9015,i9001,i9003,i9016> | pr view 5016 --json files | <landing: b8001>
//           api repos/fixture-owner/fixture-repo/compare/main...c0ffee…01 --jq .status   (owner=fixture-owner repo=fixture-repo)
//   S2      <foreign: c0> o0=acme-corp n0=other | <native: i9001,i9030> | <native: i9001> | <linked: i9001>
//   SEmpty  the common calls only (no linked query: no group number)
//   SMalformed, SMalformed('labels')  the queue and open-numbers pulls (and --version), then the stop
//   SMalformed('body')  <linked: i9001> | SMalformed('blocker')  [injected] issue view 99999999999 |
//           issue list --search #99999999999 | <linked: i9001,i9022>
//   SPortable  issue view 8001 | issue list --search #8001 | <linked: i9040,i9041,i9042> | <landing: b8001>
//           api repos/acme-corp/widgets/compare/release/next...c0ffee…01 --jq .status   (owner=acme-corp repo=widgets)
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

// (entries, argv) -> { stdout, stderr, status, effect } | null: an exact-argv entry first, then
// the first graphql entry of the query's kind that answers every alias the query requests. fakeRun
// and the PATH shim's node fallback (graphql, effects, misses) match through it; the sh shim's
// exact, effect-free answers are generated from the same table and pinned to it by the agreement
// test in queue-pull-shims.test.js.
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
      // An entry's own `stdout`/`stderr` replace the data answer (a fault's failure with no data).
      if (stdout !== null) {
        return { stdout: entry.stdout !== undefined ? entry.stdout : stdout, stderr: entry.stderr || '', status: entry.status || 0, effect: entry.effect || null };
      }
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
const OPEN_NUMBERS_ARGV = ['issue', 'list', '--state', 'open', '--json', 'number', '--limit', '200'];
const IN_FLIGHT_ARGV = ['issue', 'list', '--label', 'bot:in-progress', '--state', 'open', '--json', 'number,title,body,labels', '--limit', '200'];
const OPEN_PRS_ARGV = ['pr', 'list', '--state', 'open', '--json', 'number,files,closingIssuesReferences', '--limit', '100'];

// Writes `content` to dir/name and returns the path: the in-process tests' files-transport inputs.
const writeInput = (dir, name, content) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
};

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
      { argv: OPEN_NUMBERS_ARGV, stdout: '[{"number":9001}]\n' },
      { argv: ['--version'], stdout: 'gh version 2.99.0 (qp-shim)\n' },
      {
        graphql: 'linked',
        aliases: { i9001: { number: 9001, state: 'OPEN', closedByPullRequestsReferences: { nodes: [] }, timelineItems: { nodes: [] } } },
      },
      { argv: IN_FLIGHT_ARGV, stdout: '[]\n' },
      { argv: ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], stdout: 'fixture-owner/fixture-repo\n' },
      { argv: OPEN_PRS_ARGV, stdout: '[]\n' },
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
    { argv: IN_FLIGHT_ARGV, stdout: JSON.stringify(inFlight) + '\n' },
    { argv: ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], stdout: 'fixture-owner/fixture-repo\n' },
    { argv: OPEN_PRS_ARGV, stdout: JSON.stringify(openPrs) + '\n' },
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

// #8001's landing answer for preflight-records.js --blocker-landing: closed by a commit that the
// compare API reports as diverged from the integration branch, so #9011 reads `unlanded`.
const LANDING_COMMIT = 'c0ffee0000000000000000000000000000000001';
const LANDING_8001 = {
  number: 8001, state: 'CLOSED', stateReason: 'COMPLETED',
  timelineItems: { nodes: [{ closer: { __typename: 'Commit', oid: LANDING_COMMIT } }] },
  closedByPullRequestsReferences: { pageInfo: { hasNextPage: false }, nodes: [] },
};
const compareArgv = (slug, branch) => ['api', `repos/${slug}/compare/${branch}...${LANDING_COMMIT}`, '--jq', '.status'];

//
// S1({ parity: true }) is pipeline plus the oversized reason, for the AC1 matrix: a size guard of 2,
// and #9001, #9003 and #9016 carry ceremony:fast-lane, so they bundle into one group of 3 that is
// over the guard (it stays in dispatch-groups.json and is named in dispatch-fastlane-bundles.json).
function S1({ full = false, pipeline = false, parity = false } = {}) {
  pipeline = pipeline || parity;
  full = full || pipeline;
  const docsHealth = ['auto:build', 'ready', 'by:docs-health'];
  const fastLane = parity ? { labels: ['auto:build', 'ready', 'ceremony:fast-lane'] } : {};
  const header = (doc) => `**Doc:** ${doc} | **Section:** fixture\n\n`;
  const records = [
    ghRecord(9001, { body: withBody(9001), ...fastLane }),
    ghRecord(9002, { body: `Blocked by #8000\n\n${withBody(9002)}` }),
    ghRecord(9003, { body: withBody(9003), ...fastLane }),
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
      ghRecord(9016, { body: withBody(9016), ...fastLane }),
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
    policy: { 'work-links': 'body-text', ...(parity ? { 'dispatch-group-size-guard': '2' } : {}) },
    origin: pipeline
      ? { branches: { main: { 'docs/present.md': 'present\n' }, 'claims-registry': { 'claims/issue-7001.json': LIVE_CLAIM } } }
      : { branches: { main: {} } },
    linked,
    gh: [
      { argv: QUEUE_ARGV, stdout: JSON.stringify(records) + '\n' },
      { argv: OPEN_NUMBERS_ARGV, stdout: JSON.stringify(openNumbers) + '\n' },
      ...(pipeline ? [
        // #8001 is closed (not an open blocker); #0 is no issue at all, so its state read fails.
        { argv: ['issue', 'view', '8001', '--json', 'state', '-q', '.state'], stdout: 'CLOSED\n' },
        { argv: ['issue', 'view', '0', '--json', 'state', '-q', '.state'], stdout: '', status: 1 },
        { argv: DEP_SEARCH_PIPELINE, stdout: DEP_FRESHNESS_PIPELINE },
        // A queue-order cache hit refetches only the dependencies the blob's freshness signal holds (#0 has no record).
        { argv: DEP_SEARCH_PIPELINE_HIT, stdout: DEP_FRESHNESS_PIPELINE },
        { graphql: 'landing', aliases: { b8001: LANDING_8001 } },
        { argv: compareArgv(REPO_SLUG, 'main'), stdout: 'diverged\n' },
      ] : [{ argv: DEP_SEARCH_8000, stdout: '[{"number":8000,"updatedAt":"2026-11-09T10:00:00Z","state":"OPEN"}]\n' }]),
      ...(full ? [{ argv: ['pr', 'view', '5016', '--json', 'files', '-q', '[.files[].path]'], stdout: JSON.stringify(WEAK_PR_FILES) + '\n' }] : []),
      ...tailGh(survivors, linked, pipeline ? { inFlight: [IN_FLIGHT_7001], openPrs: [OPEN_PR_41] } : {}),
    ],
  };
}

// S2: work-links native. #9030 is natively blocked by open #8100; #9031's body says
// `Blocked by acme-corp/other#12`, an open issue in another repository; #9001 is clean. On gh the
// native edges come from resolve-blockers.js's GraphQL and the foreign state from
// resolve-foreign-blockers.js's; on files from scenario.foreign (DISPATCH_FOREIGN_STATES), while the
// native query fails with no gh, as mcp-transport.md documents.
function S2() {
  const records = [
    ghRecord(9001, { body: withBody(9001) }),
    ghRecord(9030, { body: withBody(9030) }),
    ghRecord(9031, { body: `Blocked by acme-corp/other#12\n\n${withBody(9031)}` }),
  ];
  const repo = { nameWithOwner: REPO_SLUG };
  const nativeNode = (number, blockers) => ({ number, repository: repo, blockedBy: { nodes: blockers.map((n) => ({ number: n, state: 'OPEN', repository: repo })) } });
  return {
    name: 'S2',
    policy: { 'work-links': 'native' },
    origin: { branches: { main: {} } },
    foreign: { 'acme-corp/other#12': 'OPEN' },
    gh: [
      { argv: QUEUE_ARGV, stdout: JSON.stringify(records) + '\n' },
      { argv: OPEN_NUMBERS_ARGV, stdout: JSON.stringify([9001, 9030, 9031, 8100].map((number) => ({ number }))) + '\n' },
      // resolve-foreign-blockers.js's lookup of acme-corp/other#12, aliased c0.
      { graphql: 'foreign', aliases: { c0: { issue: { state: 'OPEN' } } } },
      // resolve-blockers.js (over 9001 and 9030), then preflight-records.js's native read inside
      // dispatch-unlanded-blockers.js (over the survivors): one entry answers both.
      { graphql: 'native', aliases: { i9001: nativeNode(9001, []), i9030: nativeNode(9030, [8100]) } },
      ...tailGh([9001]),
    ],
  };
}

// SEmpty: an empty auto:build queue (AC5.1).
function SEmpty() {
  return {
    name: 'SEmpty',
    policy: { 'work-links': 'body-text' },
    origin: { branches: { main: {} } },
    gh: [
      { argv: QUEUE_ARGV, stdout: '[]\n' },
      { argv: OPEN_NUMBERS_ARGV, stdout: '[]\n' },
      ...tailGh([]),
    ],
  };
}

// SMalformed (AC5.2): #9020's labels is the string "auto:build", #9021's body is the number 42,
// #9022 declares `Blocked by #99999999999` (above 2147483647, so no issue can exist), and #9001 is
// the clean control whose verdict must match the oracle's whatever the other three do. In the
// script, #9020's string labels throw inside the eligibility block (record-vocabulary.js's
// normalizeLabelNames calls .map on it), so the whole pull stops at the group-building check
// before #9021 or #9022 reach any pass. SMalformed(only) keeps #9001 and the one named
// candidate ('labels', 'body' or 'blocker'), so each malformed input reaches its own handling.
const MALFORMED = {
  labels: () => ({ ...ghRecord(9020, { body: withBody(9020) }), labels: 'auto:build' }),
  body: () => ({ ...ghRecord(9021), body: 42 }),
  blocker: () => ghRecord(9022, { body: `Blocked by #99999999999\n\n${withBody(9022)}` }),
};
function SMalformed(only = null) {
  const records = [ghRecord(9001, { body: withBody(9001) }), ...Object.entries(MALFORMED).filter(([k]) => !only || k === only).map(([, make]) => make())];
  const numbers = records.map((r) => r.number);
  return {
    name: only ? `SMalformed-${only}` : 'SMalformed',
    policy: { 'work-links': 'body-text' },
    origin: { branches: { main: {} } },
    gh: [
      { argv: QUEUE_ARGV, stdout: JSON.stringify(records) + '\n' },
      { argv: OPEN_NUMBERS_ARGV, stdout: JSON.stringify(numbers.map((number) => ({ number }))) + '\n' },
      // #9022's blocker is outside the open-numbers pull, so the fence checks it live (it cannot
      // exist) and searches it for the freshness signal (nothing matches).
      { argv: ['issue', 'view', '99999999999', '--json', 'state', '-q', '.state'], stdout: '', stderr: 'GraphQL: Could not resolve to an issue or pull request with the number of 99999999999. (repository.issue)\n', status: 1 },
      { argv: ['issue', 'list', '--search', '#99999999999', '--state', 'all', '--json', 'number,updatedAt,state', '--limit', '500'], stdout: '[]\n' },
      ...tailGh(numbers),
    ],
  };
}

// SPortable: integration-branch release/next (policy), origin's HEAD at trunk and the remote
// https://github.com/acme-corp/widgets.git. #9040 names docs/kept.md (only on release/next), #9041
// names docs/gone.md (only on trunk), and #9042 is blocked by closed #8001 whose commit the compare
// against release/next reports diverged. The branch, the owner and the repo must come from those
// three sources and never from a literal `main` or the fixture slug.
const PORTABLE_SLUG = 'acme-corp/widgets';
function SPortable() {
  const docsHealth = ['auto:build', 'ready', 'by:docs-health'];
  const header = (doc) => `**Doc:** ${doc} | **Section:** fixture\n\n`;
  const records = [
    ghRecord(9040, { body: header('docs/kept.md') + withBody(9040), labels: docsHealth }),
    ghRecord(9041, { body: header('docs/gone.md') + withBody(9041), labels: docsHealth }),
    ghRecord(9042, { body: `Blocked by #8001\n\n${withBody(9042)}` }),
  ];
  const ignore = { '.gitignore': '.claude-tweaks/pipelines/\n' };
  const tail = tailGh([9040, 9041, 9042]).map((e) => (e.argv && e.argv[0] === 'repo' ? { ...e, stdout: `${PORTABLE_SLUG}\n` } : e));
  return {
    name: 'SPortable',
    policy: { 'work-links': 'body-text', 'integration-branch': 'release/next' },
    remoteUrl: `https://github.com/${PORTABLE_SLUG}.git`,
    headBranch: 'trunk',
    origin: { branches: { main: {}, trunk: { ...ignore, 'docs/gone.md': 'on trunk only\n' }, 'release/next': { ...ignore, 'docs/kept.md': 'on release/next only\n' } } },
    gh: [
      { argv: QUEUE_ARGV, stdout: JSON.stringify(records) + '\n' },
      { argv: OPEN_NUMBERS_ARGV, stdout: JSON.stringify([9040, 9041, 9042].map((number) => ({ number }))) + '\n' },
      { argv: ['issue', 'view', '8001', '--json', 'state', '-q', '.state'], stdout: 'CLOSED\n' },
      { argv: ['issue', 'list', '--search', '#8001', '--state', 'all', '--json', 'number,updatedAt,state', '--limit', '500'], stdout: '[{"number":8001,"updatedAt":"2026-11-08T10:00:00Z","state":"CLOSED"}]\n' },
      { graphql: 'landing', aliases: { b8001: LANDING_8001 } },
      { argv: compareArgv(PORTABLE_SLUG, 'release/next'), stdout: 'diverged\n' },
      ...tail,
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
      { argv: OPEN_NUMBERS_ARGV, stdout: '[{"number":9101},{"number":9102},{"number":9103}]\n' },
      ...tailGh([9101, 9102, 9103]),
    ],
  };
}

// --- fault overlays (Task 9: AC4 fetch failures, AC7.2 files inputs, the D1 reproduction) ---------
//
// Each overlay makes one fetch fail on both sides through the shared table: a gh entry with
// `status: 1` (no stdout, an injected stderr line), a `gitFail` prefix the git shim and fakeRun
// both honour, or an `effect` on the call that reaches the step. Every other answer is the base
// scenario's, so a fault run differs from its base only by that fetch.

const PR_VIEW_5016_ARGV = ['pr', 'view', '5016', '--json', 'files', '-q', '[.files[].path]'];
const contentsApiArgv = (n) => ['api', `repos/${REPO_SLUG}/contents/claims/issue-${n}.json?ref=claims-registry`, '-q', '{content: (.content | @base64d), sha: .sha}'];
const GH_FAULT_STDERR = 'gh-fault: injected failure\n';
const NOT_JSON = 'this is not json';

const clone = (scenario) => JSON.parse(JSON.stringify(scenario));
const sameArgv = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

// The gh answer for `argv` fails: no stdout, the injected stderr line, exit 1. An argv the base
// table does not answer is added, so the failing call is answered rather than UNHANDLED.
function failGh(scenario, argv) {
  const failed = { argv, stdout: '', stderr: GH_FAULT_STDERR, status: 1 };
  const known = scenario.gh.some((e) => sameArgv(e.argv, argv));
  scenario.gh = known ? scenario.gh.map((e) => (sameArgv(e.argv, argv) ? failed : e)) : [failed, ...scenario.gh];
  return scenario;
}

// Every graphql entry of `kind` fails with no data: no stdout, the injected stderr line, exit 1.
// (Exit 1 after a data answer is a partial error, which resolve-foreign-blockers.js reads as usable.)
function failGraphql(scenario, kind) {
  scenario.gh = scenario.gh.map((e) => (e.graphql === kind ? { ...e, stdout: '', stderr: GH_FAULT_STDERR, status: 1 } : e));
  return scenario;
}

// `effect` lands on the graphql entry of `kind`, which still answers (exit 0).
function effectOn(scenario, kind, effect) {
  scenario.gh = scenario.gh.map((e) => (e.graphql === kind ? { ...e, effect } : e));
  return scenario;
}

// Adds `record` to the queue and the open-numbers answers, and its linked-PR alias (no PR, no
// mention), so a record a fault lets through reaches the later passes with every call answered.
function withRecord(scenario, record, { open = true } = {}) {
  scenario.gh = scenario.gh.map((e) => {
    if (sameArgv(e.argv, QUEUE_ARGV)) return { ...e, stdout: JSON.stringify([...JSON.parse(e.stdout), record]) + '\n' };
    if (open && sameArgv(e.argv, OPEN_NUMBERS_ARGV)) return { ...e, stdout: JSON.stringify([...JSON.parse(e.stdout), { number: record.number }]) + '\n' };
    if (e.graphql === 'linked') return { ...e, aliases: { ...e.aliases, [`i${record.number}`]: linkedNode(record.number) } };
    return e;
  });
  return scenario;
}

// An OPEN blocker's landing node: the landing check reads it `open` and leaves it to the blocked pass.
const OPEN_LANDING = (number) => ({
  number, state: 'OPEN', stateReason: null, timelineItems: { nodes: [] }, closedByPullRequestsReferences: { pageInfo: { hasNextPage: false }, nodes: [] },
});

// S1({ parity: true }) with #8000 outside the open-numbers pull, so the fence checks it live with
// `gh issue view 8000` (answered OPEN, so #9002 is held). `viewFails` makes that view fail: #9002
// then passes the blocked pass, so it is also given its linked-PR alias and #8000 its landing node.
// (The brief's `issue view 8100` is S2's native blocker, which S2's open-numbers pull answers and
// whose body-text dependency no record declares; #8000 is the body-text dependency that reaches
// this loop.)
function S1LiveDep({ viewFails = false } = {}) {
  const s = S1({ parity: true });
  const view = ['issue', 'view', '8000', '--json', 'state', '-q', '.state'];
  s.gh = s.gh.map((e) => (sameArgv(e.argv, OPEN_NUMBERS_ARGV)
    ? { ...e, stdout: JSON.stringify(JSON.parse(e.stdout).filter((r) => r.number !== 8000)) + '\n' } : e));
  s.gh.unshift({ argv: view, stdout: 'OPEN\n' });
  if (!viewFails) return s;
  failGh(s, view);
  s.gh = s.gh.map((e) => {
    if (e.graphql === 'linked') return { ...e, aliases: { ...e.aliases, i9002: linkedNode(9002) } };
    if (e.graphql === 'landing') return { ...e, aliases: { ...e.aliases, b8000: OPEN_LANDING(8000) } };
    return e;
  });
  return s;
}

// FAULTS (gh transport): { id, pass, scenario(), warm? }. `pass` is the PASSES id whose fetch the
// fault fails ('(stop)' for the two effects that make a step's input unreadable). `warm` runs it
// after a clean miss of the same base, each side copying its own origin (the queue-order blob).
const P1 = () => S1({ parity: true });
const FAULTS = [
  { id: 'F-queue', pass: 'fetch', scenario: () => failGh(P1(), QUEUE_ARGV) },
  { id: 'F-opennum', pass: 'fetch', scenario: () => failGh(P1(), OPEN_NUMBERS_ARGV) },
  { id: 'F-depfresh', pass: 'fetch', warm: true, scenario: () => failGh(P1(), DEP_SEARCH_PIPELINE_HIT) },
  { id: 'F-depview', pass: 'blocked', scenario: () => S1LiveDep({ viewFails: true }) },
  {
    id: 'F-native', pass: 'blocked',
    // #9030 is natively blocked only through the failing query, so it survives to the later
    // passes: its linked-PR alias is answered.
    scenario: () => {
      const s = failGraphql(S2(), 'native');
      s.gh = s.gh.map((e) => (e.graphql === 'linked' ? { ...e, aliases: { ...e.aliases, i9030: linkedNode(9030) } } : e));
      return s;
    },
  },
  { id: 'F-foreign', pass: 'blocked', scenario: () => failGraphql(S2(), 'foreign') },
  { id: 'F-linked', pass: 'open-pr', scenario: () => failGraphql(P1(), 'linked') },
  {
    id: 'F-intbranch', pass: 'target-missing',
    // #9017 names docs/present.md, which origin/main holds: only the unresolved branch excludes it.
    scenario: () => Object.assign(withRecord(P1(), ghRecord(9017, {
      body: `**Doc:** docs/present.md | **Section:** fixture\n\n${withBody(9017)}`, labels: ['auto:build', 'ready', 'by:docs-health'],
    })), { gitFail: [['remote', 'show', 'origin']] }),
  },
  { id: 'F-prview', pass: 'shipped', scenario: () => failGh(P1(), PR_VIEW_5016_ARGV) },
  { id: 'F-landing', pass: 'blocker-landing', scenario: () => failGraphql(P1(), 'landing') },
  { id: 'F-inflight', pass: 'neighbour-in-flight', scenario: () => failGh(P1(), IN_FLIGHT_ARGV) },
  {
    id: 'F-claim', pass: 'neighbour-in-flight',
    // The claim reader's git-CAS fetch, then its contents-API fallback, for every claim the pull
    // reads (the shipped pass's release times for #9010 and #9016, the neighbour pass's #7001).
    scenario: () => {
      const s = P1();
      for (const n of [7001, 9010, 9016]) failGh(s, contentsApiArgv(n));
      return Object.assign(s, { gitFail: [['fetch', '-q', 'origin']] });
    },
  },
  { id: 'F-openprs', pass: 'cross-pr-overlap', scenario: () => failGh(P1(), OPEN_PRS_ARGV) },
  { id: 'F-writeback', pass: 'write-back', scenario: () => Object.assign(P1(), { gitFail: [['push']] }) },
  { id: 'F-corrupt', pass: '(stop)', scenario: () => effectOn(P1(), 'linked', 'corrupt-exclusions') },
  { id: 'F-groups', pass: '(stop)', scenario: () => effectOn(P1(), 'linked', 'corrupt-groups') },
];

// FILES_FAULTS (files transport): { id, input, mode, pass, scenario(), agent(base agent files) ->
// agent files, warm? }. `missing` leaves the file unwritten (the agent wrote none), `malformed`
// writes NOT_JSON; the queue's `wrapper` (D3), the claim map's `non-JSON string` (D4) and the
// agent-written `[]` / `{}` values are the shapes the Plan Review Clarifications name.
const withAgent = (name, content) => (files) => {
  const out = { ...files };
  if (content === undefined) delete out[name];
  else out[name] = content;
  return out;
};
const FILES_INPUTS = [
  { input: 'queueRaw', file: 'dispatch-queue-raw.json', pass: 'fetch' },
  { input: 'depFreshness', file: 'dispatch-dep-freshness.json', pass: 'fetch', warm: true },
  { input: 'openNumbers', file: 'dispatch-open-numbers.json', pass: 'fetch' },
  { input: 'verifiedOpenDeps', file: 'dispatch-verified-open-deps.txt', pass: 'blocked', scenario: () => S1LiveDep() },
  { input: 'inFlightRaw', file: 'dispatch-in-flight-raw.json', pass: 'neighbour-in-flight' },
  { input: 'inFlightClaims', file: 'dispatch-in-flight-claims.json', pass: 'neighbour-in-flight' },
];
const FILES_FAULTS = [];
for (const { input, file, pass, warm, scenario = P1 } of FILES_INPUTS) {
  for (const [mode, content] of [['missing', undefined], ['malformed', NOT_JSON]]) {
    FILES_FAULTS.push({ id: `files-${input}-${mode}`, input, mode, pass, warm: Boolean(warm), scenario, agent: withAgent(file, content) });
  }
}
FILES_FAULTS.push(
  // The same missing file on a cold cache: only the write-back's search point reads it (the
  // in-process twin is the files dependency-freshness test's third block).
  { id: 'files-depFreshness-missing-cold', input: 'depFreshness', mode: 'missing (cold cache)', pass: 'fetch', warm: false, scenario: P1, agent: withAgent('dispatch-dep-freshness.json', undefined) },
  { id: 'files-queueRaw-wrapper', input: 'queueRaw', mode: 'wrapper', pass: 'fetch', scenario: P1,
    agent: (files) => ({ ...files, 'dispatch-queue-raw.json': JSON.stringify({ issues: JSON.parse(files['dispatch-queue-raw.json']) }) }) },
  { id: 'files-inFlightRaw-empty', input: 'inFlightRaw', mode: 'empty []', pass: 'neighbour-in-flight', scenario: P1, agent: withAgent('dispatch-in-flight-raw.json', '[]') },
  { id: 'files-inFlightClaims-empty', input: 'inFlightClaims', mode: 'empty {}', pass: 'neighbour-in-flight', scenario: P1, agent: withAgent('dispatch-in-flight-claims.json', '{}') },
  { id: 'files-inFlightClaims-string', input: 'inFlightClaims', mode: 'non-JSON string', pass: 'neighbour-in-flight', scenario: P1,
    agent: withAgent('dispatch-in-flight-claims.json', JSON.stringify({ 7001: NOT_JSON })) },
  // DISPATCH_FOREIGN_STATES (S2): scenario.foreign null names a file the agent never wrote; a
  // string is written as is.
  { id: 'files-foreignStates-missing', input: 'foreignStates', mode: 'missing', pass: 'blocked', scenario: () => Object.assign(S2(), { foreign: null }), agent: (f) => f },
  { id: 'files-foreignStates-malformed', input: 'foreignStates', mode: 'malformed', pass: 'blocked', scenario: () => Object.assign(S2(), { foreign: NOT_JSON }), agent: (f) => f },
);

// D1: two pulls in one session. The second's open-numbers fetch returns nothing (exit 1), and
// #9003 changed since the first (a new title and updatedAt, so the queue-order cache misses).
function D1Second() {
  const s = failGh(S1(), OPEN_NUMBERS_ARGV);
  s.gh = s.gh.map((e) => (sameArgv(e.argv, QUEUE_ARGV)
    ? { ...e, stdout: JSON.stringify(JSON.parse(e.stdout).map((r) => (r.number === 9003 ? { ...r, title: 'Retitled after the first pull', updatedAt: '2026-11-12T11:00:00Z' } : r))) + '\n' }
    : e));
  return s;
}

// The in-process twin of the policy / blocker CLIs the passes spawn: resolve-policy.js answers
// as the real CLI's --values does, scenario.policy's value, else the key's schema default, else the
// empty line (pinned against the real CLI by the real-writer test); any other CLI needs an
// override, a result object or (args, opts) => result. The returned function records `.calls`
// ({name, args}).
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
      // Lazy: the gh shim's node fallback re-enters this file and never answers a policy read.
      const { POLICY_KEYS } = require('../../../plugin/bin/lib/policy-schema');
      const set = (scenario.policy || {})[key];
      const entry = POLICY_KEYS.find((k) => k.key === key);
      const value = set !== undefined ? set : entry && entry.default;
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

// --- the files transport's agent-fetched inputs ----------------------------------------------------

const ghStdout = (scenario, argv) => {
  const entry = (scenario.gh || []).find((e) => Array.isArray(e.argv) && e.argv.join('\u0000') === argv.join('\u0000'));
  return entry ? entry.stdout : null;
};

// A gh-shaped issue as the MCP list_issues/issue_read tools return it (Review Focus 5): labels as
// [{name}], a lowercase state, snake_case timestamps. A non-array labels value is passed through.
function mcpShape(issue) {
  const { createdAt, updatedAt, labels, state, ...rest } = issue;
  const out = { ...rest };
  if (labels !== undefined) out.labels = Array.isArray(labels) ? labels.map((l) => ({ name: l.name })) : labels;
  if (state !== undefined) out.state = typeof state === 'string' ? state.toLowerCase() : state;
  if (createdAt !== undefined) out.created_at = createdAt;
  if (updatedAt !== undefined) out.updated_at = updatedAt;
  return out;
}

// scenario -> { <session file name>: content }: what the agent writes on the files transport
// (mcp-transport.md), derived from the same gh table the gh configs answer from, in MCP shape. The
// queue, open-numbers, verified-open-deps, in-flight pool and claims map are always written (the
// claims map as {} when no claim is fixtured); the dependency-freshness file only when the table
// answers a dependency search, as the agent fetches it only when there are dependencies to fetch.
function agentInputs(scenario) {
  const out = {};
  const queue = ghStdout(scenario, QUEUE_ARGV);
  out['dispatch-queue-raw.json'] = JSON.stringify(JSON.parse(queue).map(mcpShape));
  out['dispatch-open-numbers.json'] = ghStdout(scenario, OPEN_NUMBERS_ARGV);
  const search = (scenario.gh || []).find((e) => Array.isArray(e.argv) && e.argv[0] === 'issue' && e.argv[2] === '--search');
  if (search) out['dispatch-dep-freshness.json'] = JSON.stringify(JSON.parse(search.stdout).map(mcpShape));
  out['dispatch-verified-open-deps.txt'] = (scenario.gh || [])
    .filter((e) => Array.isArray(e.argv) && e.argv[0] === 'issue' && e.argv[1] === 'view' && !e.status && String(e.stdout).trim() === 'OPEN')
    .map((e) => `${e.argv[2]}\n`).join('');
  const inFlight = ghStdout(scenario, IN_FLIGHT_ARGV);
  out['dispatch-in-flight-raw.json'] = JSON.stringify(JSON.parse(inFlight || '[]').map(mcpShape));
  const registry = (scenario.origin && scenario.origin.branches && scenario.origin.branches['claims-registry']) || {};
  const claims = {};
  for (const [file, content] of Object.entries(registry)) {
    const m = file.match(/^claims\/issue-(\d+)\.json$/);
    if (m) claims[m[1]] = content;
  }
  out['dispatch-in-flight-claims.json'] = JSON.stringify(claims);
  return out;
}

module.exports = {
  DEFAULT_REMOTE_URL, GRAPHQL_KINDS, ghAnswer, applyEffect, gitSubArgv, gitFailMatch, isGetUrlOrigin, shimTable, fakeRun,
  ghLabel, ghRecord, SPEC_BODY, QUEUE_ARGV, OPEN_NUMBERS_ARGV, IN_FLIGHT_ARGV, OPEN_PRS_ARGV, writeInput, DEP_SEARCH_8000, withBody, S0, S1, S2, SEmpty, SMalformed, SPortable, SFast, fakeSpawnCli, agentInputs,
  LANDING_COMMIT, PORTABLE_SLUG,
  REPO_SLUG, linkedNode, linkedOutput, mention, WEAK_PR_FILES, tailGh, IN_FLIGHT_7001, OPEN_PR_41, LIVE_CLAIM,
  FAULTS, FILES_FAULTS, D1Second, S1LiveDep, failGh, NOT_JSON, GH_FAULT_STDERR, contentsApiArgv,
};
