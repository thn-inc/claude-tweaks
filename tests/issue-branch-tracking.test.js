'use strict';
const { test } = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const {
  ISSUE_REF_SOURCE,
  CLOSING_KEYWORD_ALTERNATION,
  PREFILTER_KEYWORD_STEMS,
  PREFILTER_EXPRESSION,
  extractIssueNumbers,
  prefilterMatches,
  generateWorkflowYaml,
  classifyExistingWorkflow,
  PRIOR_OUTPUT_SHA256,
} = require('../plugin/bin/lib/issue-branch-tracking');

test('extractIssueNumbers matches GitHub closing keywords, case-insensitive', () => {
  const messages = [
    'Fixes #12: correct the off-by-one',
    'closes #34',
    'Fixed #56 and resolved #78',
  ];
  assert.deepStrictEqual(extractIssueNumbers(messages), [12, 34, 56, 78]);
});

test('extractIssueNumbers ignores bare issue references without a closing keyword', () => {
  const messages = ['See #99 for context', 'Related to #100 but not fixing it'];
  assert.deepStrictEqual(extractIssueNumbers(messages), []);
});

test('extractIssueNumbers de-dupes and sorts when the same issue repeats', () => {
  const messages = ['Fixes #5', 'fix #5', 'Closes #2'];
  assert.deepStrictEqual(extractIssueNumbers(messages), [2, 5]);
});

test('extractIssueNumbers handles multiple references in one commit message', () => {
  const messages = ['Fixes #1 and Closes #2'];
  assert.deepStrictEqual(extractIssueNumbers(messages), [1, 2]);
});

test('extractIssueNumbers returns [] for empty or missing input', () => {
  assert.deepStrictEqual(extractIssueNumbers([]), []);
  assert.deepStrictEqual(extractIssueNumbers(undefined), []);
});

test('generateWorkflowYaml embeds both jobs and the default-branch comparison', () => {
  const yaml = generateWorkflowYaml();
  assert.ok(yaml.includes('label-fix-branch:'));
  assert.ok(yaml.includes('cleanup-fix-labels:'));
  assert.ok(yaml.includes(
    "if: github.ref != format('refs/heads/{0}', github.event.repository.default_branch)"
  ));
  assert.ok(yaml.includes(
    "if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)"
  ));
});

test('ISSUE_REF_SOURCE keeps its exact value after composing the shared keyword alternation', () => {
  assert.strictEqual(ISSUE_REF_SOURCE, '\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#([0-9]+)');
});

test('generateWorkflowYaml embeds the exact tested regex pattern (single source of truth)', () => {
  const yaml = generateWorkflowYaml();
  const needle = `PATTERN='${ISSUE_REF_SOURCE}'`;
  const occurrences = yaml.split(needle).length - 1;
  assert.strictEqual(occurrences, 2);
});

test('generateWorkflowYaml output has no tab characters and starts with the workflow name', () => {
  const yaml = generateWorkflowYaml();
  assert.ok(yaml.startsWith('name: Track issue fixes across branches'));
  assert.ok(!yaml.includes('\t'), 'YAML must not contain tab characters');
});

test('generateWorkflowYaml guards both extract-step ISSUES=$(...) pipelines with || true so pipefail cannot fail the step on a no-match push', () => {
  const yaml = generateWorkflowYaml();
  const guardedNeedle = "tr '\\n' ' ' || true)";
  const guardedOccurrences = yaml.split(guardedNeedle).length - 1;
  assert.strictEqual(
    guardedOccurrences,
    2,
    'both extract-step ISSUES=$(...) lines must end in `|| true)` immediately after tr \'\\n\' \' \''
  );

  const unguardedNeedle = "tr '\\n' ' ')";
  const unguardedOccurrences = yaml.split(unguardedNeedle).length - 1;
  assert.strictEqual(
    unguardedOccurrences,
    0,
    'no extract-step ISSUES=$(...) line may be missing the || true guard (would fail the job under pipefail on a no-match push)'
  );
});

test('generateWorkflowYaml uses $RUNNER_TEMP instead of /tmp for the commit-messages scratch file', () => {
  const yaml = generateWorkflowYaml();
  const runnerTempOccurrences = yaml.split('"$RUNNER_TEMP/commit_messages.txt"').length - 1;
  assert.strictEqual(runnerTempOccurrences, 4, 'both jobs write and read the scratch file via $RUNNER_TEMP (2 lines each)');
  assert.ok(!yaml.includes('/tmp/commit_messages.txt'), 'no hardcoded /tmp path should remain');
});

test('generateWorkflowYaml declares a per-ref concurrency group so overlapping pushes to the same branch queue instead of racing', () => {
  const yaml = generateWorkflowYaml();
  assert.ok(yaml.includes('concurrency:'));
  assert.ok(yaml.includes('  group: track-issue-fixes-${{ github.ref }}'));
  assert.ok(yaml.includes('  cancel-in-progress: false'));
});

test('generateWorkflowYaml skips posting a duplicate tracking comment when a branch-scoped marker already exists', () => {
  const yaml = generateWorkflowYaml();
  assert.ok(
    yaml.includes('MARKER="<!-- track-issue-fixes:${BRANCH} -->"'),
    'must define a branch-scoped marker for dedup'
  );
  assert.ok(
    yaml.includes("-q '.comments[].body' | grep -F \"$MARKER\" || true)"),
    'must check existing comments for the branch marker, not the commit SHA, before posting a new one'
  );
  assert.ok(
    yaml.includes('if [ -z "$EXISTING" ]; then'),
    'must only post the tracking comment when no existing marker was found'
  );
  assert.ok(
    yaml.includes('${MARKER}'),
    'the posted comment body must embed the marker so a later push can find it'
  );
  assert.ok(
    !yaml.includes('grep -F "$SHA"'),
    'dedup must no longer match on the unstable commit SHA (breaks under amend/force-push)'
  );
});

test('generateWorkflowYaml excludes revert commits from closing-keyword extraction in both jobs', () => {
  const yaml = generateWorkflowYaml();
  const needle = 'select(.message | startswith("Revert \\"") | not) | .message';
  const occurrences = yaml.split(needle).length - 1;
  assert.strictEqual(
    occurrences,
    2,
    'both jobs\' extract step must drop commits whose message starts with `Revert "` (git\'s default revert subject re-contains the original closing keyword)'
  );
});

test('generateWorkflowYaml skips label/comment on a closing-keyword number that resolves to a pull request', () => {
  const yaml = generateWorkflowYaml();
  assert.ok(
    yaml.includes(`IS_PR=$(gh api "repos/$REPO/issues/$ISSUE" --jq 'has("pull_request")' || echo "")`),
    'must probe whether the extracted number is a PR via the has("pull_request") key'
  );
  assert.ok(
    yaml.includes('echo "::warning::#$ISSUE is a pull request, not an issue -- skipping label/comment"'),
    'a PR match must log a visible warning instead of silently swallowing via || true'
  );
});

test('generateWorkflowYaml removes fix-on-* labels one call per label instead of one batched call', () => {
  const yaml = generateWorkflowYaml();
  assert.ok(
    yaml.includes('gh issue edit "$ISSUE" --remove-label "$LABEL" --repo "$REPO" || true'),
    'must issue a separate gh issue edit call per label so one rejected label cannot block removal of the others'
  );
  assert.ok(
    !yaml.includes('REMOVE_ARGS=()') && !yaml.includes('"${REMOVE_ARGS[@]}"'),
    'must not batch every label into one REMOVE_ARGS[] array/call (the atomicity bug this replaces) -- a comment may still name REMOVE_ARGS for context'
  );
});

// Regression: the JS side (extractIssueNumbers) matches ISSUE_REF_SOURCE
// against each whole commit message, so `\s+` spans an embedded newline
// (e.g. a hard-wrapped "This closes\n#123"). The old generated shell step
// piped `jq -r '.[].message'` into plain `grep -ioP`, which processes input
// line-by-line even under `-P` — `\s+` could never bridge that newline
// there, so the same reference was silently missed on the actual runner.
test('generateWorkflowYaml uses jq --raw-output0 + grep -z (NUL-delimited) so a reference is not missed', () => {
  const yaml = generateWorkflowYaml();
  const occurrences = (needle) => yaml.split(needle).length - 1;
  assert.strictEqual(occurrences('jq --raw-output0'), 2, 'both jobs must NUL-terminate each commit message');
  assert.strictEqual(occurrences('grep -zoiP'), 2, 'both jobs must grep in NUL-delimited (-z) mode');
  assert.strictEqual(occurrences("tr '\\0' '\\n'"), 2, 'both jobs must convert NUL-separated matches back to newline-separated before the [0-9]+ extraction');
});

function resolveGnuGrep() {
  const { spawnSync } = require('node:child_process');
  for (const candidate of ['grep', 'ggrep']) {
    const r = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 && /GNU grep/.test(r.stdout || '')) return candidate;
  }
  return null;
}

function hasJq() {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync('jq', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

// Extracts the literal "Extract referenced issues" run-body from the real
// generated YAML (between the `PATTERN=` line and the `echo "issues=..."`
// line, inclusive) — the exact same lines a GitHub Actions runner would
// execute — rather than re-implementing the pipeline in the test itself.
// A re-implementation would keep passing even if generateWorkflowYaml()
// regressed back to the old `jq -r` / plain `grep -ioP` shape, since it
// would never actually exercise the generated output.
function extractRunBody(yaml) {
  const lines = yaml.split('\n');
  const startIdx = lines.findIndex((l) => l.includes("PATTERN='"));
  const endIdx = lines.findIndex((l, i) => i >= startIdx && l.includes('echo "issues=$ISSUES"'));
  assert.ok(startIdx !== -1 && endIdx !== -1, 'expected to find the extract-step run body in the generated YAML');
  return lines.slice(startIdx, endIdx + 1).map((l) => l.trim()).join('\n');
}

// Runs the literal extracted run-body against a fixture commit list, with
// `grep` on PATH resolved to a real GNU grep (this environment may only
// have it under a different name, e.g. `ggrep` on macOS — every GitHub
// Actions ubuntu-latest runner ships GNU grep natively as `grep`).
function runExtractStep(t, commits, envOverrides = {}) {
  const gnuGrep = resolveGnuGrep();
  if (!gnuGrep) {
    t.skip('no GNU grep found (checked `grep` and `ggrep`) — every GitHub Actions ubuntu-latest runner ships GNU grep natively, so this is a local-environment gap, not a real gap');
    return null;
  }
  if (!hasJq()) {
    t.skip('jq not found in this environment');
    return null;
  }

  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-issue-track-'));
  try {
    const binDir = path.join(tmp, 'bin');
    fs.mkdirSync(binDir);
    if (gnuGrep !== 'grep') {
      // Shim `grep` -> the real GNU grep binary so the extracted script
      // (which hardcodes the literal command name `grep`) runs unmodified.
      fs.writeFileSync(path.join(binDir, 'grep'), `#!/bin/sh\nexec ${gnuGrep} "$@"\n`, { mode: 0o755 });
    }

    const runBody = extractRunBody(generateWorkflowYaml());
    const githubOutput = path.join(tmp, 'github_output.txt');
    fs.writeFileSync(githubOutput, '');
    execFileSync('bash', ['-c', runBody], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        RUNNER_TEMP: tmp,
        GITHUB_OUTPUT: githubOutput,
        COMMITS_JSON: JSON.stringify(commits),
        ...envOverrides,
      },
    });
    const outputContent = fs.readFileSync(githubOutput, 'utf8');
    const match = outputContent.match(/^issues=(.*)$/m);
    return match ? match[1].trim() : '';
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('extraction pipeline (literal generated script): finds an issue reference hard-wrapped across a commit-message line break (the actual failure scenario)', (t) => {
  // A plain hard-wrap at ~72 columns, a common git commit-body convention —
  // not a contrived input.
  const commits = [{ message: 'Fix the flaky login test\n\nThis closes\n#123 for good.' }];
  const issues = runExtractStep(t, commits);
  if (issues === null) return; // skipped — see runExtractStep
  assert.strictEqual(issues, '123', `expected the hard-wrapped issue reference to be found, got: "${issues}"`);
});

test('extraction pipeline (literal generated script): does not falsely join two separate commit messages at their boundary', (t) => {
  const commits = [
    { message: 'Random commit that ends with the word closes' },
    { message: '#999 is an unrelated commit that starts with a hash' },
  ];
  const issues = runExtractStep(t, commits);
  if (issues === null) return; // skipped — see runExtractStep
  assert.strictEqual(issues, '', `two unrelated commit messages must not be joined across their NUL boundary, got: "${issues}"`);
});

test('extraction pipeline (literal generated script): a revert of a fix commit does not re-surface the reverted issue', (t) => {
  // git's default revert subject for an original commit that said `fixes #42`.
  const commits = [{ message: 'Revert "fixes #42"' }];
  const issues = runExtractStep(t, commits);
  if (issues === null) return; // skipped — see runExtractStep
  assert.strictEqual(issues, '', `a revert commit must be excluded from closing-keyword extraction, got: "${issues}"`);
});

test('extraction pipeline (literal generated script): a revert commit alongside a real fix still surfaces the real one', (t) => {
  const commits = [
    { message: 'Revert "fixes #42"' },
    { message: 'fixes #7' },
  ];
  const issues = runExtractStep(t, commits);
  if (issues === null) return; // skipped — see runExtractStep
  assert.strictEqual(issues, '7', `expected only the non-revert commit's issue to surface, got: "${issues}"`);
});

// ---------------------------------------------------------------------------
// Job-level prefilter (#5152): a strict superset of the in-job extraction.
// ---------------------------------------------------------------------------

const KEYWORD_FORMS = ['close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved'];
const BASE_STEMS = ['close', 'fix', 'resolve'];

test('PREFILTER_KEYWORD_STEMS are the base stems plus the long-s variant of each stem containing an s', () => {
  assert.deepStrictEqual([...PREFILTER_KEYWORD_STEMS], ['close', 'cloſe', 'fix', 'resolve', 'reſolve']);
});

test('PREFILTER_KEYWORD_STEMS cover every word CLOSING_KEYWORD_ALTERNATION accepts', () => {
  // The enumeration below only reaches words that start with a base stem, so
  // it cannot see a newly added alternation word of another shape. Pinning the
  // exact string is what makes any widening of the vocabulary fail loudly.
  assert.strictEqual(
    CLOSING_KEYWORD_ALTERNATION,
    '(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)',
    'CLOSING_KEYWORD_ALTERNATION changed: revisit PREFILTER_KEYWORD_STEMS (a word without a stem would be dropped by the job-level prefilter) before updating this pin'
  );
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const suffixes = [''];
  for (const a of letters) {
    suffixes.push(a);
    for (const b of letters) {
      suffixes.push(a + b);
      for (const c of letters) suffixes.push(a + b + c);
    }
  }
  const candidates = [];
  for (const stem of BASE_STEMS) for (const sfx of suffixes) candidates.push(stem + sfx);
  const re = new RegExp('^(?:' + CLOSING_KEYWORD_ALTERNATION + ')$');
  const matched = candidates.filter((w) => re.test(w)).sort();
  assert.deepStrictEqual(matched, [...KEYWORD_FORMS].sort());
  for (const w of matched) {
    assert.ok(prefilterMatches([`${w} #1`]), `${w} #1 must pass the prefilter`);
  }
});

test('emitted if: lines carry exactly the prefilter literals', () => {
  const yaml = generateWorkflowYaml();
  const ifLines = yaml.split('\n').filter((l) => /^\s+if: github\.ref (?:!=|==) /.test(l));
  assert.strictEqual(ifLines.length, 2);
  const litRe = /contains\(join\(github\.event\.commits\.\*\.message, ' '\), '([^']*)'\)/g;
  for (const line of ifLines) {
    const literals = [...line.matchAll(litRe)].map((m) => m[1]).sort();
    assert.deepStrictEqual(literals, ['#', ...PREFILTER_KEYWORD_STEMS].sort());
    assert.ok(line.includes(PREFILTER_EXPRESSION));
    assert.ok(!/\s#/.test(line), 'a whitespace-then-# would start a YAML comment');
  }
});

test('prefilterMatches rejects pushes with no closing reference', () => {
  assert.strictEqual(prefilterMatches(['Update README']), false);
  assert.strictEqual(prefilterMatches(['refs #12 tidy']), false);
  assert.strictEqual(prefilterMatches(['health-state: code-health update']), false);
  assert.strictEqual(prefilterMatches(['fix the build']), false);
  assert.strictEqual(prefilterMatches([]), false);
  assert.strictEqual(prefilterMatches(undefined), false);
  assert.strictEqual(prefilterMatches([undefined]), false);
  assert.strictEqual(prefilterMatches([42]), false);
  assert.strictEqual(prefilterMatches(null), false);
  assert.strictEqual(prefilterMatches([{}]), false);
  assert.strictEqual(prefilterMatches([null]), false);
});

test('prefilterMatches models OrdinalIgnoreCase: ASCII folds, long s and dotless i do not', () => {
  // The cloſe literal (not a Unicode upper-casing) is what admits cloſes #1.
  assert.strictEqual(prefilterMatches(['cloſes #1']), true);
  assert.strictEqual(prefilterMatches(['CLOſE #1']), true);
  assert.strictEqual(prefilterMatches(['reſolves #2']), true);
  assert.strictEqual(prefilterMatches(['ſ #1']), false);
  // Neither GitHub's contains() nor GNU grep folds dotless i to i.
  assert.strictEqual(prefilterMatches(['fıxes #3']), false);
  assert.strictEqual(prefilterMatches(['FİXES #4']), false);
});

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateCommitCorpus() {
  const rand = mulberry32(5152);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const casings = [
    (w) => w.toLowerCase(),
    (w) => w.toUpperCase(),
    (w) => w[0].toUpperCase() + w.slice(1).toLowerCase(),
    (w) => w.split('').map((c, i) => (i % 2 ? c.toUpperCase() : c)).join(''), // fixed mixed case, e.g. fIxEs
  ];
  const separators = [' ', '\t', '\n', '\r\n'];
  const noise = ['the', 'build', 'refs', 'update', 'docs', 'login', 'see', 'and', 'of', 'closing', 'fixture', 'prefix'];
  const sep = () => {
    let s = '';
    const n = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) s += pick(separators);
    return s;
  };
  const num = () => String(Math.floor(rand() * 99999) + 1).slice(0, 1 + Math.floor(rand() * 5));
  const keyword = () => {
    const form = pick(KEYWORD_FORMS);
    return rand() < 0.25 ? form.split('').map((c) => (rand() < 0.5 ? c.toUpperCase() : c)).join('') : pick(casings.slice(0, 3))(form);
  };

  const corpus = [];
  // Seeded by construction: every keyword form x casing, so keyword/casing
  // coverage never depends on chance.
  let n = 1;
  for (const form of KEYWORD_FORMS) for (const c of casings) corpus.push([`${c(form)} #${n++}`]);
  corpus.push(['cloſes #1'], ['reſolves #2'], ['fıxes #3']);

  while (corpus.length < 5000) {
    const count = 1 + Math.floor(rand() * 3);
    const msgs = [];
    for (let i = 0; i < count; i++) {
      const roll = rand();
      let msg;
      if (roll < 0.15 && i + 1 < count) {
        // keyword in this message, #N in the next
        msgs.push(`${keyword()}${sep()}`);
        msgs.push(`#${num()} ${pick(noise)}`);
        i++;
        continue;
      } else if (roll < 0.7) {
        msg = `${pick(noise)} ${keyword()}${sep()}#${num()} ${pick(noise)}`;
      } else if (roll < 0.85) {
        msg = `${pick(noise)} #${num()} ${pick(noise)} ${rand() < 0.5 ? keyword() : ''}`;
      } else {
        msg = `${pick(noise)} ${pick(noise)}`;
      }
      if (rand() < 0.1) msg = `Revert "${msg}"`;
      msgs.push(msg);
    }
    corpus.push(msgs);
  }
  return corpus;
}

test('prefilterMatches is a superset of extractIssueNumbers (seeded property test)', () => {
  const corpus = generateCommitCorpus();
  assert.strictEqual(corpus.length, 5000);
  let nonEmpty = 0;
  for (const msgs of corpus) {
    if (extractIssueNumbers(msgs).length > 0) {
      nonEmpty++;
      assert.strictEqual(prefilterMatches(msgs), true, `prefilter dropped a push the extraction matches: ${JSON.stringify(msgs)}`);
    }
  }
  assert.ok(nonEmpty >= 1000, `property is vacuous: only ${nonEmpty} arrays had a non-empty extraction`);
});

test('prefilterMatches is a superset of the literal generated extraction script (runtime)', (t) => {
  let nonEmpty = 0;
  for (const msgs of generateCommitCorpus().slice(0, 150)) {
    const issues = runExtractStep(t, msgs.map((m) => ({ message: m })));
    if (issues === null) return; // skipped — see runExtractStep
    if (issues !== '') {
      nonEmpty++;
      assert.strictEqual(prefilterMatches(msgs), true, `runtime extraction matched but prefilter dropped: ${JSON.stringify(msgs)}`);
    }
  }
  assert.ok(nonEmpty >= 36, `runtime property is vacuous: only ${nonEmpty} non-empty extractions (all 36 seeded combinations must extract)`);
});

test('long-s and dotless-i: runtime extraction and the prefilter model agree (GNU grep folds ſ, not ı)', (t) => {
  const run = (msg) => runExtractStep(t, [{ message: msg }], { LC_ALL: 'C.UTF-8' });
  const cases = [
    { msg: 'cloſes #1', extracted: '1' },
    { msg: 'reſolves #2', extracted: '2' },
    // GNU grep does not fold dotless i to i, and neither does GitHub's
    // contains(): the model must not be looser than GitHub here.
    { msg: 'fıxes #3', extracted: '' },
  ];
  for (const { msg, extracted } of cases) {
    const issues = run(msg);
    if (issues === null) return; // skipped — see runExtractStep
    t.diagnostic(`grep returned ${JSON.stringify(issues)} for ${JSON.stringify(msg)}`);
    assert.strictEqual(issues, extracted, `runtime extraction for ${msg}`);
    assert.strictEqual(prefilterMatches([msg]), extracted !== '', `prefilter for ${msg}`);
  }
});

test('push trigger excludes the plugin bookkeeping branches, named from their constants', () => {
  const { CLAIMS_BRANCH } = require('../plugin/bin/lib/issues/claims');
  const { HEALTH_STATE_BRANCH } = require('../plugin/bin/lib/health-core/durable-state');
  assert.strictEqual(CLAIMS_BRANCH, 'claims-registry');
  assert.strictEqual(HEALTH_STATE_BRANCH, 'health-state');
  const lines = generateWorkflowYaml().split('\n');
  const start = lines.indexOf('  push:');
  assert.ok(start >= 0, 'push: trigger present');
  const rest = lines.slice(start + 1);
  const block = rest.slice(0, rest.indexOf(''));
  const items = block.filter((l) => l.startsWith('      - ')).map((l) => l.slice('      - '.length));
  assert.deepStrictEqual(items, ["'**'", `'!${CLAIMS_BRANCH}'`, `'!${HEALTH_STATE_BRANCH}'`]);
});

const normalisedDigest = (text) =>
  crypto.createHash('sha256').update(text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\n+$/, '')).digest('hex');
const PRE_5152_FIXTURE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'track-issue-fixes-pre-5152.yml'),
  'utf8',
);
const PINNED_CURRENT_DIGEST = '7a6446358b5cb6593a9b99aa76ae6a30abc03fe289afbc6e0f9fc530a5c105cf';

test('classifyExistingWorkflow: current generator output', () => {
  const current = generateWorkflowYaml();
  assert.strictEqual(classifyExistingWorkflow(current), 'current');
  assert.strictEqual(classifyExistingWorkflow(current + '\n'), 'current');
  assert.strictEqual(classifyExistingWorkflow(current.replace(/\n/g, '\r\n')), 'current');
});

test('classifyExistingWorkflow: pre-5152 checked-in file is prior-generated', () => {
  assert.strictEqual(classifyExistingWorkflow(PRE_5152_FIXTURE), 'prior-generated');
});

test('classifyExistingWorkflow: a leading UTF-8 BOM does not turn an unmodified file into modified', () => {
  assert.strictEqual(classifyExistingWorkflow('﻿' + generateWorkflowYaml()), 'current');
  assert.strictEqual(classifyExistingWorkflow('﻿' + PRE_5152_FIXTURE), 'prior-generated');
});

test('classifyExistingWorkflow: a hand edit is modified', () => {
  const edited = PRE_5152_FIXTURE.replace(/^([ \t]*# )(.)/m, (_, lead, ch) => lead + (ch === 'X' ? 'Y' : 'X'));
  assert.notStrictEqual(edited, PRE_5152_FIXTURE);
  assert.strictEqual(classifyExistingWorkflow(edited), 'modified');
  assert.strictEqual(classifyExistingWorkflow(''), 'modified');
});

test('current generator output digest is pinned', () => {
  assert.strictEqual(
    normalisedDigest(generateWorkflowYaml()),
    PINNED_CURRENT_DIGEST,
    'generator output changed — append the previous digest to PRIOR_OUTPUT_SHA256 so adopters on it upgrade silently, then update this pinned value',
  );
});

test('the checked-in .github/workflows/track-issue-fixes.yml is the generator output', () => {
  const checkedIn = fs.readFileSync(
    path.join(__dirname, '..', '.github/workflows/track-issue-fixes.yml'),
    'utf8',
  );
  assert.strictEqual(checkedIn, generateWorkflowYaml() + '\n');
});

test('PRIOR_OUTPUT_SHA256 holds five distinct digests and excludes the current output', () => {
  assert.strictEqual(PRIOR_OUTPUT_SHA256.length, 5);
  assert.strictEqual(new Set(PRIOR_OUTPUT_SHA256).size, 5);
  for (const d of PRIOR_OUTPUT_SHA256) assert.match(d, /^[0-9a-f]{64}$/);
  assert.ok(!PRIOR_OUTPUT_SHA256.includes(normalisedDigest(generateWorkflowYaml())));
});
