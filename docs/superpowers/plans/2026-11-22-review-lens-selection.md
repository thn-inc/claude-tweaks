# Review Lens Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `/claude-tweaks:review` Step 3 pick its agent lenses per run in code — from facts computed from the diff and each lens's confirmed-finding history — behind a new `review-lens-selection` policy key whose default `tier` reproduces today exactly.

**Architecture:** Three modules under `plugin/bin/lib/review-lens/`: `facts.js` computes named diff facts from git (each fact can fail on its own), `select.js` is a pure function from (tier lens set, facts, history, skip streaks) to the selection, and `selection-record.js` persists each run's selection as `lens-selection.json` and reads skip streaks back from the pipelines root. A CLI, `plugin/bin/review-lens-select.js`, wires them, prints the JSON, writes the record and logs one `SKIP` per left-out lens. Step 3 prose reads a new sub-file only when the key resolves `adaptive`.

**Tech Stack:** Node 18+ CommonJS, `node:test`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-11-22T104903-record-6001/work/6001-spec.md` (record #6001)

Scope keywords: review-lens-selection, step3-lens-selection, review-lens-select

## Global Constraints

- The tier's set is the ceiling: a lens the tier excludes is never added. Tier sets (`step3-lens-dispatch.md`'s table, verbatim): `low` 3b, 3c; `medium` 3b, 3c, 3a, 3f; `high`/`xhigh`/`max` 3b, 3c, 3a, 3f, 3d, 3e, 3g, 3h.
- **No model chooses.** Every rule is a named constant in `select.js`; each constant's source is recorded in that module's header.
- CLI JSON shape, exactly: `{ tier, selected: [<lens id>], skipped: [{lens, reason}], fallback: null | "<reason>" }` — documented in the module header and pinned by a test.
- `review-lens-selection`: `tier` | `adaptive`, default `tier`. `tier` reproduces today exactly; with `adaptive`, Step 3 dispatches the CLI's set on every dispatch path (Task, workflow).
- History is read from the pipelines root (`hooks/run-dir-resolve.js`'s `resolve({ cwd, env, rootOnly: true })` → `{root}/.claude-tweaks/pipelines`), never from `--run`. A missing, unreadable or malformed history selects the full tier set with its reason logged (one `AUTO` line naming it).
- A fact that cannot be computed (base unresolvable, `git diff` fails, any single fact throws) selects the full tier set and logs why — never read as "no facts call for anything".
- With `adaptive` on, the prose "skip a lens if it doesn't apply to this change type" rule and the `low`-tier no-executable-content skip are replaced by the code's facts, not kept as a second filter. Under `tier` both stay exactly as today.
- A bookkeeping-only diff never reaches the selector once #5929 lands; passed directly, it gets the rules as written, no special case.
- `step3-lens-dispatch.md` (49,223 B now; `RAIL_BYTES` 52,500) gains one pointer paragraph only (≤ 450 B → ≥ 2,800 B headroom left). New prose goes in `step3-lens-selection.md`.
- `_shared/policy-schema.md` is 51,733 B (after the catch-up merge of origin/main) — 767 B under the rail. Its new row must be ≤ 650 B; if it does not fit, move a section out first per policy-key-addition site 4.
- **`risk-path-globs` gating — the record's plan-review decision (Reading A).** The selector reads `risk-path-globs` only when control mode is on, through `plugin/bin/lib/policy.js`'s `readRiskPolicy(repoRoot)` — the canonical reader that consults `risk-path-globs` only after `isControlModeOn`, the same gate `plugin/bin/accept-park.js`'s `decide` applies ("as readRiskPolicy gates", #5830). With control mode off (`controlMode: false`), only `express/eligibility.js`'s `isProtectedPath` and the record's `Risk-flags:` set the "risk path touched" fact. The key's contract and its `_shared/policy-schema.md` doc row stay unchanged — no task edits the `risk-path-globs` row.
- Commit messages: `{Verb} {what} — {detail}`, end with the `Claude-Session:` trailer; reference the record only as `refs #6001`.

**Governing skills (quoted verbatim).**

policy-key-addition (`.claude/skills/policy-key-addition/SKILL.md`), sites 1-4 and 7:
> 1. **The `POLICY_KEYS` row.** `key` (flat kebab-case, `tests/policy-key-naming.test.js`), `type` (`boolean`, `enum`, `integer`, `string`, `list` or `map`), `values` for an enum, and `default` unless the default is derived […] `summary`, `category` and `tier` are required (`tests/policy-schema-metadata.test.js`).
> 2. **The tier.** The core tier has an enforced cap of 12 (`tests/policy-schema-metadata.test.js`) and sits at it, so a new key is `advanced` unless it replaces a core one.
> 3. **The key count.** `tests/policy-schema.test.js` pins `POLICY_KEYS.length`. Bump it in the same commit, and rewrite the `Last bump: {old} -> {new}, #{record}` line directly above the assertion — the test fails when that line's new value differs from the pin.
> 4. **The doc row** in `_shared/policy-schema.md`. Every key needs a table row there that starts `` | `{key}` | `` (`tests/policy-key-naming.test.js`), and its summary must not be copied verbatim from the row's `summary` (`tests/policy-schema-metadata.test.js`). State the value the resolver returns for unset, set and malformed input, from the code, not from intent. […] Measure `wc -c` on `_shared/policy-schema.md` against `RAIL_BYTES` (`plugin/bin/lib/skill-audit/budgets.js`) before writing the row, and plan the section move in the same task when the rows will not fit.
> 7. […] "Lands" means merges: a key whose first consumer arrives in a later task of the same PR merges together with it, so it takes no marker […] #5599's `review-lens-dispatch` row (task 1) and its reader `step3-workflow-dispatch.md` (task 4) shipped this way.
> Every new key gets this decision, even when the answer is neither flag. […] Say the decision in the comment above the row, as both of those do.

gh-api-module-pattern's CLI wrapper contract (`.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`):
> Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw (e.g. `remoteUrl` outside a git repo) is try/caught into the documented exit-code contract.
> **A CLI that tests call in-process meets the entry contract** (#5374; `plugin/bin/resolve-policy.js` is the worked example). It exports `run` and `realDeps`; `argv` is `process.argv.slice(2)`, and `run` returns an integer exit code or a Promise of one. The script entry is the file's last statement: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`.

prose-code-twin-pin applies to the tier table (prose in `step3-lens-dispatch.md`, code in `select.js`'s `TIER_LENSES`): a conformance test pins the two equal (Task 6). bin-source-scan-conformance applies to every new `plugin/bin/` file: run `tests/windows-hide-spawn-conformance.test.js`, `tests/path-guard-conformance.test.js` and the other `tests/*-conformance.test.js` scans over `plugin/bin` after each code task (sanctioned forms: `execFileSync(..., { windowsHide: true })`, `lstatType` from `plugin/bin/lib/path-guard` instead of `fs.existsSync`). skill-prose-conformance-tests applies to Task 6's prose pins (prove each assertion can go red).

## Review Focus

1. A history that is present but holds `errors` for individual runs must still be usable (those runs are already excluded); only a thrown read, a non-object result, a malformed lens entry (Task 2's `historyProblem`), or an `unreadable root` / `unreadable archive` error is "malformed history" → fallback. Test in Tasks 2 and 4.
2. Markdown with an added line inside a fenced block that was opened *before* the hunk (fence state must come from the post-image file, not the hunk alone). Test in Task 1.
3. A renamed or deleted file: a delete contributes its path kind but no added lines; a rename's new path is the one classified. Test in Task 1.
4. A `--base` that resolves but equals HEAD (empty diff): facts are computable and all false → rules as written. Test in Task 4.
5. Skip-streak input where `lens-selection.json` is malformed in one run: that run is ignored for streaks and the lens is forced (safe direction), never read as streak 0. Test in Task 3.

---

### Task 1: Diff facts (`facts.js`)

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/review-lens/facts.js`
- Test: `tests/bin-lib/review-lens/facts.test.js`
- Waived `plugin/skills/review/step3-tier-variants.md`: read only, by Step 3 of this task, for the executable-content definition it pins.

**Interfaces:**
- Produces: `FACT_NAMES` (frozen array), `computeFacts({ cwd, base, head = 'HEAD', riskFlags = [], riskPolicy, git }) → { ok: true, facts } | { ok: false, fact, reason }`, `classifyPathKind(path) → 'prose'|'source'|'test'|'config'|'workflow'`, `isExecutableProseLine(line) → boolean`.
- `riskPolicy` is `readRiskPolicy`'s result shape `{ controlMode, pathGlobs, globsInvalid }` (the CLI reads it, Task 4), or `{ error: string }` when that read threw. `controlMode: false` → `pathGlobs` is never consulted. `controlMode: true, globsInvalid: true` or `{ error }` → the `riskPathTouched` fact fails (`{ ok: false, fact: 'riskPathTouched', reason }` naming `risk-path-globs`).
- `facts` keys (all booleans unless noted): `paths` (array of `{path, status, kind}`), `kinds` (object `{prose, source, test, config, workflow}` → boolean), `executableContent`, `shellInvocationAdded`, `inputHandlingAdded`, `errorHandlingTouched`, `riskPathTouched`, `riskFlags` (array of strings), `newFiles`, `newModules`, `perCallPath`, `loopSpawn`.
- `git` is an injectable `(args: string[]) => string` (stdout) that throws on non-zero; the default spawns `execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 })`.

- [ ] **Step 1: Write the failing tests** (real git, via `tests/helpers/git-fixtures.js`'s `committedRepo`/`fixtureGit`; base = the first commit, head = a second commit):
  - `AC10.1: low-tier executable-content fact matches step3-tier-variants.md` — fixtures, each asserting `facts.executableContent`: (a) only `docs/a.md` with prose lines → `false`; (b) `docs/a.md` adding a line inside a fence that the base already opened (fence opened at line 3 in base, hunk adds line 6) → `true`; (c) `docs/a.md` adding `` Run `node -e "x"` `` → `true`; (d) adding a line `git status` / `gh pr view 1` → `true`; (e) only `notes.txt` prose → `false`; (f) any `.js` file changed → `true`; (g) a `.json` config changed → `true`; (h) `docs/a.md` deleting a line that sat inside a fence in the base (no added line) → `true`; (i) `docs/a.md` deleting a `git status` line → `true` (the definition's "changed line" covers deletions — plan-review clarification, Reading B).
  - `classifies path kinds` — `README.md`→prose, `plugin/bin/x.js`→source, `tests/x.test.js`→test, `.github/workflows/ci.yml`→workflow, `plugin/x.json`→config; a rename reports its new path; a delete reports `status: 'D'` and adds no lines.
  - `AC2.2 facts: git call inside a per-file loop in plugin/bin sets loopSpawn and perCallPath stays false outside hooks` — add `plugin/bin/lib/x.js` with `for (const f of files) { execFileSync('git', ['log', f]); }` → `loopSpawn: true`, `shellInvocationAdded: true`.
  - `loopSpawn when a spawn is added inside an existing loop` — base already has `for (const f of files) {` … `}` in `plugin/bin/lib/x.js`; the head commit adds only `    execFileSync('git', ['log', f]);` inside its body (the `-U0` hunk holds no loop token) → `loopSpawn: true`. And the converse: a loop added around an existing `execFileSync('git', …)` call → `loopSpawn: true`. A spawn added at top level of a file that has an unrelated loop elsewhere (closed before the spawn line) → `loopSpawn: false`.
  - `perCallPath for hook and runner paths` — a change under `plugin/bin/lib/hooks/` or to `plugin/bin/hooks.js`, `tools/run-tests.js`, `plugin/bin/verify.js` → `perCallPath: true`.
  - `riskPathTouched from protected paths, Risk-flags and risk-path-globs under control mode only (Reading A)` — `plugin/skills/_shared/x.md` → `true` (via `express/eligibility.js`'s `isProtectedPath`), whatever `riskPolicy`; `src/auth/a.js` with `riskPolicy: { controlMode: true, pathGlobs: { auth: ['src/auth/**'] }, globsInvalid: false }` → `true`; the same path and globs with `controlMode: false` → `false` (globs never consulted); `src/auth/a.js`, `controlMode: false`, `riskFlags: ['public-contract']` → `true`.
  - `newFiles/newModules` — an added `.md` → `newFiles: true, newModules: false`; an added `plugin/bin/lib/y.js` → both `true`.
  - `AC5.1: unresolvable base returns ok:false naming the fact` — `base: 'no-such-ref'` → `{ ok: false, fact: 'paths', reason: /no-such-ref|unknown revision|bad revision/ }`.
  - `AC7.1: a single fact that throws returns ok:false` — inject `git` that answers `diff --name-status` but throws on the `-U0` diff → `{ ok: false, fact: 'addedLines' }`; and `riskPolicy: { controlMode: true, pathGlobs: {}, globsInvalid: true }` → `{ ok: false, fact: 'riskPathTouched', reason: /risk-path-globs/ }`; `riskPolicy: { error: 'EACCES' }` → the same fact fails; `riskPolicy: { controlMode: false, pathGlobs: {}, globsInvalid: false }` → `ok: true` (an invalid block is never read with control mode off).
  - `empty diff (base == head) is computable and all false` — Review Focus 4.

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/bin-lib/review-lens/facts.test.js`
  Expected: FAIL (`Cannot find module '../../../plugin/bin/lib/review-lens/facts'`).

- [ ] **Step 3: Implement `facts.js`.** Read the definition in `step3-tier-variants.md` ("No executable content (`low` only)") and implement it as written: a diff has executable content when any changed path's kind is not `prose` (prose = `.md`, `.markdown`, `.txt`), or any changed line of a prose file — added or deleted, since the definition says "changed line" (plan-review clarification, Reading B) — sits inside a fenced code block (an added line judged against the post-image's fences, a deleted line against the pre-image's, `git show {base}:{path}`), or `isExecutableProseLine` matches a changed line (a `node -e`, a leading-or-backticked `git `/`gh ` invocation, or another shell command token — `npm `, `npx `, `bash `, `sh -c`, `curl `, `$ `). Algorithm: `git diff --name-status -z {base}...{head}` → `parseNameStatusZ` (`plugin/bin/lib/git-z.js`); `git diff -U0 --no-color {base}...{head}` → added lines per path with their post-image line numbers (from `@@ … +start,count @@`) and deleted lines with their pre-image line numbers (from `-start,count`); for prose paths with added lines, `git show {head}:{path}` and walk fences (``` or ~~~ opening/closing, CommonMark-length matching) to mark in-fence line numbers. Line-level facts scan only added lines of `source` files: `shellInvocationAdded` (`child_process`, `execFileSync`, `execSync`, `spawnSync`, `spawn(`, `exec(`), `inputHandlingAdded` (`process.argv`, `process.env`, `readFileSync`, `stdin`, `path.join(`/`path.resolve(` with a non-literal argument), `errorHandlingTouched` (`try {`, `catch`, `throw `, `process.exit`, `.catch(`), `loopSpawn` is read from the post-image of each source file with added lines (`git show {head}:{path}`, already fetched for the fence walk's sibling): a spawn line (a spawn token, or a `git`/`gh` argv literal) and an enclosing loop header (`for (`, `while (`, `.forEach(`, `.map(`) — the nearest preceding line, within `LOOP_LOOKBACK_LINES` (named constant, 40), whose indentation is lower than the spawn line's and which carries a loop token, with no line of indentation ≤ the header's between them — where at least one of the two (the spawn line or the header) is an added line. This catches a spawn added inside an existing loop and a loop added around an existing spawn; the `-U0` hunk alone sees neither. `perCallPath` = a changed source path matching `PER_CALL_PATH_RES` (`/(^|\/)hooks\.js$/`, `/(^|\/)lib\/hooks\//`, `/(^|\/)tools\/run-tests\.js$/`, `/(^|\/)bin\/verify\.js$/`). `riskPathTouched` (Reading A) = any path `isProtectedPath`, or `riskFlags.length > 0`, or — only when `riskPolicy.controlMode === true` — any path matching a `riskPolicy.pathGlobs` list via `issues/blast-radius.js`'s `isSensitivePath`; `riskPolicy.error` or (`controlMode` and `globsInvalid`) throws inside the fact. Header: the Reading A gating, citing `readRiskPolicy` and #6001's decision. Each fact runs inside its own try/catch; the first failure returns `{ ok: false, fact, reason }`. Every regex is linear (no nested quantifiers — regex-scan-linearity). Header comment: what each fact means, which lens prose it stands for, and that the executable-content definition is `step3-tier-variants.md`'s.

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/review-lens/facts.test.js tests/windows-hide-spawn-conformance.test.js tests/path-guard-conformance.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit** — `git add plugin/bin/lib/review-lens/facts.js tests/bin-lib/review-lens/facts.test.js`; `git commit -m "Add review lens diff facts — named per-diff facts the lens selector reads, refs #6001"`.

### Task 2: Pure selection function (`select.js`)

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/review-lens/select.js`
- Test: `tests/bin-lib/review-lens/select.test.js`

**Interfaces:**
- Consumes: `facts` from Task 1 (shape above); `history` = `readLensHistory`'s result (`{ lenses: {id: {runs, confirmed, perRun, shareWithFinding, insufficient}}, skipped, errors }`); `streaks` = `{ ok: true, byLens: {id: n} } | { ok: false, reason }` from Task 3.
- Produces: `TIERS`, `TIER_LENSES` (frozen map tier → frozen lens array, order as in the prose table), `SHARE_FLOOR`, `FORCE_EVERY`, `APPLIES` and `CALLED_FOR` (frozen maps lens → `(facts) => boolean`), `historyProblem(history) → string | null`, `selectLenses({ tier, facts, history, streaks }) → { tier, selected, skipped, fallback }` where `facts` is `computeFacts`'s envelope exactly as Task 1 returns it — `{ ok: true, facts }` or `{ ok: false, fact, reason }`. `selectLenses` unwraps `envelope.facts` once and passes that inner object to every `APPLIES`/`CALLED_FOR` predicate; Task 4 passes the `computeFacts` result straight through.

- [ ] **Step 1: Write the failing tests** (facts built through a `factsOf(overrides)` helper that returns the envelope `{ ok: true, facts: {…} }`, its inner object defaulting every boolean `false`, `kinds` all `false`, `riskFlags: []` and `paths: []` — the shape Task 1 returns; history through `historyOf({ '3d': { share: 0.1 } })` building `runs: 20, insufficient: false` entries):
  - `AC1.1: TIER_LENSES reproduces the tier table` — `low` `['3b','3c']`; `medium` `['3b','3c','3a','3f']`; `high`, `xhigh`, `max` `['3b','3c','3a','3f','3d','3e','3g','3h']`.
  - `AC2.1: docs-only diff at high with 3d below the floor selects no 3d` — prose-only facts, 3d share `0.1`, streak 0 → `selected` lacks `3d`; `skipped` has `{ lens: '3d', reason }` with `reason` naming the share, the floor and "no diff fact calls for it".
  - `AC2.2: the same diff adding a git call inside a per-file loop selects 3d` — facts with `loopSpawn: true, kinds.source: true` → `3d` selected.
  - `AC3.1: insufficient history is always selected when the tier allows it` — every lens `insufficient: true`, prose-only facts, tier `high` → all eight selected.
  - `AC4.1: a lens the tier excludes is never selected` — tier `low`, facts all `true`, every lens above floor → `selected` ⊆ `['3b','3c']`, `skipped` names no lens outside the tier.
  - `AC5.2 / AC7.2: failed facts select the full tier set with a fallback reason` — `facts: { ok: false, fact: 'paths', reason: 'bad revision' }` → `selected` = `TIER_LENSES.high`, `skipped: []`, `fallback` names the fact and reason.
  - `AC8.1: missing, unreadable or malformed history selects the full tier set` — `history: null`, `history: { lenses: {} }`, a lens entry with `insufficient: false, shareWithFinding: 'x'`, and `errors: [{ path: '/r', reason: 'unreadable root (EACCES)' }]` each → full tier set, `fallback` naming why; a history whose `errors` holds only a per-run `step-yield.json missing` entry is NOT a fallback (Review Focus 1).
  - `an unreadable archive is a fallback; unreadable spec members is not` — `errors: [{ path: '/r/archive', reason: 'unreadable archive (EACCES)' }]` → full tier set, `fallback` naming it (the whole archive is gone, so the 20-run window is not the real one); `errors: [{ path: '/r/x', reason: 'unreadable spec members (EACCES)' }]` alone → no fallback (one run excluded, the rest is usable).
  - `a zero-run lens is insufficient, not malformed` — `readLensHistory`'s real shape for a lens with no qualifying run (`{ runs: 0, confirmed: 0, perRun: [], shareWithFinding: null, insufficient: true }`, `history.js` line ~235 — 3h's usual state, since it is one agent and rarely records `reviewers: 2`) → no fallback, the lens is selected as insufficient; build the fixture by calling `readLensHistory` over an empty temp root rather than by hand, so the test tracks the real shape.
  - `above-floor lens runs on every diff it applies to` — 3a share `0.9`: selected for any non-empty diff; 3d share `0.9` with prose-only facts → skipped with reason "does not apply".
  - `forced run every FORCE_EVERY reviews` — 3d share `0.1`, prose-only facts, `streaks.byLens['3d'] = FORCE_EVERY - 1` → selected; `FORCE_EVERY - 2` → skipped; `streaks: { ok: false }` → selected (safe direction).
  - `AC9.1: a bookkeeping-only diff gets the rules as written` — facts for paths `.claude-tweaks/pipelines/r/work/1-spec.md` and `docs/plans/x-ledger.md` only (prose, no executable content), tier `high`, every lens above floor except 3b/3d below, streaks 0 → an exact pinned `{selected, skipped}` (derive it by hand from the constants, write the literal arrays into the test, then prove it red by flipping one `APPLIES` entry); it must be a non-fallback result.
  - `output shape is exactly {tier, selected, skipped, fallback}` — `Object.keys` deep-equal, `selected` in `TIER_LENSES` order.

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/bin-lib/review-lens/select.test.js`
  Expected: FAIL (module not found).

- [ ] **Step 3: Implement `select.js`.** `historyProblem(history)` returns a reason when `history` is not an object, `lenses` is not an object, a tier lens has no entry, an entry's `runs` is not a non-negative integer or `insufficient` is not a boolean, an entry with `insufficient: false` has a `shareWithFinding` that is not a finite number in [0, 1], or `errors` holds an `unreadable root` or `unreadable archive` entry (a whole root or archive lost, so the window is not the real one; an `unreadable spec members` entry excludes one run and is usable, like any other per-run error); a `shareWithFinding: null` on an `insufficient: true` entry is the zero-run shape, never malformed. Rule order per tier lens: (1) a fallback — `facts.ok === false` or `historyProblem(history)` non-null — returns the full tier set, `skipped: []`, `fallback` = reason; (2) `insufficient` → select; (3) `shareWithFinding >= SHARE_FLOOR` → select iff `APPLIES[lens](facts)`, else skip `"{lens}: share {s} ≥ floor {f}, but the diff has no {what} it applies to"`; (4) below floor → select iff `CALLED_FOR[lens](facts)` or the streak forces it (`!streaks.ok` or `byLens[lens] >= FORCE_EVERY - 1`), else skip `"{lens}: share {s} over its last {runs} runs is below floor {f}; no diff fact calls for it ({k} of {FORCE_EVERY} reviews since it last ran)"`. Initial constants (Task 5 retunes them from the replay and records the source): `SHARE_FLOOR = 0.3`, `FORCE_EVERY = 5`; `APPLIES`: 3a any path, 3b/3c `executableContent`, 3d `kinds.source`, 3e `kinds.source || newFiles`, 3f `kinds.source || kinds.test`, 3g `kinds.source || kinds.test || executableContent`, 3h always (3h keeps its own QA-data gate in Step 3); `CALLED_FOR`: 3a `kinds.source || kinds.test`, 3b `riskPathTouched || riskFlags.length > 0 || (executableContent && (shellInvocationAdded || inputHandlingAdded))`, 3c `shellInvocationAdded || inputHandlingAdded || errorHandlingTouched`, 3d `perCallPath || loopSpawn`, 3e `newModules || riskPathTouched`, 3f `kinds.test || newModules`, 3g `newModules`, 3h always. Header comment: the rules, the JSON shape, each constant with its source line ("initial; replaced by Task 5's replay" until Task 5 rewrites it).

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/review-lens/select.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit** — `git add plugin/bin/lib/review-lens/select.js tests/bin-lib/review-lens/select.test.js`; `git commit -m "Add the pure review lens selection function — tier ceiling, history floor, diff facts, refs #6001"`.

### Task 3: Selection record and skip streaks (`selection-record.js`)

**Role:** integration
**Review risk:** high (the streaks decide every forced run of a below-floor lens; a misread streak silently stops a lens from ever running)

**Files:**
- Create: `plugin/bin/lib/review-lens/selection-record.js`
- Test: `tests/bin-lib/review-lens/selection-record.test.js`

**Interfaces:**
- Consumes: `LENS_IDS` from `plugin/bin/lib/review-lens/dispatch-record.js`; `startedAtOf` from `history.js`.
- Produces: `LENS_SELECTION_FILE = 'lens-selection.json'`, `writeLensSelection(runDir, selection)` (writes `{ v: 1, ...selection }` via `plugin/bin/lib/atomic-write.js`'s `writeFileAtomic`), `readLensSelection(dir) → { state: 'absent' } | { state: 'ok', doc } | { state: 'error', reason }`, `readSkipStreaks({ roots, excludeRunId }) → { ok: true, byLens } | { ok: false, reason }`.

- [ ] **Step 1: Write the failing tests** (temp pipelines roots with `archive/`):
  - `round-trips a selection` — write then read deep-equals; a malformed file reads `state: 'error'`.
  - `streak counts consecutive newest runs where the tier allowed the lens and it was skipped` — runs (newest first) skip 3d, skip 3d, select 3d, skip 3d → `byLens['3d'] === 2`; a run whose tier set lacks 3d (low) neither counts nor breaks the streak; a fallback run (all selected) breaks it.
  - `excludes the current run id and dedupes archive twins` — the same run id under the root and `archive/` counts once.
  - `Review Focus 5: one malformed lens-selection.json makes streaks unreadable` — `{ ok: false, reason: /lens-selection\.json/ }` (the selector then forces, Task 2).
  - `an unreadable root is ok:false; a root with no selection files is ok:true with all zeros`.

- [ ] **Step 2: Run to verify they fail** — `node --test tests/bin-lib/review-lens/selection-record.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement.** Order runs by `startedAtOf(runId)` newest first (ties by run id), skipping undated ids; directory listing and file checks through `path-guard`'s `lstatType`, never `fs.existsSync`. Header: the file shape, its one writer (`bin/review-lens-select.js`), and that the parked measurement record reads it beside `lens-dispatch.json`.

- [ ] **Step 4: Run to verify they pass** — `node --test tests/bin-lib/review-lens/selection-record.test.js tests/path-guard-conformance.test.js` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "Add the lens-selection record and skip-streak reader, refs #6001"` (stage the two files by path).

### Task 4: CLI (`review-lens-select.js`)

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/review-lens-select.js`
- Test: `tests/review-lens-select-cli.test.js`
- Modify: `docs/plugin-structure.md` (add the CLI to the `plugin/bin/*.js` CLI list and extend the `plugin/bin/lib/review-lens/` entry with `facts.js`, `select.js`, `selection-record.js`)

**Interfaces:**
- Consumes: Tasks 1-3; `readLensHistory` (`history.js`); `readRiskPolicy(mainRoot)` from `plugin/bin/lib/policy.js` (Reading A: it reads `control-mode` from the main checkout's `policy.yml` — `control-mode` is `policyOnly`, #5830 — and consults `risk-path-globs` only when that is on; a thrown read becomes `riskPolicy: { error }`, so the fact fails and the full tier set runs), passed to `computeFacts` as `riskPolicy`; `mainRoot` from the same `run-dir-resolve.js` `rootOnly` resolution as the history root; `appendEntries`/`formatEntry` from `plugin/bin/lib/log-decision/append.js`, called the way `plugin/bin/log-decision.js`'s `run` calls them (section `/review`, step `Step 3 lens selection`).
- Produces: `node plugin/bin/review-lens-select.js --run <dir> --tier <low|medium|high|xhigh|max> --base <ref> [--risk-flags <csv>]` → stdout one JSON line `{ tier, selected, skipped, fallback }`; writes `{run}/lens-selection.json`; logs one `SKIP` per skipped lens (`condition: {reason} → fallback: lens not dispatched`) or one `AUTO` naming the fallback reason. Exit 0 printed; 1 a write or log failed (nothing printed); 2 malformed invocation or a `--run` the anchoring guard refuses. Exports `run(argv, deps)` and `realDeps` (`cwd`, `env`, `stdout`, `stderr`, `git`, `now`).

- [ ] **Step 1: Write the failing tests** (in-process `run` with a temp main checkout as `cwd` holding `.claude-tweaks/pipelines/`, a real git fixture repo for the diff):
  - `AC6.1 / shape: prints exactly {tier, selected, skipped, fallback} and writes the same to lens-selection.json` — parse stdout, `Object.keys` deep-equal, file content equals stdout plus `v: 1`.
  - `AC2.1 end to end: docs-only diff, 3d history below floor → one SKIP line naming 3d in decisions.md` — seed 20 closed qualifying runs (lens-dispatch.json + step-yield.json with no 3d findings).
  - `AC5.1: an unresolvable --base selects the full tier set and logs one AUTO line naming why`.
  - `AC8.2: no pipelines history root selects the full tier set and logs why` (root missing → `unreadable root`).
  - `Review Focus 4: base equal to HEAD → computable, rules as written`.
  - `exit 2 on a bad --tier, a missing --base, an unknown flag`; `exit 1 and no stdout when the log write fails` (inject a `--run` whose `decisions.md` is a directory).
  - `--risk-flags public-contract calls for 3b`.
  - `Reading A: risk-path-globs is ignored with control mode off` — temp main checkout `policy.yml` with `risk-path-globs: { auth: ['src/auth/**'] }` and no `control-mode` (off), diff touching `src/auth/a.js` only, 3b below floor, streak 0 → 3b skipped; the same with `control-mode: on` → 3b selected; `control-mode: on` with an invalid `risk-path-globs` block → full tier set and one `AUTO` line naming `riskPathTouched`.

- [ ] **Step 2: Run to verify they fail** — `node --test tests/review-lens-select-cli.test.js` → FAIL.

- [ ] **Step 3: Implement** per the CLI wrapper contract quoted above. `--run` is the log and record target only; the history root comes from `run-dir-resolve.js`'s `rootOnly` resolution against `deps.cwd()`. Header documents the JSON shape, the exit codes and every input's failure → fallback mapping. Add the `docs/plugin-structure.md` entries.

- [ ] **Step 4: Run** — `node --test tests/review-lens-select-cli.test.js tests/bin-lib/review-lens/ tests/windows-hide-spawn-conformance.test.js tests/path-guard-conformance.test.js` and the plugin-structure entry test (`git grep -l "plugin-structure" -- tests` names it) → PASS.

- [ ] **Step 5: Commit** — `git commit -m "Add review-lens-select CLI — prints, records and logs the per-run lens selection, refs #6001"`.

### Task 5: Build replay and constant tuning

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/review-lens/select.js` (constants and their header source lines only)
- Test: `tests/bin-lib/review-lens/select.test.js` (created by Task 2; change only expected literals that the retuned constants change; AC2.1/AC2.2/AC3/AC4 cases must stay green unchanged)
- Scratch (never committed): `$SCRATCH/lens-replay.js` under the session scratchpad

**Interfaces:**
- Consumes: `selectLenses`, `TIER_LENSES`, `APPLIES`, `CALLED_FOR` (Task 2), `computeFacts` (Task 1), `deriveStepYield` (`plugin/bin/lib/timing/step-yield.js`, as `tools/step-yield-report.js` uses it) and `confirmedCount` (`history.js`).
- `computeFacts` inputs per replayed run: `riskPolicy` = `readRiskPolicy("/Users/thomasholknielsen/Code Workspaces/claude-tweaks")` read once (this repository has control mode off, so it returns `{ controlMode: false, pathGlobs: {}, globsInvalid: false }`; a thrown read stops the replay, never per-run fallbacks); `riskFlags` = the run's materialized spec's `Risk-flags:` line (`work/{n}-spec.md` or `spec-{N}/work/{N}-spec.md` in the run dir, parsed with `plugin/bin/lib/issues/record.js`'s `parseRiskFlags`), `[]` when the run has no materialized spec. The evidence reports, per slice, how many runs selected through a `fallback` and how many were excluded at each filter; the replay fails (exit non-zero, said in the evidence and PR) when the held-out slice holds no non-fallback run, so the zero-lost pass bar is never met vacuously.

- [ ] **Step 1: Write the replay script.** Over `"/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines"` and its `archive/` (3,312 run dirs, 381 with review findings per `tools/step-yield-report.js`), keep runs that (a) have a review tier read from `decisions.md` (`/review-effort[^.\n]*?resolved[^.\n]*?\b(low|medium|high|xhigh|max)\b/`), (b) have a per-lens yield (`step-yield.json` or derived), and (c) have a computable diff (the run's PR from `run-state.json`'s `pr`, its squash `mergeCommit` via `gh pr view {n} --json mergeCommit`, facts over `{sha}^..{sha}`). Sort by run-id start time. For each run, history = per-lens `{runs, shareWithFinding, insufficient}` over the 20 newest strictly-earlier kept runs in which that lens counts. **Counting rule vs production:** production history (`readLensHistory`) counts a run for a lens only when its `lens-dispatch.json` shows a `completed`, `reviewers: 2` dispatch — a file that exists only from #5998 on, so almost no archived run carries it. The replay therefore counts a run for a lens when that run's own `lens-dispatch.json` qualifies it under `history.js`'s rule where the file exists, and otherwise when the tier allowed the lens and the run's yield is closed and readable (the proxy). Report in the evidence how many replayed lens-runs counted under the production rule and how many under the proxy, and state in the PR that the proxy over-counts dispatches (a tier-allowed lens the session skipped by the prose rule still counts as a run with zero findings, which pushes its share down — the conservative direction for this pass bar, since a lower share skips more and so exposes more lost findings). The first 20 replayed runs read `insufficient`; streaks simulated from the replay's own earlier selections, then call `selectLenses`. Split: tune on the older runs, score on a held-out newest slice of at least 20 runs; require at least 40 runs in total. Report per lens: agents skipped, confirmed findings lost, and lost findings by severity (from the run's review-routing lines, `log-decision/review-routing.js`'s `SEVERITIES`); plus per-run counts excluded at each of (a)-(c).

- [ ] **Step 2: Run it, tune, re-run.** Pick `SHARE_FLOOR`, `FORCE_EVERY` and the `CALLED_FOR`/`APPLIES` fact lists on the tuning slice only, then score once on the held-out slice. Pass bar: zero lost confirmed findings on held-out runs whose facts were computable. Write the full output to `"/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-22T104903-record-6001/evidence/lens-replay.txt"` (`mkdir -p` that `evidence` dir first, plain Bash redirect). Log `AC evidence` via `log-decision.js --status AUTO --step "AC evidence" --text-file {file}` naming AC11, the command shape, run counts and the held-out lost-finding count. If fewer than 40 runs survive the filters, or the held-out slice misses a finding, say so in the evidence and the PR — a miss blocks this repository's opt-in until retuned; it does not block this build.

- [ ] **Step 3: Write the tuned constants into `select.js`** with a header line per constant: `{name} = {value} — tuned on {k} runs ({first}…{last}), held-out {h} runs, lost {x}; evidence lens-replay.txt (#6001 build replay)`.

- [ ] **Step 4: Run** — `node --test tests/bin-lib/review-lens/select.test.js tests/review-lens-select-cli.test.js` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "Tune lens selection constants from the build replay — floor, rotation and fact lists, refs #6001"`.

### Task 6: Policy key and Step 3 prose

**Role:** integration
**Review risk:** high (Step 3's dispatch branches on the key's value, the CLI's exit and output, and the workflow fallback condition)

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (new `POLICY_KEYS` row after `review-lens-dispatch`)
- Modify: `tests/policy-schema.test.js` (`POLICY_KEYS.length` pin +1 and its `Last bump: {old} -> {new}, #6001` line; a resolve test beside the `review-lens-dispatch` one at line ~1120)
- Modify: `plugin/skills/_shared/policy-schema.md` (one row ≤ 700 B after the `review-lens-dispatch` row)
- Create: `plugin/skills/review/step3-lens-selection.md`
- Modify: `plugin/skills/review/step3-lens-dispatch.md` (one pointer paragraph after line 47's scope paragraph)
- Modify: `plugin/skills/review/step3-workflow-dispatch.md` (When-this-applies + Compose: `lenses` args come from the CLI's `selected` when adaptive)
- Modify: `plugin/skills/review/step3-tier-variants.md` (one sentence on the `low` no-executable-content paragraph: under `adaptive` the CLI's `executableContent` fact replaces it; unchanged under `tier`)
- Modify: `docs/journeys/record-lens-dispatches-and-read-lens-history.md` (its "No caller of `readLensHistory` ships yet" sentence → names `review-lens-select.js`)
- Create: `tests/review-lens-selection-conformance.test.js`
- Waived `docs/superpowers/specs/2026-11-18-pipeline-economy-design.md`: names the key only in its Phase 10 record index (line 301 after the catch-up merge); no change.
- Waived `plugin/skills/review/code-mode-steps.md`: read only — #5929 (open) owns the bookkeeping-only fan-out skip there; this task confirms the new sub-file does not restate it.

**Interfaces:**
- Consumes: the CLI (Task 4) and `TIER_LENSES` (Task 2).
- Produces: key `review-lens-selection` (`type: 'enum'`, `values: ['tier', 'adaptive']`, `default: 'tier'`, `category: 'pipeline-behavior'`, `tier: 'advanced'`, neither `policyOnly` nor `policySourceExcluded` — Step 3 resolves it with `--run`, so a run config may set it for one review; say so in the comment above the row, as `review-lens-dispatch`'s does). No `Not yet used` marker: its reader lands in this task.

- [ ] **Step 1: Write the failing tests.**
  - In `tests/policy-schema.test.js`: `review-lens-selection resolves tier by default and for an invalid value, adaptive when set (#6001)` — mirror the `review-lens-dispatch` test's three cases plus its `--run` config case.
  - `tests/review-lens-selection-conformance.test.js`:
    - `AC1.2: step3-lens-dispatch.md's tier table equals select.js TIER_LENSES` — parse the table rows under "Lens scope by `review-effort` tier" (`high` row's leading lens list; `xhigh`/`max` "Same lens set as `high`") and deep-equal `TIER_LENSES`; prove red by mutating a parsed row in a copy.
    - `pointer: resolves review-lens-selection and reads step3-lens-selection.md only when adaptive` — the paragraph names `resolve-policy.js" --values review-lens-selection`, `` `step3-lens-selection.md` ``, and `only when[^.]*`adaptive``; ≤ 450 B.
    - `AC6.2: the Task path and the workflow lenses args read the same CLI output` — `step3-lens-selection.md` names `review-lens-select.js` and the `selected` field once for both paths; `step3-workflow-dispatch.md` names `step3-lens-selection.md` and builds `lenses` from `selected`.
    - `adaptive replaces the prose skip rule` — `step3-lens-selection.md` states the "doesn't apply to this change type" rule and the `low`-tier no-executable-content skip do not apply under `adaptive`; `step3-tier-variants.md` names `adaptive` in its low-tier paragraph.
    - `fallback: a non-zero CLI exit dispatches the full tier set` — the sub-file says so and logs one `AUTO` line naming the exit (the record's "The full-tier fallback logs one `AUTO` line naming its reason"), never a `SKIP`.
    - `workflow fallback under adaptive dispatches the selected set` — `step3-workflow-dispatch.md`'s Fallback section says that under `adaptive` "every lens" and "lenses 3a–3g" mean the CLI's `selected` set (intersected with 3a–3g under conditions 3–5), never the full tier set, and the Task path reads the same CLI output rather than re-running the CLI.
    - each assertion proven red once against a mutated copy (skill-prose-conformance-tests).
- [ ] **Step 2: Run to verify they fail** — `node --test tests/policy-schema.test.js tests/review-lens-selection-conformance.test.js` → FAIL.
- [ ] **Step 3: Write the row, the sub-file, the pointer and the edits.** `step3-lens-selection.md` (new): when it applies (key resolved `adaptive`; `tier` never reads it); the one CLI call (`node "${CLAUDE_PLUGIN_ROOT}/bin/review-lens-select.js" --run "$PIPELINE_RUN_DIR" --tier {tier} --base {base} [--risk-flags {record's Risk-flags:}]`, `{base}` the review's merge base as Step 3's `build-review-context.js` call uses it); dispatch exactly `selected` (3h still also needs its QA-data gate) on the Task path and as the workflow's `lenses`; the CLI logged the `SKIP`/`AUTO` lines itself — write none; exit 1 or 2 or unparseable output → dispatch the full tier set and log one `AUTO` line (`log-decision.js --status AUTO --step "Step 3 lens selection" --text "review-lens-select exit {n}: full tier set dispatched"`), per the record's full-tier-fallback rule; the CLI is run once per review and its output is reused by the workflow path and by that path's Task fallback (`step3-workflow-dispatch.md`'s Fallback: under `adaptive` its "every lens" / "lenses 3a–3g" are the `selected` set, never the full tier set); the prose change-type skip and the low-tier no-executable-content skip are replaced, not kept; `lens-selection.json` sits beside `lens-dispatch.json` for the parked measurement record. Measure `wc -c` on every touched `plugin/skills/**/*.md` and record headroom in the commit body.

Proof(public-contract): the new key's default tier is pinned by tests/policy-schema.test.js to resolve tier for unset and malformed input, and tests/review-lens-selection-conformance.test.js pins step3-lens-dispatch.md's tier table equal to TIER_LENSES, so every consumer's Step 3 lens set is unchanged unless a project opts into adaptive.

- [ ] **Step 4: Run** — `node --test tests/policy-schema.test.js tests/policy-key-naming.test.js tests/policy-schema-metadata.test.js tests/review-lens-selection-conformance.test.js tests/review-lens-workflow-dispatch-conformance.test.js tests/review-lens-dispatch-record-conformance.test.js` and the `rail:` suites (`git grep -l "RAIL_BYTES" -- tests`) → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Add review-lens-selection policy key and Step 3 adaptive selection prose, refs #6001"`.

### Task 7: Parked measurement record

**Role:** integration

**Files:**
- None in the repo (a forge record).

- [ ] **Step 1: File the record** with `/claude-tweaks:capture`, spec-shaped body: title "Measure adaptive review lens selection over 20 reviews and decide the default"; `Defer-reason: blocked-external`, trigger "20 `adaptive` reviews after this repository opts in, or 30 days"; parked; `Related: #6001`; `### Key Files`: `plugin/bin/lib/review-lens/select.js`, `plugin/bin/lib/policy-schema.js`; AC: confirmed findings per run no lower than 8.3 with fewer lens agents, read from `step-yield.json`, `lens-dispatch.json` and `lens-selection.json`; the design's three quality guards no worse; outcome a default-flip record or a stated reason to keep `tier`. The trigger stays exactly as the record states it (plan-review clarification, Reading A); the body's Current State also says that `readLensHistory` reads a lens `insufficient` until it has 20 qualifying `lens-dispatch.json` runs, that no archived run carries one yet, and so the first `adaptive` reviews dispatch the full tier set — the measurement reports how many of its reviews skipped at least one lens, and a window in which none did is reported as "not yet measurable", never as "no reduction".
- [ ] **Step 2: Verify** — `gh issue view {n} --json labels,body` shows `parked` and the Defer-reason; log `AC evidence` for AC12 with the record number.
- [ ] **Step 3: Link it** — the PR body's verdict section and the ledger name `#{n}` (AC12).

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (pure function, rules, facts) | 1, 2, 5 |
| Deliverable 2 (CLI, JSON, SKIP/AUTO lines) | 4 |
| Deliverable 3 (policy key) | 6 |
| Deliverable 4 (Step 3 prose, workflow args) | 6 |
| Deliverable 5 (replay) | 5 |
| Deliverable 6 (parked record) | 7 |
| AC1.1, AC1.2 | 2, 6 |
| AC2.1, AC2.2 | 1, 2, 4 |
| AC3.1 | 2 |
| AC4.1 | 2 |
| AC5.1, AC5.2 | 1, 2, 4 |
| AC6.1, AC6.2 | 4, 6 |
| AC7.1, AC7.2 | 1, 2 |
| AC8.1, AC8.2 | 2, 4 |
| AC9.1 | 2 |
| AC10.1 | 1 |
| AC11.1 | 5 |
| AC12.1 | 7 |

Plan decision (logged at build): the forced-run rule ("once every M reviews in which the tier allows it") needs a record of reviews in which a tier-allowed lens was skipped; `lens-dispatch.json` records only dispatched lenses, so the CLI also writes its printed selection to `{run}/lens-selection.json`. This is the "CLI output" the Gotchas say the parked record reads beside `lens-dispatch.json`. History is still never read from `--run`.

Plan revision (resumed run 2026-11-22T104903-record-6001): the record now carries the plan-review decision (Reading A: `risk-path-globs` read only under control mode, through `readRiskPolicy`); Tasks 1 and 4 apply it. The same revision folds in the six non-blocking rows the first plan review raised but did not apply: the zero-run lens shape is insufficient, not malformed (Task 2); `loopSpawn` reads the post-image so a spawn added inside an existing loop counts (Task 1); the replay states its counting rule against `readLensHistory`'s (Task 5); a CLI failure logs `AUTO`, not `SKIP` (Task 6); the workflow-to-Task fallback dispatches the selected set (Task 6); Task 3 carries a review risk.
