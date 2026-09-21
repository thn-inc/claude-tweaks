'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const feedback = require('../../../plugin/bin/lib/feedback/file-feedback');
const { run, parseArgs, parseRepo, validateDraft, realDeps } = require('../../../plugin/bin/file-feedback');

// Fake runners are lazy functions inspecting `args` only when called (CLAUDE.md's
// eager-IIFE ban) and throw on any unhandled args shape rather than silently
// returning something wrong — matching tests/bin-lib/issues/link.test.js's convention.
const isList = (args) => args[0] === 'issue' && args[1] === 'list';
const isCreate = (args) => args[0] === 'issue' && args[1] === 'create';
const isView = (args) => args[0] === 'issue' && args[1] === 'view';
const flagValue = (args, flag) => { const i = args.indexOf(flag); return i === -1 ? undefined : args[i + 1]; };

function makeDraft(overrides = {}) {
  return {
    title: 'Skill X ignores the --scope flag',
    body: 'When run with --scope narrow, the flag is silently ignored.\n<!-- fingerprint: placeholder -->',
    labels: ['bug'],
    fingerprintBasis: { component: 'skills/x', summary: 'ignores --scope flag' },
    ...overrides,
  };
}

// ---- computeFingerprint --------------------------------------------------

test('computeFingerprint: returns feedback-{8 hex}', () => {
  const fp = feedback.computeFingerprint(makeDraft());
  assert.match(fp, /^feedback-[0-9a-f]{8}$/);
});

test('computeFingerprint: summary differing only in whitespace/case yields the same fingerprint', () => {
  const a = feedback.computeFingerprint(makeDraft({ fingerprintBasis: { component: 'skills/x', summary: 'Ignores   --scope Flag' } }));
  const b = feedback.computeFingerprint(makeDraft({ fingerprintBasis: { component: 'skills/x', summary: 'ignores --scope flag' } }));
  assert.equal(a, b);
});

test('computeFingerprint: a component change (not normalized) still changes the fingerprint', () => {
  const a = feedback.computeFingerprint(makeDraft({ fingerprintBasis: { component: 'skills/x', summary: 'ignores --scope flag' } }));
  const b = feedback.computeFingerprint(makeDraft({ fingerprintBasis: { component: 'skills/y', summary: 'ignores --scope flag' } }));
  assert.notEqual(a, b);
});

test('computeFingerprint: throws when fingerprintBasis.component is missing or empty', () => {
  assert.throws(() => feedback.computeFingerprint(makeDraft({ fingerprintBasis: { summary: 'x' } })), /fingerprintBasis must include both component and summary/);
  assert.throws(() => feedback.computeFingerprint(makeDraft({ fingerprintBasis: { component: '', summary: 'x' } })), /fingerprintBasis must include both component and summary/);
});

test('computeFingerprint: throws when fingerprintBasis.summary is missing or empty', () => {
  assert.throws(() => feedback.computeFingerprint(makeDraft({ fingerprintBasis: { component: 'skills/x' } })), /fingerprintBasis must include both component and summary/);
  assert.throws(() => feedback.computeFingerprint(makeDraft({ fingerprintBasis: { component: 'skills/x', summary: '' } })), /fingerprintBasis must include both component and summary/);
});

// ---- embedFingerprint -----------------------------------------------------

test('embedFingerprint: replaces the literal pre-fix [object Object] placeholder wholesale', () => {
  const body = 'Some description.\n<!-- fingerprint: [object Object] -->\nMore text.';
  const result = feedback.embedFingerprint(body, 'feedback-abc12345');
  assert.doesNotMatch(result, /\[object Object\]/);
  assert.match(result, /<!-- fingerprint: feedback-abc12345 -->/);
  assert.match(result, /Some description\./);
  assert.match(result, /More text\./);
});

test('embedFingerprint: replaces an existing well-formed fingerprint line', () => {
  const body = 'Body text.\n<!-- fingerprint: feedback-00000000 -->\n';
  const result = feedback.embedFingerprint(body, 'feedback-deadbeef');
  assert.doesNotMatch(result, /feedback-00000000/);
  assert.match(result, /<!-- fingerprint: feedback-deadbeef -->/);
});

test('embedFingerprint: appends the fingerprint line when none exists', () => {
  const body = 'Body text with no fingerprint comment.';
  const result = feedback.embedFingerprint(body, 'feedback-cafef00d');
  assert.match(result, /Body text with no fingerprint comment\.\n<!-- fingerprint: feedback-cafef00d -->\n$/);
});

test('#1435: a replacement line containing $` survives composition intact (function replacer, not string replacer)', () => {
  // Regression for the String.replace self-splicing bug: a raw `$`-prefixed
  // sequence in a *string* replacement argument is a splice directive, not
  // literal text ('abc'.replace('b', '$`') === 'aac', not 'a$`c'). fingerprint
  // values are always hex today, so this can't fire in practice yet — but the
  // fix (a function replacer) must hold regardless of what embedFingerprint is
  // ever called with.
  const body = 'Some preceding text.\n<!-- fingerprint: placeholder -->\nMore text.';
  const hostileFingerprint = '$`$&$$';
  const result = feedback.embedFingerprint(body, hostileFingerprint);
  assert.match(result, /<!-- fingerprint: \$`\$&\$\$ -->/, 'a string replacer would corrupt $-pattern sequences ($` splices preceding text, $& inserts the match)');
  assert.doesNotMatch(result, /Some preceding text\.\s*Some preceding text\./, 'the preceding text must not be spliced back in');
});

// ---- fileDraft: argv-safe title -------------------------------------------

test('fileDraft: a title with backtick, $(...), and single quote round-trips as one argv element', () => {
  const dangerousTitle = "Bug: `whoami` $(rm -rf /) it's broken";
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (isCreate(args)) return 'https://github.com/acme/w/issues/123\n';
    throw new Error('unexpected ' + args.join(' '));
  };
  const writes = [];
  const writeFile = (path, content) => writes.push({ path, content });
  const number = feedback.fileDraft({
    repo: 'acme/w', title: dangerousTitle, body: 'body text', labels: ['bug'],
    runner, bodyFile: '/fake/tmp/body.md', writeFile,
  });
  assert.equal(number, 123);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes(dangerousTitle), 'the exact dangerous title string must appear as one argv element');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/fake/tmp/body.md');
  assert.equal(writes[0].content, 'body text');
});

// ---- isTransientFailure / withTransientRetry -------------------------------

test('isTransientFailure: matches a 5xx status, a timeout, and a connection reset', () => {
  assert.equal(feedback.isTransientFailure(new Error('HTTP 503: No server is currently available')), true);
  assert.equal(feedback.isTransientFailure({ stderr: 'gh: ETIMEDOUT' }), true);
  assert.equal(feedback.isTransientFailure({ stderr: 'read ECONNRESET' }), true);
});

test('isTransientFailure: a plain 403/429 (rate-limit shape) is not transient here', () => {
  // _shared/github-rate-limit.md owns rate-limit classification (403/429);
  // this file's retry is deliberately narrower — a plain 403 must not retry.
  assert.equal(feedback.isTransientFailure(new Error('HTTP 403: rate limited')), false);
  assert.equal(feedback.isTransientFailure(new Error('HTTP 429: too many requests')), false);
});

test('withTransientRetry: a transient failure followed by success retries once after sleeping', () => {
  let calls = 0;
  const runner = (args) => {
    calls++;
    if (calls === 1) { const e = new Error('HTTP 503: No server is currently available'); throw e; }
    return 'ok';
  };
  const sleeps = [];
  const wrapped = feedback.withTransientRetry(runner, { waitMs: 15000, sleep: (ms) => sleeps.push(ms) });
  const result = wrapped(['issue', 'list']);
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [15000]);
});

test('withTransientRetry: two consecutive transient failures rethrows the second (retry once, not indefinitely)', () => {
  let calls = 0;
  const runner = () => { calls++; throw new Error('HTTP 503: No server is currently available'); };
  const sleeps = [];
  const wrapped = feedback.withTransientRetry(runner, { sleep: (ms) => sleeps.push(ms) });
  assert.throws(() => wrapped(['issue', 'list']), /503/);
  assert.equal(calls, 2);
  assert.equal(sleeps.length, 1);
});

test('withTransientRetry: a non-transient failure is rethrown immediately, no sleep', () => {
  let calls = 0;
  const runner = () => { calls++; throw new Error('HTTP 403: rate limited'); };
  const sleeps = [];
  const wrapped = feedback.withTransientRetry(runner, { sleep: (ms) => sleeps.push(ms) });
  assert.throws(() => wrapped(['issue', 'list']), /403/);
  assert.equal(calls, 1);
  assert.equal(sleeps.length, 0);
});

// ---- fileOne ---------------------------------------------------------------

test('fileOne: dedup hit skips filing entirely', () => {
  const draft = makeDraft();
  const fp = feedback.computeFingerprint(draft);
  const marker = `<!-- fingerprint: ${fp} -->`;
  const createCalls = [];
  const runner = (args) => {
    if (isList(args)) {
      assert.equal(args.includes('--search'), false, 'must not send --search — eventually-consistent search index');
      return JSON.stringify([{ number: 501, title: 'existing dup', body: `some body\n${marker}\n`, createdAt: '2026-01-01T00:00:00Z' }]);
    }
    if (isCreate(args)) { createCalls.push(args); throw new Error('must not call issue create on a dedup hit'); }
    throw new Error('unexpected ' + args.join(' '));
  };
  const result = feedback.fileOne({ repo: 'acme/w', draft, runner, bodyFile: '/fake/body.md', writeFile: () => {} });
  assert.deepEqual(result, { status: 'dedup-hit', number: 501 });
  assert.equal(createCalls.length, 0);
});

test('findDuplicate: sends a plain list call with no --search flag, per github-write-transport.md', () => {
  const marker = '<!-- fingerprint: feedback-deadbeef -->';
  const runner = (args) => {
    assert.deepEqual(args, ['issue', 'list', '--repo', 'acme/w', '--state', 'all', '--json', 'number,title,body,createdAt', '--limit', '10000']);
    return JSON.stringify([]);
  };
  const result = feedback.findDuplicate({ repo: 'acme/w', marker, runner });
  assert.equal(result, null);
});

test('findDuplicate: an unrelated marker present in the list does not count as a hit — filtering is real, not incidental', () => {
  const marker = '<!-- fingerprint: feedback-deadbeef -->';
  const runner = () => JSON.stringify([
    { number: 1, title: 'unrelated', body: '<!-- fingerprint: feedback-00000000 -->', createdAt: '2026-01-01T00:00:00Z' },
  ]);
  const result = feedback.findDuplicate({ repo: 'acme/w', marker, runner });
  assert.equal(result, null);
});

// #1564: findDuplicate's unscoped `--state all --limit 10000` list pulls
// full issue bodies for every issue in the repo; on a repo with 1,500+
// issues the combined body text alone exceeds execFileSync's default 1MB
// maxBuffer, so `gh` output never reaches findByMarker at all — every
// filing dies with `spawnSync gh ENOBUFS` before dedup can even run.
// Fixture below shapes a 1,500-issue, multi-KB-body list (~4.5MB) —
// at or above the observed failure threshold.
function largeIssueListScript(count, bodyBytes) {
  return `const a=[];for(let i=0;i<${count};i++){a.push({number:i,title:'t'+i,body:'x'.repeat(${bodyBytes}),createdAt:'2026-01-01T00:00:00Z'});}process.stdout.write(JSON.stringify(a));`;
}

test('#1564: a 1,500-issue full-body list reproduces ENOBUFS at Node\'s default maxBuffer', () => {
  assert.throws(() => {
    execFileSync('node', ['-e', largeIssueListScript(1500, 3000)], { encoding: 'utf8' });
  }, /ENOBUFS|maxBuffer/);
});

test('#1564: GH_MAX_BUFFER comfortably covers the same 1,500-issue full-body list', () => {
  // Pin the export's presence/adequacy first — execFileSync treats an
  // explicit `maxBuffer: undefined` as "no limit" (not "use the 1MB
  // default"), so without this guard the call below would still succeed
  // even if GH_MAX_BUFFER were removed, silently defeating the test.
  assert.equal(typeof feedback.GH_MAX_BUFFER, 'number');
  assert.ok(feedback.GH_MAX_BUFFER > 5 * 1024 * 1024, `GH_MAX_BUFFER (${feedback.GH_MAX_BUFFER}) must exceed the ~4.5MB fixture size`);
  const out = execFileSync('node', ['-e', largeIssueListScript(1500, 3000)], {
    encoding: 'utf8',
    maxBuffer: feedback.GH_MAX_BUFFER,
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.length, 1500);
});

test('fileOne: read-back title mismatch surfaces filing-failure with a mismatch reason', () => {
  const draft = makeDraft();
  const fp = feedback.computeFingerprint(draft);
  const marker = `<!-- fingerprint: ${fp} -->`;
  const runner = (args) => {
    if (isList(args)) return JSON.stringify([]);
    if (isCreate(args)) return 'https://github.com/acme/w/issues/777\n';
    if (isView(args)) return JSON.stringify({ title: 'a completely different title', body: `filed body\n${marker}\n` });
    throw new Error('unexpected ' + args.join(' '));
  };
  const result = feedback.fileOne({ repo: 'acme/w', draft, runner, bodyFile: '/fake/body.md', writeFile: () => {} });
  assert.equal(result.status, 'filing-failure');
  assert.equal(result.number, 777);
  assert.match(result.reason, /title mismatch/);
});

test('fileOne: read-back body missing the fingerprint comment surfaces filing-failure', () => {
  const draft = makeDraft();
  const runner = (args) => {
    if (isList(args)) return JSON.stringify([]);
    if (isCreate(args)) return 'https://github.com/acme/w/issues/778\n';
    if (isView(args)) return JSON.stringify({ title: draft.title, body: 'filed body with no fingerprint comment at all' });
    throw new Error('unexpected ' + args.join(' '));
  };
  const result = feedback.fileOne({ repo: 'acme/w', draft, runner, bodyFile: '/fake/body.md', writeFile: () => {} });
  assert.equal(result.status, 'filing-failure');
  assert.match(result.reason, /fingerprint marker missing/);
});

test('fileOne: clean path (dedup miss, create succeeds, read-back matches) files the issue', () => {
  const draft = makeDraft();
  const fp = feedback.computeFingerprint(draft);
  const marker = `<!-- fingerprint: ${fp} -->`;
  const runner = (args) => {
    if (isList(args)) return JSON.stringify([]);
    if (isCreate(args)) return 'https://github.com/acme/w/issues/900\n';
    if (isView(args)) return JSON.stringify({ title: draft.title, body: `filed body\n${marker}\n` });
    throw new Error('unexpected ' + args.join(' '));
  };
  const result = feedback.fileOne({ repo: 'acme/w', draft, runner, bodyFile: '/fake/body.md', writeFile: () => {} });
  assert.deepEqual(result, { status: 'filed', number: 900 });
});

// ---- CLI: run(argv, deps) ---------------------------------------------------

function cliDeps({ runner, ghAvailable = true, remoteUrl = 'https://github.com/acme/w.git', readDraftsFile }) {
  const out = []; const err = []; const writes = [];
  return {
    deps: {
      runner,
      ghAvailable: () => ghAvailable,
      remoteUrl: () => remoteUrl,
      readDraftsFile: readDraftsFile || (() => { throw new Error('must not read a drafts file'); }),
      tmpFile: () => '/fake/tmp/body.md',
      writeFile: (path, content) => writes.push({ path, content }),
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    },
    out, err, writes,
  };
}

test('CLI: 2-draft batch with a dedup-hit and a clean file exits 0, one line per draft in order', () => {
  const draftA = makeDraft({ title: 'Draft A: dup already filed', fingerprintBasis: { component: 'skills/a', summary: 'dup finding' } });
  const draftB = makeDraft({ title: 'Draft B: files cleanly', fingerprintBasis: { component: 'skills/b', summary: 'fresh finding' } });
  const fpA = feedback.computeFingerprint(draftA);
  const fpB = feedback.computeFingerprint(draftB);
  const markerA = `<!-- fingerprint: ${fpA} -->`;
  const markerB = `<!-- fingerprint: ${fpB} -->`;
  const runner = (args) => {
    if (isList(args)) {
      assert.equal(args.includes('--search'), false);
      // markerA already has a filed issue; markerB doesn't — one combined
      // list covers both drafts' dedup checks, since there's no more
      // per-draft --search call to key branching off.
      return JSON.stringify([{ number: 601, title: 'existing', body: `body\n${markerA}\n`, createdAt: '2026-01-01T00:00:00Z' }]);
    }
    if (isCreate(args)) {
      assert.equal(flagValue(args, '--title'), draftB.title);
      return 'https://github.com/acme/w/issues/602\n';
    }
    if (isView(args)) return JSON.stringify({ title: draftB.title, body: `body\n${markerB}\n` });
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out } = cliDeps({ runner, readDraftsFile: () => [draftA, draftB] });
  const code = run(['--drafts', 'drafts.json', '--repo', 'acme/w'], deps);
  assert.equal(code, 0);
  const lines = out.join('').trim().split('\n');
  assert.deepEqual(lines, ['dedup-hit #601', 'filed #602']);
});

// #2240: a GitHub Enterprise Server remote's `repo` value is repoSlug's
// host-qualified `{host}/{owner}/{repo}` for gh's `-R/--repo` flag — a bare
// `owner/repo` (repoSpec.host discarded) would silently target github.com.
test('#2240: a GitHub Enterprise Server remote passes the host-qualified --repo value to every gh call', () => {
  const draft = makeDraft();
  const fp = feedback.computeFingerprint(draft);
  const marker = `<!-- fingerprint: ${fp} -->`;
  const repos = [];
  const runner = (args) => {
    repos.push(flagValue(args, '--repo'));
    if (isList(args)) return JSON.stringify([]);
    if (isCreate(args)) return 'https://ghe.example.com/acme/w/issues/900\n';
    if (isView(args)) return JSON.stringify({ title: draft.title, body: `body\n${marker}\n` });
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out } = cliDeps({ runner, remoteUrl: 'https://ghe.example.com/acme/w.git', readDraftsFile: () => [draft] });
  const code = run(['--drafts', 'drafts.json'], deps);
  assert.equal(code, 0);
  assert.deepEqual(out.join('').trim().split('\n'), ['filed #900']);
  assert.ok(repos.length > 0);
  for (const r of repos) assert.equal(r, 'ghe.example.com/acme/w');
});

// #2444 review fix: a caller-supplied --repo can itself already be a
// host-qualified `host/owner/repo` slug (repoSlug()'s GHE output), not just
// the bare `owner/repo` form the #2240 test above exercises via the git
// remote path. Before this fix, --repo was always prefixed with
// `github.com/` regardless of shape, producing an unparseable 4-segment
// string for a slug like this.
test('#2444 fix: a host-qualified --repo flag value passes through to every gh call', () => {
  const draft = makeDraft();
  const fp = feedback.computeFingerprint(draft);
  const marker = `<!-- fingerprint: ${fp} -->`;
  const repos = [];
  const runner = (args) => {
    repos.push(flagValue(args, '--repo'));
    if (isList(args)) return JSON.stringify([]);
    if (isCreate(args)) return 'https://ghe.example.com/acme/w/issues/900\n';
    if (isView(args)) return JSON.stringify({ title: draft.title, body: `body\n${marker}\n` });
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out } = cliDeps({ runner, readDraftsFile: () => [draft] });
  const code = run(['--drafts', 'drafts.json', '--repo', 'ghe.example.com/acme/w'], deps);
  assert.equal(code, 0);
  assert.deepEqual(out.join('').trim().split('\n'), ['filed #900']);
  assert.ok(repos.length > 0);
  for (const r of repos) assert.equal(r, 'ghe.example.com/acme/w');
});

test('#2444 fix: a bare --repo owner/repo flag value still resolves to github.com (unchanged)', () => {
  const draft = makeDraft();
  const fp = feedback.computeFingerprint(draft);
  const marker = `<!-- fingerprint: ${fp} -->`;
  const repos = [];
  const runner = (args) => {
    repos.push(flagValue(args, '--repo'));
    if (isList(args)) return JSON.stringify([]);
    if (isCreate(args)) return 'https://github.com/acme/w/issues/901\n';
    if (isView(args)) return JSON.stringify({ title: draft.title, body: `body\n${marker}\n` });
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out } = cliDeps({ runner, readDraftsFile: () => [draft] });
  const code = run(['--drafts', 'drafts.json', '--repo', 'acme/w'], deps);
  assert.equal(code, 0);
  assert.deepEqual(out.join('').trim().split('\n'), ['filed #901']);
  assert.ok(repos.length > 0);
  for (const r of repos) assert.equal(r, 'acme/w');
});

test('CLI: a read-back mismatch in one draft exits 1 but still reports the sibling clean draft', () => {
  const draftA = makeDraft({ title: 'Draft A: will mismatch', fingerprintBasis: { component: 'skills/a', summary: 'mismatch finding' } });
  const draftB = makeDraft({ title: 'Draft B: files cleanly', fingerprintBasis: { component: 'skills/b', summary: 'clean finding' } });
  const fpB = feedback.computeFingerprint(draftB);
  const markerB = `<!-- fingerprint: ${fpB} -->`;
  const runner = (args) => {
    if (isList(args)) return JSON.stringify([]);
    if (isCreate(args)) {
      const title = flagValue(args, '--title');
      if (title === draftA.title) return 'https://github.com/acme/w/issues/701\n';
      if (title === draftB.title) return 'https://github.com/acme/w/issues/702\n';
      throw new Error('unexpected title ' + title);
    }
    if (isView(args)) {
      const number = args[2];
      if (number === '701') return JSON.stringify({ title: 'a totally different title', body: 'irrelevant body' });
      if (number === '702') return JSON.stringify({ title: draftB.title, body: `body\n${markerB}\n` });
      throw new Error('unexpected view number ' + number);
    }
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out } = cliDeps({ runner, readDraftsFile: () => [draftA, draftB] });
  const code = run(['--drafts', 'drafts.json', '--repo', 'acme/w'], deps);
  assert.equal(code, 1);
  const lines = out.join('').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^filing-failure: .*title mismatch/);
  assert.equal(lines[1], 'filed #702');
});

test('CLI --dry-run: zero create calls across a multi-draft batch; reports would-file / dedup-hit', () => {
  const draftA = makeDraft({ title: 'Draft A', fingerprintBasis: { component: 'skills/a', summary: 'dup finding' } });
  const draftB = makeDraft({ title: 'Draft B', fingerprintBasis: { component: 'skills/b', summary: 'fresh finding' } });
  const fpA = feedback.computeFingerprint(draftA);
  const fpB = feedback.computeFingerprint(draftB);
  const markerA = `<!-- fingerprint: ${fpA} -->`;
  const markerB = `<!-- fingerprint: ${fpB} -->`;
  const createCalls = [];
  const runner = (args) => {
    if (isList(args)) {
      assert.equal(args.includes('--search'), false);
      return JSON.stringify([{ number: 801, title: 'existing', body: `body\n${markerA}\n`, createdAt: '2026-01-01T00:00:00Z' }]);
    }
    if (isCreate(args)) { createCalls.push(args); throw new Error('must not call issue create under --dry-run'); }
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out } = cliDeps({ runner, readDraftsFile: () => [draftA, draftB] });
  const code = run(['--drafts', 'drafts.json', '--repo', 'acme/w', '--dry-run'], deps);
  assert.equal(code, 0);
  assert.equal(createCalls.length, 0);
  const lines = out.join('').trim().split('\n');
  assert.equal(lines[0], 'dedup-hit #801');
  assert.match(lines[1], new RegExp(`would-file \\(fingerprint ${fpB}\\)`));
});

test('CLI --dry-run: a runner failure in the dedup search reports the real gh error text, not a swallowed undefined', () => {
  // Regression: the dry-run loop's dedup-search catch used to read `err.message`
  // directly instead of `errorText(err)` — for a runner failure carrying its
  // diagnostic in .stderr (or a thrown non-Error), that silently produced
  // "filing-failure: undefined". Mirrors link.test.js's errorText-fallback coverage.
  const draft = makeDraft();
  const runner = (args) => {
    if (isList(args)) { const e = new Error(); e.stderr = 'gh: rate limited (403)'; throw e; }
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out } = cliDeps({ runner, readDraftsFile: () => [draft] });
  const code = run(['--drafts', 'drafts.json', '--repo', 'acme/w', '--dry-run'], deps);
  assert.equal(code, 1);
  const line = out.join('').trim();
  assert.match(line, /filing-failure:/);
  assert.match(line, /rate limited \(403\)/);
  assert.doesNotMatch(line, /filing-failure: undefined/);
});

test('CLI: missing --drafts exits 2 with zero runner calls', () => {
  const runner = () => { throw new Error('must not call gh'); };
  const { deps, err } = cliDeps({ runner });
  const code = run([], deps);
  assert.equal(code, 2);
  assert.match(err.join(''), /--drafts is required/);
});

test('CLI: a drafts entry missing fingerprintBasis exits 2 with zero runner calls', () => {
  const runner = () => { throw new Error('must not call gh'); };
  const badDraft = { title: 'x', body: 'y', labels: [] };
  const { deps, err } = cliDeps({ runner, readDraftsFile: () => [badDraft] });
  const code = run(['--drafts', 'drafts.json', '--repo', 'acme/w'], deps);
  assert.equal(code, 2);
  assert.match(err.join(''), /missing fingerprintBasis/);
});

test('CLI: gh unavailable exits 2, stderr names the fallback, zero runner calls', () => {
  const runner = () => { throw new Error('must not call gh'); };
  const { deps, err } = cliDeps({ runner, ghAvailable: false, readDraftsFile: () => [makeDraft()] });
  const code = run(['--drafts', 'drafts.json', '--repo', 'acme/w'], deps);
  assert.equal(code, 2);
  const stderr = err.join('');
  assert.match(stderr, /Step 8|github-write-transport/);
});

// ---- realDeps wiring --------------------------------------------------------

test('realDeps.runner is the bare defaultRunner — retry lives inside fileOne now', () => {
  // Regression guard, inverted from the pre-fix version: retry used to wrap
  // this runner directly, which meant the non-idempotent `gh issue create`
  // call retried exactly like the idempotent reads — an ambiguous transient
  // failure (request succeeded server-side, response lost) could then file
  // a duplicate issue with nothing to catch it. Retry now lives inside
  // fileOne, per call, with createWithDedupSafeRetry guarding the create
  // path specifically — see that function's doc comment. realDeps.runner
  // must stay unwrapped so fileOne's own catch sees every create failure.
  assert.equal(realDeps.runner, feedback.defaultRunner);
});

// ---- createWithDedupSafeRetry ------------------------------------------------

test('createWithDedupSafeRetry: transient failure then success — one dedup recheck, no duplicate created', () => {
  let createCalls = 0;
  const create = () => {
    createCalls++;
    if (createCalls === 1) throw new Error('HTTP 503: No server is currently available');
    return 555;
  };
  const dedupCalls = [];
  const runner = (args) => {
    dedupCalls.push(args);
    return JSON.stringify([]); // no hit on the safety-net recheck
  };
  const sleeps = [];
  const result = feedback.createWithDedupSafeRetry({
    repo: 'acme/w', marker: '<!-- fingerprint: feedback-aaaa1111 -->', create, runner,
    sleep: (ms) => sleeps.push(ms),
  });
  assert.equal(result, 555);
  assert.equal(createCalls, 2);
  assert.equal(dedupCalls.length, 1, 'one safety-net dedup recheck before the retry');
  assert.deepEqual(sleeps, [15000]);
});

test('createWithDedupSafeRetry: transient failure, safety-net recheck finds the phantom success — returns it without retrying create', () => {
  let createCalls = 0;
  const create = () => { createCalls++; throw new Error('gh: ETIMEDOUT'); };
  const marker = '<!-- fingerprint: feedback-bbbb2222 -->';
  const runner = () => JSON.stringify([{ number: 909, title: 'the phantom-succeeded issue', body: `body\n${marker}\n`, createdAt: '2026-01-01T00:00:00Z' }]);
  const result = feedback.createWithDedupSafeRetry({
    repo: 'acme/w', marker, create, runner,
    sleep: () => {},
  });
  assert.equal(result, 909);
  assert.equal(createCalls, 1, 'create is never called again once the recheck finds the issue already exists');
});

test('createWithDedupSafeRetry: transient failures exceeding maxRetries rethrows the last error', () => {
  let createCalls = 0;
  const create = () => { createCalls++; throw new Error('HTTP 503: No server is currently available'); };
  const runner = () => JSON.stringify([]);
  const sleeps = [];
  assert.throws(
    () => feedback.createWithDedupSafeRetry({
      repo: 'acme/w', marker: '<!-- fingerprint: feedback-cccc3333 -->', create, runner,
      maxRetries: 2, sleep: (ms) => sleeps.push(ms),
    }),
    /503/,
  );
  assert.equal(createCalls, 3, 'initial attempt plus 2 retries');
  assert.equal(sleeps.length, 2);
});

test('createWithDedupSafeRetry: a non-transient failure is rethrown immediately — no sleep, no dedup recheck', () => {
  let createCalls = 0;
  const create = () => { createCalls++; throw new Error('HTTP 422: Validation Failed'); };
  const runner = () => { throw new Error('must not check dedup on a non-transient failure'); };
  const sleeps = [];
  assert.throws(
    () => feedback.createWithDedupSafeRetry({
      repo: 'acme/w', marker: '<!-- fingerprint: feedback-dddd4444 -->', create, runner,
      sleep: (ms) => sleeps.push(ms),
    }),
    /422/,
  );
  assert.equal(createCalls, 1);
  assert.equal(sleeps.length, 0);
});

test('fileOne: a transient create failure recovers via dedup safety-net instead of filing a duplicate', () => {
  const draft = makeDraft();
  const fp = feedback.computeFingerprint(draft);
  const marker = `<!-- fingerprint: ${fp} -->`;
  let createCalls = 0;
  let listCalls = 0;
  const runner = (args) => {
    if (isList(args)) {
      listCalls++;
      // First dedup search (pre-create): no hit. Safety-net recheck
      // (post-transient-failure): the phantom-succeeded issue now exists.
      if (listCalls === 1) return JSON.stringify([]);
      return JSON.stringify([{ number: 950, title: draft.title, body: `filed body\n${marker}\n`, createdAt: '2026-01-01T00:00:00Z' }]);
    }
    if (isCreate(args)) { createCalls++; throw new Error('HTTP 503: No server is currently available'); }
    if (isView(args)) return JSON.stringify({ title: draft.title, body: `filed body\n${marker}\n` });
    throw new Error('unexpected ' + args.join(' '));
  };
  const result = feedback.fileOne({
    repo: 'acme/w', draft, runner, bodyFile: '/fake/body.md', writeFile: () => {}, sleep: () => {},
  });
  assert.deepEqual(result, { status: 'filed', number: 950 });
  assert.equal(createCalls, 1, 'create is attempted once — the safety net finds the phantom success instead of retrying it');
});

// ---- parseArgs / validateDraft / parseRepo ---------------------------------

test('parseArgs: --help short-circuits, unknown flags and missing values are errors', () => {
  assert.equal(parseArgs(['--help']).help, true);
  assert.match(parseArgs(['--bogus']).error, /unknown argument/);
  assert.match(parseArgs(['--drafts']).error, /missing value for --drafts/);
});

test('validateDraft: flags a missing title, body, and fingerprintBasis fields individually', () => {
  assert.match(validateDraft({ body: 'b', fingerprintBasis: { component: 'c', summary: 's' } }, 0), /missing title/);
  assert.match(validateDraft({ title: 't', fingerprintBasis: { component: 'c', summary: 's' } }, 0), /missing body/);
  assert.match(validateDraft({ title: 't', body: 'b' }, 0), /missing fingerprintBasis/);
  assert.equal(validateDraft({ title: 't', body: 'b', fingerprintBasis: { component: 'c', summary: 's' } }, 0), null);
});

test('parseRepo: extracts host/owner/repo from github.com/owner/repo and github.com:owner/repo.git forms', () => {
  assert.deepEqual(parseRepo('github.com/owner/repo'), { host: 'github.com', owner: 'owner', repo: 'repo' });
  assert.deepEqual(parseRepo('github.com:owner/repo.git'), { host: 'github.com', owner: 'owner', repo: 'repo' });
  assert.deepEqual(parseRepo('https://github.com/owner/repo.git'), { host: 'github.com', owner: 'owner', repo: 'repo' });
  // #2240: parseRepo now widens to an arbitrary host (GitHub Enterprise Server support) —
  // a non-github.com host is no longer rejected, it's captured.
  assert.deepEqual(parseRepo('https://gitlab.com/owner/repo'), { host: 'gitlab.com', owner: 'owner', repo: 'repo' });
});
