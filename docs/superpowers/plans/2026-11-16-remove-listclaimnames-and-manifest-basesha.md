# Remove listClaimNames and the Manifest's Legacy baseSha Write-Back Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the unused `listClaimNames` helper, stop `manifest.js` writing a legacy `baseSha:` line back into a multi-spec manifest, and correct the prose that still says the key is written or preserved.

**Architecture:** Two independent removals and one prose pass, one commit each. `listClaimNames` is a plain deletion whose one unique piece of coverage (the `gh-absent` failure passthrough) moves onto `listClaimEntries`. For `baseSha` the serializer loses its one write line while the parser stays as it is, so an older manifest that carries the key still parses and loses the line on its next rewrite.

**Tech Stack:** Node (CommonJS), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T231049-spec-5535-5542/spec-5542/work/5542-spec.md` (record #5542). Line numbers below were re-read in this worktree at `81b063c93`.

## Global Constraints

- Not in scope, do not touch: `baseSha` in `verify.js`, `lib/verify/baseline.js`, `pr-checks`, `claims-git-cas.js` and `durable-state.js` (unrelated values with the same name); `listClaimEntries` and every other export of `claim-store.js`; the manifest parser's generic top-level-key branch (`plugin/bin/lib/flow/manifest.js:74-78`), which is what keeps an older manifest parsing; how boundary freshness and batch curation derive their base.
- `tests/multispec-boundary-freshness.test.js` stays unedited (its `:75` pins that the `baseSha` yq read stays gone).
- `docs/superpowers/specs/2026-11-15-audit-simplification-design.md:81` and the run ledger's title (`docs/plans/2026-11-16-spec-5535-5542-ledger.md:1`) name `listClaimNames`. They are a design record and run bookkeeping; leave them.
- `git grep -w baseSha` matches the unrelated verify, baseline and claims values. Scope every search to `plugin/bin/lib/flow`, `plugin/skills/flow`, `docs/hooks.md` and `docs/journeys/respond-to-multispec-boundary-drift.md`.
- `git grep -E` with `\b` silently matches nothing on this machine. Use `-w`, `-F` or `-P`.
- Commit subjects use `{Verb} {what} — {detail}` (imperative, no conventional-commit prefix), with a `refs #5542` body line.
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.
- For any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it — published or external consumers may depend on them. Task 2 is the one behavior change here; its new test in Step 1 is that test.
- From the project skill `removal-condition-execution` (quoted verbatim, these apply):
  - "A test title is a string literal no assertion reads, so it stays green while wrong"
  - "| a code comment, a test title, a test comment | rewrite; behavior unchanged unless the record says otherwise |"
  - "| a test assertion | re-anchor (a sentinel) or retarget (a pin), never only delete |"
  - How the assertion row applies here: the failure-passthrough test is retargeted onto `listClaimEntries` (Task 1). The two tests deleted outright assert only what `listClaimEntries`' own tests already pin: the request path with `recursive=1` and the no-`-f` rule are asserted at `tests/bin-lib/issues/claim-store.test.js:315-316`, and the name mapping was `listClaimNames`' own behavior, which no longer exists.

## Authoring-time probes (recorded output)

- The spec's `baseSha` gate, run before this plan was written against the main checkout's run root `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines` (git-dir equals git-common-dir there): the `grep -rl --include=manifest.yml --exclude-dir=archive "baseSha:"` printed 0 files, the `find … -name manifest.yml -not -path '*/archive/*'` counted 7 manifests, and a line-anchored read of those 7 found 0 carrying the key. The manifest edits may proceed. Full output is in the run directory's `evidence/basesha-gate.txt`.
- AC1's grep, control run on the unmodified tree: `git grep -n -w listClaimNames -- plugin tests` prints 11 lines — `plugin/bin/lib/issues/claim-store.js:265,816` and `tests/bin-lib/issues/claim-store.test.js:5,165,183,187,189,299,320,321,323`.
- AC4's grep, control run: `git grep -n -F "m.baseSha" -- plugin` prints `plugin/bin/lib/flow/manifest.js:87`.
- AC5's greps, control run: `git grep -n -F "only written under" -- plugin/skills/flow` prints `plugin/skills/flow/multispec-freshness.md:13`; `git grep -n -w baseSha -- plugin/skills/flow docs/hooks.md docs/journeys/respond-to-multispec-boundary-drift.md` prints 7 lines — `docs/hooks.md:59`, the journey page `:35`, `multispec-batch-curation.md:28`, `multispec-freshness.md:13,49,62`, `multispec-run-dir-layout.md:9`.
- Repo-wide sweep for the phrases and names being retired: `git grep -n -F -e "preserved on rewrite" -e "keeps it on rewrite" -e "keeps it untouched on rewrite" -e "only written under" -e "listClaimNames" -- . ':!docs/superpowers' ':!.claude-tweaks' ':!CHANGELOG.md' ':!docs/incident-log.md'` hits only the files this plan edits plus the run ledger's title. No hit under `.claude/skills`.
- No test pins a sentence Task 3 rewrites: `git grep -n -F -e "deliberately not used" -e "merge-base equals" -e "Nothing else writes this file" -e "has no reader" -e "does not record that commit" -e "correctly excludes merged-in" -- tests` prints nothing relevant (one unrelated comment in `tests/bin-lib/code-health/cli-validate-findings.test.js`).
- `serializeManifestYaml` has one caller in `plugin/`: `writeManifest` (`plugin/bin/lib/flow/manifest.js:126`).

## Review Focus

- A caller of `listClaimEntries` on a machine without `gh` must still see `failure: 'gh-absent'`, never an empty list that reads as "no claims". Pinned by Task 1's retargeted test, which Task 1 Step 5 shows going red when the passthrough line is removed.
- A multi-spec run started on an older plugin build, whose `manifest.yml` still carries `baseSha:`, must keep working after an update: the manifest parses, `manifest-init` and `spec-status` rewrite it, every spec's `status` survives, and only the `baseSha` line disappears. Pinned by Task 2's new test.
- Skill prose must still warn an agent off using the legacy key for the run-modified set. Pinned by the unedited `tests/multispec-boundary-freshness.test.js`, run in Task 3 Step 3.

Waived AC1.2: a statement of today's state, recorded as the control run under Authoring-time probes (11 lines); nothing to implement.
Waived AC1.3: a scope statement for AC1's grep; the design doc is left alone per Global Constraints.
Waived AC3.2: a statement of today's state, recorded under Authoring-time probes (`writeManifest` is the one caller); nothing to implement.
Waived AC5.2: listing the remaining `baseSha` lines with their classification in the pull request is done by `/claude-tweaks:build`'s controller after the tasks (see the last section), from the grep Task 3 Step 3 runs.
Waived AC7.1: the whole suite is run once by `/claude-tweaks:build` Common Step 5 through `verify.js` after all three tasks, not inside a task; each task runs the test files its change touches.

---

### Task 1: Remove listClaimNames

**Files:**
- Modify: `plugin/bin/lib/issues/claim-store.js`
- Test: `tests/bin-lib/issues/claim-store.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `plugin/bin/lib/issues/claim-store.js` no longer exports `listClaimNames`. No other task depends on it.

- [ ] **Step 1: Edit the test file to the end state**

`tests/bin-lib/issues/claim-store.test.js`:
  - Line 5: in the top-of-file import, replace `listClaimNames` with `listClaimEntries`.
  - Delete the test `'listClaimNames: happy path extracts names from the {name,sha} entries listClaimEntries returns'` (lines 165-185) and one of the blank lines around it.
  - Replace the test at 187-191 with:

```js
test('listClaimEntries: failure -> empty entries, failure propagated', () => {
  const ghApi = () => ({ stdout: null, failure: 'gh-absent', status: null });
  const r = listClaimEntries(ghApi, 'acme/w');
  assert.deepEqual(r, { entries: [], failure: 'gh-absent' });
});
```

  - Line 299: retitle to `'listClaimEntries: returns name + sha per entry from a single Git Trees API call'`. Its body is unchanged.
  - Delete the test `'listClaimNames: still works, now a thin wrapper over listClaimEntries'` (lines 320-324) and one of the blank lines around it.

- [ ] **Step 2: Run the probe to verify it fails**

Run: `node -e "process.exit('listClaimNames' in require('./plugin/bin/lib/issues/claim-store') ? 1 : 0)"`
Expected: FAIL (exit 1 — the export still exists)

- [ ] **Step 3: Delete the function**

`plugin/bin/lib/issues/claim-store.js`: delete the comment and function at 261-268 (from `// Thin wrapper — the only pre-existing consumer (release-merged.js) is` through the closing `}` of `listClaimNames`), leaving one blank line between `listClaimEntries` and the `// (deps: {ghApi, gitRunner?}, repoSlug, issueNumber, knownTip?)` comment, and delete the `listClaimNames,` export line (816).

- [ ] **Step 4: Run the tests and the probe to verify they pass (AC1.1)**

Run: `node -e "process.exit('listClaimNames' in require('./plugin/bin/lib/issues/claim-store') ? 1 : 0)"`
Expected: exit 0

Run: `node --test tests/bin-lib/issues/claim-store.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS, `fail 0`

Run: `git grep -n -w listClaimNames -- plugin tests`
Expected: no output (exit 1). AC1.1.

- [ ] **Step 5: Show the retargeted test goes red without the passthrough (AC2.1)**

In `plugin/bin/lib/issues/claim-store.js`, temporarily delete the line `  if (r.failure) return { entries: [], failure: r.failure };` inside `listClaimEntries` (line 250).

Run: `node --test --test-name-pattern "failure -> empty entries, failure propagated" tests/bin-lib/issues/claim-store.test.js`
Expected: FAIL — the test reports `failure: null` where it expects `'gh-absent'`. Copy the failing assertion's output into your report.

Restore the line exactly, then:

Run: `node --test --test-name-pattern "failure -> empty entries, failure propagated" tests/bin-lib/issues/claim-store.test.js`
Expected: PASS

Run: `git diff --stat -- plugin/bin/lib/issues/claim-store.js`
Expected: one file, deletions only (the nine lines Step 3 removed), no change inside `listClaimEntries`.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/issues/claim-store.js tests/bin-lib/issues/claim-store.test.js
git commit -m "Remove listClaimNames — no caller since release-merged.js moved to listClaimEntries" -m "refs #5542"
```

### Task 2: Stop writing the legacy baseSha line back into a manifest

**Files:**
- Modify: `plugin/bin/lib/flow/manifest.js`
- Test: `tests/bin-lib/flow/manifest.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `serializeManifestYaml` never emits a `baseSha` line. Task 3's prose describes this behavior ("dropped on the next rewrite").

**Gate before this task is dispatched (controller, not the implementer).** The spec makes the manifest edits wait on a check that no live run carries the key, so the controller re-runs it immediately before dispatching Task 2, not only at authoring time: against the main checkout's run root (the directory `hooks.js resolve-run-dir --root-only` prints, confirmed to be the main checkout by `git rev-parse --git-dir` equalling `--git-common-dir` there), run the spec's `grep -rl --include=manifest.yml --exclude-dir=archive "baseSha:" "{run-root}/.claude-tweaks/pipelines"` and `find "{run-root}/.claude-tweaks/pipelines" -name manifest.yml -not -path '*/archive/*'`, and overwrite the run directory's `evidence/basesha-gate.txt` with the commands, the directory, the manifest count and the result. The implementer never runs it: it reads outside the worktree. If the grep prints any file, Task 2 and Task 3 are not dispatched: the controller stops the manifest work, reports the carrying run, and Task 1's commit stands on its own (the spec: "The `listClaimNames` removal does not depend on this gate and can land regardless").

- [ ] **Step 1: Write the test for the new behavior**

`tests/bin-lib/flow/manifest.test.js`:
  - Replace the test `'#3035: manifestInit preserves a legacy baseSha on an older manifest'` (lines 480-485) with:

```js
test('#5542: a legacy baseSha line on an older manifest parses and is dropped on rewrite', () => {
  const text = 'multispec:\n  parent: x/\n  baseSha: abc123\n  specs:\n    - id: 1\n      status: running\n      subdir: spec-1/\n';
  const parsed = parseManifestYaml(text);
  assert.ok(parsed, 'a manifest carrying the legacy key still parses');
  assert.doesNotMatch(serializeManifestYaml(parsed), /baseSha/);

  const dir = tmpRunDir();
  fs.writeFileSync(path.join(dir, 'manifest.yml'), text);
  manifestInit({ runDir: dir, specs: ['1', '2'] });
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'manifest.yml'), 'utf8'), /baseSha/);
  const after = readManifest(dir);
  assert.deepEqual(after.multispec.specs.map((s) => [s.id, s.status]), [[1, 'running'], [2, 'pending']]);
  assert.equal(after.multispec.parent, 'x/');
});
```

  - In the test `'parseManifestYaml reads baseSha and trailing comment when present'` (lines 47-59), change only the fixture's trailing comment on the `baseSha:` line from `# omitted when MULTISPEC_CURATION_DEFER is unset` to `# legacy key, no longer written`. The test still proves the parser accepts the key and strips a trailing comment.

- [ ] **Step 2: Run the probe to verify it fails**

Run: `node -e "const m=require('./plugin/bin/lib/flow/manifest');const p=m.parseManifestYaml(['multispec:','  parent: x/','  baseSha: abc123','  specs:','    - id: 1','      status: pending','      subdir: spec-1/',''].join(String.fromCharCode(10)));process.exit(p && !/baseSha/.test(m.serializeManifestYaml(p)) ? 0 : 1)"`
Expected: FAIL (exit 1 — the serializer still writes the line)

Run: `node --test --test-name-pattern "legacy baseSha line on an older manifest" tests/bin-lib/flow/manifest.test.js`
Expected: FAIL — the first `doesNotMatch` reports the serialized text contains `baseSha`.

- [ ] **Step 3: Remove the write-back line and reword the comment**

`plugin/bin/lib/flow/manifest.js`:
  - Delete line 87, `  if (m.baseSha) lines.push(`  baseSha: ${m.baseSha}`);`.
  - Replace header comment lines 5-7:

```js
// shape — `{ multispec: { parent, baseSha?, specs: [{id, status, subdir,
// startedAt?}] } }` (`baseSha` is legacy: parsed and preserved on rewrite,
// never written by manifestInit — nothing reads it) — not a general YAML
```

    with:

```js
// shape — `{ multispec: { parent, specs: [{id, status, subdir,
// startedAt?}] } }` (a legacy `baseSha:` line still parses but is not
// written back, so the next rewrite drops it) — not a general YAML
```

  Leave `parseManifestYaml` untouched.

- [ ] **Step 4: Run the tests and the probe to verify they pass (AC3.1, AC4.1)**

Run: `node -e "const m=require('./plugin/bin/lib/flow/manifest');const p=m.parseManifestYaml(['multispec:','  parent: x/','  baseSha: abc123','  specs:','    - id: 1','      status: pending','      subdir: spec-1/',''].join(String.fromCharCode(10)));process.exit(p && !/baseSha/.test(m.serializeManifestYaml(p)) ? 0 : 1)"`
Expected: exit 0. AC3.1: the text with a top-level `baseSha: abc123` line parses and serializes with no `baseSha` line.

Run: `node --test tests/bin-lib/flow/manifest.test.js tests/multispec-boundary-freshness.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS, `fail 0`

Run: `git grep -n -F "m.baseSha" -- plugin`
Expected: no output (exit 1). AC4.1.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/flow/manifest.js tests/bin-lib/flow/manifest.test.js
git commit -m "Stop writing the manifest's legacy baseSha line back — nothing reads it since #3035" -m "refs #5542"
```

### Task 3: Correct the prose that says the key is written or preserved

**Files:**
- Modify: `docs/hooks.md:59`
- Modify: `plugin/skills/flow/multispec-run-dir-layout.md:9`
- Modify: `plugin/skills/flow/multispec-freshness.md:13`
- Modify: `plugin/skills/flow/multispec-batch-curation.md:28`
- Modify: `docs/journeys/respond-to-multispec-boundary-drift.md:35`

**Interfaces:**
- Consumes: Task 2's behavior — a legacy `baseSha:` line parses and is dropped on the next rewrite.
- Produces: nothing other tasks use.

Every edit below is a replacement of the quoted clause only; the rest of each (long) line stays byte-identical.

- [ ] **Step 1: Run the probe to verify it fails**

Run: `node -e "const {execFileSync}=require('child_process');let out='';try{out=execFileSync('git',['grep','-n','-F','-e','only written under','-e','preserved on rewrite','-e','keeps it on rewrite','-e','keeps it untouched on rewrite','-e','merge-base equals','--','plugin/skills/flow','docs/hooks.md','docs/journeys/respond-to-multispec-boundary-drift.md'],{encoding:'utf8'})}catch(e){out=e.stdout||''}process.stdout.write(out);process.exit(out.trim()?1:0)"`
Expected: FAIL (exit 1 — it prints the five stale sentences)

- [ ] **Step 2: Make the seven replacements**

`docs/hooks.md:59` — replace `so nothing writes it; it is parsed and preserved on rewrite for older manifests.` with `so nothing writes it; an older manifest that still carries one parses, and the line is dropped on the next rewrite.`

`plugin/skills/flow/multispec-run-dir-layout.md:9` — replace `an older manifest that carries one keeps it on rewrite:` with `an older manifest that carries one still parses, and the line is dropped on its next rewrite:` (keep the trailing colon: it introduces the example below).

`docs/journeys/respond-to-multispec-boundary-drift.md:35` — replace `and an older manifest that still carries one keeps it untouched on rewrite.` with `and an older manifest that still carries one loses the line on its next rewrite.`

`plugin/skills/flow/multispec-freshness.md:13` — replace `` `manifest.yml`'s `baseSha` is deliberately not used here: it is only written under `MULTISPEC_CURATION_DEFER=1`, and after the first boundary merge it would count merged-in upstream files as run-modified — false-positive escalations. `` with `` `manifest.yml`'s legacy `baseSha` key is deliberately not used here: nothing writes it, and where an older manifest still carries one it would, after the first boundary merge, count merged-in upstream files as run-modified — false-positive escalations. ``

`plugin/skills/flow/multispec-freshness.md:49` and `:62` — these only warn against using the key, so they stay; make the key read as legacy rather than live. At `:49` replace `` not `manifest.yml`'s `baseSha`, `` with `` not `manifest.yml`'s legacy `baseSha` key, ``. At `:62` replace `` Using `manifest.yml`'s `baseSha` for the run-modified set `` with `` Using `manifest.yml`'s legacy `baseSha` key for the run-modified set ``.

`plugin/skills/flow/multispec-batch-curation.md:28` — replace `` The merge-base equals `manifest.yml`'s `baseSha` when no boundary freshness merge (`multispec-freshness.md`) landed, `` with `` The merge-base is the batch's starting commit when no boundary freshness merge (`multispec-freshness.md`) landed, ``.

- [ ] **Step 3: Run the probe and the tests to verify they pass (AC5.1, AC6.1)**

Run: `node -e "const {execFileSync}=require('child_process');let out='';try{out=execFileSync('git',['grep','-n','-F','-e','only written under','-e','preserved on rewrite','-e','keeps it on rewrite','-e','keeps it untouched on rewrite','-e','merge-base equals','--','plugin/skills/flow','docs/hooks.md','docs/journeys/respond-to-multispec-boundary-drift.md'],{encoding:'utf8'})}catch(e){out=e.stdout||''}process.stdout.write(out);process.exit(out.trim()?1:0)"`
Expected: exit 0, no output

Run: `git grep -n -F "only written under" -- plugin/skills/flow`
Expected: no output (exit 1). AC5.1.

Run: `git grep -n -w baseSha -- plugin/skills/flow docs/hooks.md docs/journeys/respond-to-multispec-boundary-drift.md`
Expected: 6 lines — `docs/hooks.md:59`, the journey page `:35`, `multispec-freshness.md:13`, `:49`, `:62` and `multispec-run-dir-layout.md:9`; `multispec-batch-curation.md` no longer appears. Paste the output into your report: the controller classifies each line in the pull request.

Run: `node --test tests/multispec-boundary-freshness.test.js tests/multispec-ledger-deletion-order.test.js tests/multispec-ceremony-downgrade-ruling.test.js tests/flow-mixed-execution-convention.test.js`
Expected: PASS, `fail 0`. AC6.1: `tests/multispec-boundary-freshness.test.js` passes unedited.

Run: `git diff --stat`
Expected: five files, each `1 +` / `1 -` except `multispec-freshness.md` (`3 +` / `3 -`).

- [ ] **Step 4: Commit**

```bash
git add docs/hooks.md plugin/skills/flow/multispec-run-dir-layout.md plugin/skills/flow/multispec-freshness.md plugin/skills/flow/multispec-batch-curation.md docs/journeys/respond-to-multispec-boundary-drift.md
git commit -m "Say the manifest's legacy baseSha key is dropped on rewrite — five prose sites" -m "refs #5542"
```

---

## After the tasks (controller, not an implementer task)

- Record the `baseSha` gate and the scratch checks for AC1, AC3, AC4 and AC5 as `AC evidence` entries in the run's `decisions.md`, with their output under the run directory's `evidence/`; record Task 1 Step 5's red run as the AC2 evidence.
- Put the gate's commands, the directory scanned, the number of manifests examined and the result in the pull request.
- List in the pull request the output of `git grep -n -w baseSha -- plugin/skills/flow docs/hooks.md docs/journeys/respond-to-multispec-boundary-drift.md`, each line marked as rewritten or as a legacy-key warning.
