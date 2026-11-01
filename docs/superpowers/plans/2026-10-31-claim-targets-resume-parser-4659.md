# Route claim-targets.md tombstone Resume-line parse through the shared parser (#4659) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The tombstone-PR (`Claim in-flight`) routing in `plugin/skills/flow/claim-targets.md` reads a PR body's `### Resume` line through `pr-body.js`'s `resumeLineUnder`/`parseResumeLine`, via a small CLI, instead of restating the line's grammar in prose.

**Architecture:** Move `stale-claim-pr.js`'s private `resumeFields` into `pr-body.js` as the exported `resumeVerdict(body, runId)` so both CLIs share one reason-code vocabulary. Add `plugin/bin/pr-resume-line.js --body-file <path> --run-id <id>`, a pure reader that prints one JSON verdict. Rewrite the claim-targets.md paragraph to save the PR body to a session temp file, keep its existing run-id marker validation, and call the CLI; only a `resume` verdict routes into `resume-confirmation.md`.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T093853-record-4659/work/4659-spec.md` (materialized from GitHub issue #4659)

**Scope keywords:** resumeLineUnder, parseResumeLine, resumeVerdict

## Global Constraints

- Commit messages: `{Verb} {what} — {detail}`, ending with `refs #4659` (never `closes`/`fixes`).
- CLI wrapper contract (`.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`): "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw … is try/caught into the documented exit-code contract" and "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout). `--help` short-circuits before any availability probe."
- No `fs.existsSync`/`fs.realpathSync` tokens and no `startsWith(... path.sep)` under `plugin/bin/` (`tests/path-guard-conformance.test.js`, `tests/path-containment-conformance.test.js`). The new CLI reads one file via `deps.readFile` only.
- `stale-claim-pr.js`'s stdout stays byte-identical: under `--resume` a match carries exactly `resume` or `resolve` between `link` and `failure` (`tests/stale-claim-pr-cli.test.js` deepEquals the keys).
- Out of scope: the run-id marker validation prose and its `RUN_ID_SHAPE` copy in claim-targets.md stay (pinned as the one remaining copy by `tests/issue-claims-stale-open-pr-conformance.test.js`'s last test and by `tests/flow-claim-preflight.test.js:97`'s `claude-tweaks-run: \{run-id\}` assertion).
- claim-targets.md is 35,436 B against the 52,500 B `RAIL_BYTES` rail; the rewrite is roughly size-neutral (headroom ~17 KB).

## Review Focus

- A Resume line whose run dir contains `!` (bash history expansion) must yield `resolve`, never `resume`: covered by Task 1's `AC2.1` CLI test.
- A body with a `### Resume` heading and nothing under it, or no heading at all, must yield `no-resume-line`: Task 1 `resumeVerdict` test.
- A Resume line for a different run (dir not ending in `/{run-id}`) must yield `resume-line-shape`: Task 1 `resumeVerdict` test.
- An unreadable `--body-file` must be a `failure` verdict (exit 0, `resolve: null`), which the prose treats as the terminal card, never as `resume`: Task 1 CLI test.
- A CRLF body (as `gh` may return on Windows) still parses: Task 1 `resumeVerdict` test.

---

### Task 1: `resumeVerdict` in pr-body.js and the `pr-resume-line.js` CLI

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/flow/pr-body.js` (add `resumeVerdict`, export it)
- Modify: `plugin/bin/stale-claim-pr.js` (its `resumeFields` delegates to `resumeVerdict`; output unchanged)
- Create: `plugin/bin/pr-resume-line.js`
- Test: `tests/bin-lib/flow/pr-body.test.js` (append `resumeVerdict` tests)
- Create: `tests/pr-resume-line-cli.test.js`
- Modify: `docs/plugin-structure.md` (line 52's pr-body.js description: add `resumeVerdict` and that the parser is consumed through `bin/pr-resume-line.js` too; command reference after the `stale-claim-pr.js` line at 212: add the new CLI's line)

**Interfaces:**
- Produces: `resumeVerdict(body: string, runId: string) -> { resume: string, runDir: string, target: string, steps: string } | { resolve: 'no-resume-line' | 'resume-line-shape' }` exported from `plugin/bin/lib/flow/pr-body.js`.
- Produces: CLI `node plugin/bin/pr-resume-line.js --body-file <path> --run-id <id> [--help]`. Exit 0 with one JSON line for every verdict:
  - `{"resume":"<line>","runDir":"<dir>","target":"<target>","steps":"<steps>","failure":null}`
  - `{"resolve":"no-resume-line"|"resume-line-shape","failure":null}`
  - `{"resolve":null,"failure":"<message>"}` — the body file could not be read
  - Exit 1: malformed invocation (unknown flag, a flag missing its value or followed by another `--` flag, no `--body-file`, no `--run-id`); usage on stderr, no stdout. `--help` prints usage to stdout, exit 0.
  - Exports `{ run, parseArgs, realDeps }`; `deps` = `{ readFile, stdout, stderr }`.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/flow/pr-body.test.js`, import `resumeVerdict` and `composePrEarlyBody` (already imported) and append, reusing the file's `RUN`/`DIR`/`resume` helpers:

```js
test('resumeVerdict: a composed body yields resume plus its parsed fields', () => {
  const body = composePrEarlyBody({ runId: RUN, specSummary: 's', target: '#4596', nextStep: 'review,polish,wrap-up', runDir: DIR });
  assert.deepEqual(resumeVerdict(body, RUN), { resume: resume(), runDir: DIR, target: '#4596', steps: 'review,polish,wrap-up' });
  assert.deepEqual(resumeVerdict(body.replace(/\n/g, '\r\n'), RUN).resume, resume(), 'CRLF body');
});

test('resumeVerdict: no heading, or nothing under it, is no-resume-line', () => {
  assert.deepEqual(resumeVerdict('claude-tweaks-run: x\n', RUN), { resolve: 'no-resume-line' });
  assert.deepEqual(resumeVerdict('### Resume\n\n  \n', RUN), { resolve: 'no-resume-line' });
});

test('resumeVerdict: a line parseResumeLine rejects is resume-line-shape', () => {
  assert.deepEqual(resumeVerdict(`### Resume\n\n${resume({ runDir: '/x/a!b/' + RUN })}\n`, RUN), { resolve: 'resume-line-shape' });
  assert.deepEqual(resumeVerdict(`### Resume\n\n${resume({ runDir: '/repo/pipelines/2026-10-31T000000-other' })}\n`, RUN), { resolve: 'resume-line-shape' });
});
```

Create `tests/pr-resume-line-cli.test.js`, in `tests/stale-claim-pr-cli.test.js`'s fake-deps style (`fakeDeps(files)` with `readFile` throwing `ENOENT` for an unknown path, `stdout`/`stderr` collected into arrays):

- `AC2.1: a Resume line containing ! yields resolve, never resume` — body = `composePrEarlyBody({ runId: RUN, specSummary: 's', target: '#4659', nextStep: 'review,polish,wrap-up', runDir: '/repo/a!b/.claude-tweaks/pipelines/' + RUN })` → exit 0, stdout exactly `{"resolve":"resume-line-shape","failure":null}\n`, and the parsed verdict has no `resume` key.
- `a composed body yields resume, runDir, target and steps` → exit 0, verdict deepEquals `{ resume: composeResumeLine({ runDir: DIR, target: '#4659', nextStep: 'review,polish,wrap-up' }), runDir: DIR, target: '#4659', steps: 'review,polish,wrap-up', failure: null }` and `Object.keys` is `['resume','runDir','target','steps','failure']`.
- `a body with no Resume heading yields no-resume-line` → `{ resolve: 'no-resume-line', failure: null }`.
- `an unreadable body file is a failure verdict, never resume` → `--body-file /missing` → exit 0, verdict `resolve === null`, `failure` matches `/ENOENT/`.
- `malformed invocations exit 1 with usage on stderr and nothing on stdout` — table: `[]`, `['--run-id', RUN]`, `['--body-file', BODY]`, `['--body-file']`, `['--body-file', '--run-id', RUN]`, `['--body-file', BODY, '--run-id', RUN, '--bogus']` → each exit 1, stderr matches `/usage: pr-resume-line\.js/`, stdout empty.
- `--help prints usage to stdout and reads nothing` → exit 0, `readFile` never called.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/flow/pr-body.test.js tests/pr-resume-line-cli.test.js`
Expected: FAIL — `resumeVerdict is not a function` and `Cannot find module '../plugin/bin/pr-resume-line'`.

- [ ] **Step 3: Implement**

`resumeVerdict` in `pr-body.js`, placed after `resumeLineUnder`, with a one-line comment naming both consumers:

```js
function resumeVerdict(body, runId) {
  const line = resumeLineUnder(body);
  if (line === null) return { resolve: 'no-resume-line' };
  const parsed = parseResumeLine(line, runId);
  return parsed ? { resume: line, ...parsed } : { resolve: 'resume-line-shape' };
}
```

`stale-claim-pr.js`: import `resumeVerdict` instead of `resumeLineUnder`/`parseResumeLine`; `resumeFields` becomes `const v = resumeVerdict(body, runId); return v.resolve ? { resolve: v.resolve } : { resume: v.resume };`. Update its header comment only where it names the functions.

`pr-resume-line.js`: shebang, header comment in `stale-claim-pr.js`'s style (purpose: the tombstone-PR path of `skills/flow/claim-targets.md` calls this instead of restating the Resume-line grammar, #4659; usage, output shapes, exit codes as in Interfaces), `parseArgs` with the same missing-value rule as `stale-claim-pr.js`'s, `run(argv, deps)`, `realDeps = { readFile: (p) => fs.readFileSync(p, 'utf8'), stdout, stderr }`, guard `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`. Spread order for `resume`: `{ ...verdict, failure: null }`.

Docs: the two `docs/plugin-structure.md` edits named in Files.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/flow/pr-body.test.js tests/pr-resume-line-cli.test.js tests/stale-claim-pr-cli.test.js tests/bin-lib/exit-code-conformance.test.js tests/path-guard-conformance.test.js tests/path-containment-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/flow/pr-body.js plugin/bin/stale-claim-pr.js plugin/bin/pr-resume-line.js tests/bin-lib/flow/pr-body.test.js tests/pr-resume-line-cli.test.js docs/plugin-structure.md
git commit -m "Add pr-resume-line.js over pr-body.js's resumeVerdict — refs #4659"
```

---

### Task 2: claim-targets.md calls the CLI; the conformance test pins the removal

**Role:** integration

**Files:**
- Modify: `plugin/skills/flow/claim-targets.md:263-295` (the "Route into the existing build's resume/merge-decision machinery (#958)" paragraph)
- Test: `tests/issue-claims-stale-open-pr-conformance.test.js` (append two tests; update the header comment's last sentence to say claim-targets.md's Resume read routes through `bin/pr-resume-line.js` since #4659)

**Interfaces:**
- Consumes: Task 1's CLI and its three verdict shapes.

- [ ] **Step 1: Write the failing tests**

Append to `tests/issue-claims-stale-open-pr-conformance.test.js` (read claim-targets.md with the file's `readText`; slice the in-flight section from `'## Flow: Claim in-flight'` to `'\n- **4** —'`, as `tests/flow-claim-preflight.test.js:97` does, asserting both anchors exist):

```js
test('AC1.1, AC1.2: claim-targets.md no longer spells out the Resume line shape; it names the CLI (#4659)', () => {
  const text = readText(CLAIM_TARGETS).replace(/\s+/g, ' ');
  assert.ok(!text.includes('/claude-tweaks:flow "{target}" {next-step}'), 'the composed Resume-line template must be gone');
  const section = inFlightSection().replace(/\s+/g, ' ');
  assert.ok(!section.includes('PIPELINE_RUN_DIR="{run-dir}"'), 'the in-flight route must not restate the Resume line');
  assert.ok(section.includes('### Resume'), 'it still names the section it reads');
  assert.ok(section.includes('bin/pr-resume-line.js'), 'it names the CLI that parses it');
});

test('AC2.1: only a resume verdict routes into resume-confirmation.md; resolve or failure is the terminal card (#4659)', () => {
  const section = inFlightSection().replace(/\s+/g, ' ');
  assert.match(section, /pr-resume-line\.js" --body-file "\{body-file\}" --run-id "\{run-id\}"/);
  assert.match(section, /`resolve`[^.]*card above is the terminal output/);
  assert.match(section, /`resume` verdict's own `target`/);
});
```

Absence-grep control (run while authoring, matched on the pre-change tree): `grep -n -F '/claude-tweaks:flow "{target}" {next-step}' plugin/skills/flow/claim-targets.md` matches line 274; after whitespace normalization the in-flight section contains `PIPELINE_RUN_DIR="{run-dir}"` (line 273). Lines 27 and 45 carry other `PIPELINE_RUN_DIR="{run-dir}"` commands outside the in-flight section and stay — which is why the second assertion is section-scoped.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/issue-claims-stale-open-pr-conformance.test.js`
Expected: FAIL on both new tests (template present, CLI not named).

- [ ] **Step 3: Rewrite the paragraph**

Keep everything else in the paragraph as it is: the `DISPATCH_HEADLESS=1` skip, parsing the PR number from `link`, the `claude-tweaks-run: {run-id}` marker read with its `RUN_ID_SHAPE` validation, the run-dir-absent check, and the hand-off to `dispatch/resume-confirmation.md` / `check-resume-freshness`. Change only how the body is read and how the Resume line is parsed:

1. Save the body: `` gh pr view {number} --json body --jq .body > "{body-file}" `` (its own Bash call), `{body-file}` being what `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value pr-body-{number}.md` prints. Read the marker from that file.
2. After the run id validates: `node "${CLAUDE_PLUGIN_ROOT}/bin/pr-resume-line.js" --body-file "{body-file}" --run-id "{run-id}"`. It parses the line under the PR body's last `### Resume` heading with `pr-body.js`'s `parseResumeLine`, the parser twin of the composer `_shared/pr-early-run-lifecycle.md` Step 3 uses, so this file states no grammar of its own.
3. The terminal-output list becomes: no marker, the marker fails validation, `gh` unavailable, a `resolve` verdict or a `failure` from the CLI, or the run dir absent → the card above is the terminal output.
4. Otherwise pass the `resume` verdict's own `target` (the found run's actual record composition, single- or multi-spec, `flow/multi-spec.md`'s "Multi-spec runs share one PR"; never this claim loop's own stopped target) and the validated `{run-id}`'s resolved directory as `{run-dir}`.

The exact phrasings the Step 1 regexes pin are: `pr-resume-line.js" --body-file "{body-file}" --run-id "{run-id}"`, `` `resolve` `` … `card above is the terminal output` (one sentence, no period between them), and `` `resume` verdict's own `target` ``. Keep the paragraph's wrap at the file's existing ~98-column width.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/issue-claims-stale-open-pr-conformance.test.js tests/flow-claim-preflight.test.js tests/claim-mcp-projection-conformance.test.js tests/flow-mechanics-cli-cutover.test.js tests/log-decision-text-file-sites-conformance.test.js`
Expected: PASS, 0 failures. Then `grep -n -F "### Resume" plugin/skills/flow/claim-targets.md` — every hit names the CLI or the section, none spells the line's shape (AC1.1).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/claim-targets.md tests/issue-claims-stale-open-pr-conformance.test.js
git commit -m "Route claim-targets.md's tombstone Resume read through pr-resume-line.js — refs #4659"
```

---

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (route through `resumeLineUnder`/`parseResumeLine` via a small CLI) | Tasks 1 + 2 |
| Deliverable 2 (extend `tests/issue-claims-stale-open-pr-conformance.test.js`) | Task 2 |
| AC1.1 / AC1.2 (`grep -F "### Resume"` shows no shape; names the CLI; run first against the current tree) | Task 2 `AC1.1, AC1.2` test + Step 4 grep; control recorded in Task 2 Step 1 |
| AC2.1 (a `!` Resume line routes to the resolve path, red on the old prose) | Task 1 `AC2.1` CLI test + Task 2 `AC2.1` prose test |
| AC3.1 (`npm test` passes) | Common Step 5 / `/claude-tweaks:test` (full suite runs centrally) |

## Self-review

- **Spec coverage:** every Deliverable and AC clause above maps to a task.
- **Placeholders:** none.
- **Types:** `resumeVerdict`'s return shape and the CLI's JSON keys are used the same way in both tasks.
