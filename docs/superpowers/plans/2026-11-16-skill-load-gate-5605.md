# Skill-Load Gate (#5605) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One CLI, `plugin/bin/skill-gate.js`, tells the seven build/test/review/flow steps that invoke `/claude-tweaks:journeys`, `/claude-tweaks:visual-review` and `/claude-tweaks:design-wrapper` whether the diff has anything for that skill, so a `skip` never loads it.

**Architecture:** Pure rules in `plugin/bin/lib/skill-gate/index.js` (`decide`), with the wrapper modes delegating to `design-detect`'s `evaluate()`; an IO layer in the same module (`readJourneys`, `gate`) that resolves changed files through `lib/verify/changed-files.js`, reads journeys fail-open and turns every throw into `proceed` with a `cannot tell: ` reason; a thin `run(argv, deps)` CLI that validates flags, anchors `--run`, logs a skip through `lib/log-decision/append.js` and prints one JSON line. A new `_shared/skill-load-gate.md` holds the invocation and result handling; seven skill steps cite it before their invocation text. A maintainer replay tool reports what the gate would have skipped over merged work.

**Tech Stack:** Node 18+ CommonJS, `node:test`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T004127-record-5605/work/5605-spec.md` (record #5605). Read it; every Deliverable and AC below is cited by id.

Scope keywords: design-detect.js, Caller-side pre-check, design-wrapper-handling, visual-review --mode=recommendation, Skipped — no UI changes

## Global Constraints

- Exit codes (Deliverable 2): `0` for either decision, `2` malformed invocation (usage text on stderr), `3` when `--run` names a directory that is missing or not anchored under the main checkout. State all three in the file header comment and `USAGE`.
- Output (Deliverable 2): exactly one JSON line `{decision: "proceed"|"skip", reason, journeys?, logged?}`. `journeys` only on a `visual-review` skip; `logged` only on a skip (`true` written, `false` no `--run`).
- Fail-open prefix (Deliverable 4): the literal `cannot tell: ` — only on the Deliverable 4 cases, each also writing exactly one stderr line and no `decisions.md` line. No `proceed` a rule reached carries it (AC6).
- Skip line (Deliverable 5), via `formatEntry` from `plugin/bin/lib/log-decision/append.js`: `- SKIP {HH:MM:SS} — {step} (skipped): condition: {reason} → fallback: {skill-label} not loaded. Reversibility: n/a.` where `{skill-label}` is `journeys`, `visual-review`, or `design-wrapper {mode}`. Collapse whitespace in `reason` to single spaces before formatting (a path can carry a newline).
- `--run`, `--section`, `--step` go together: one or two without the rest exits 2.
- `SKIP_REASONS` strings from `plugin/bin/lib/design-detect/index.js` are a wire contract: pass them through verbatim; never reword one.
- `plugin/bin/design-detect.js` and `plugin/bin/lib/design-detect/index.js` are not edited (AC11). `tests/bin-lib/design-detect/cli.test.js` is not edited.
- AC10 byte ceilings (merge base `026e203f3`, re-measure `git show {merge-base}:{path} | wc -c` before editing): `plugin/skills/review/code-mode-steps.md` 52,358; `plugin/skills/flow/SKILL.md` 51,935; `plugin/skills/build/SKILL.md` 49,343. After the edit each is `<=` its ceiling. `RAIL_BYTES` is 52,500.
- `git` calls: argv arrays, `--end-of-options` + `--verify` before any caller-supplied ref, `-z` on any path-list read, quiet stdio `['ignore','pipe','pipe']`, `windowsHide: true`, `cwd` from `deps.cwd()`, `env: deps.env`.
- Filesystem existence/type checks go through `plugin/bin/lib/path-guard` (`lstatType`, `resolveLeaf`, `canonicalRealpath`, `isAncestorOrSelf`); never `fs.existsSync`. Read a file directly and treat `ENOENT`/`ENOTDIR` as absent; never check-then-read.
- Commit messages: `{Verb} {what} — {detail}`, ending `refs #5605` and the `Claude-Session:` trailer `Claude-Session: https://claude.ai/code/session_01X7gPF9JKM9yvztoRbGNheB`. Never `closes`/`fixes`.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

### Governing project-skill rules (verbatim)

From `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`:

> Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw (e.g. `remoteUrl` outside a git repo) is try/caught into the documented exit-code contract — an un-wrapped deps call is where #610's one post-review high landed.

> **A CLI that tests call in-process meets the entry contract** (#5374; `plugin/bin/resolve-policy.js` is the worked example). It exports `run` and `realDeps`; `argv` is `process.argv.slice(2)`, and `run` returns an integer exit code or a Promise of one. The script entry is the file's last statement: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`. The standard io keys, each present only when the CLI uses it, are `stdout(text)`, `stderr(text)`, `cwd()`, `env` (a plain object, read-only), `stdin()` (the whole input as a string) and `homeDir()`. Above the guard and in everything `run` calls there is no `process.exitCode`, `process.exit()`, `process.chdir()` or write to `process.env`. [...] Read `deps.cwd()` only where a relative path or a child process needs it [...] Every child process is started with a `cwd` derived from `deps.cwd()` and with `env: deps.env`, and a library function on the CLI's path takes that `env` as an option whose default is the inherited environment [...] Tests call the CLI through `tests/helpers/run-cli.js` (`runCli`, or `runCliSync` for a synchronous `run`), passing an absolute `cliPath`; [...] each converted CLI keeps one or two `spawnCli` smoke tests for the script entry, shebang and exit code. The helper's `env` defaults to `{}` and is the whole environment the CLI sees, so a CLI that starts `git` or `gh` needs `PATH` (and `SystemRoot` on Windows) in the `env` the test passes.

> `require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout). `--help` short-circuits before any availability probe.

> **Filesystem reads in a new `plugin/bin/` CLI follow two rules no review is guaranteed to catch.** An existence or type check goes through `plugin/bin/lib/path-guard`'s `lstatType`, never a bare `fs.existsSync` — `tests/path-guard-conformance.test.js` (AC3.1) flags the token in any new `plugin/bin/lib/` file. A file the CLI is about to read is read directly with `ENOENT`/`ENOTDIR` caught as "absent", never checked for existence first (`docs/donts.md` `[IL-146]` [...]).

From `.claude/skills/gh-api-module-pattern/run-dir-boundary-guards.md`:

> **(3) The *Sanctioned-writer* family** [...] applies the same strict anchoring, but through one of two exported `resolveTarget` copies [...] `plugin/bin/lib/log-decision/append.js`'s (imported by `log-decision.js`, and also by CLIs outside this family that append to `decisions.md` beside their main work — `repair-claim.js`, `release-claim.js`, `materialize.js`, `claim-targets.js` — which keep their own exit codes) — and refuses with exit **3**, not 2. Import the copy that sits beside the writer you call [...] and pin the refusal with a fixture carrying both a real main-checkout run dir and a worktree-local shadow of it, asserting the shadow's file is byte-unchanged after the exit 3.

Decision (recorded per the cli-wrapper-contract passthrough rule): skill-gate's outcome is the JSON verdict, and its `decisions.md` line is an audit beside it, so it imports `resolveTarget`/`formatEntry`/`appendEntry` from `append.js` (as `pr-checks.js` does) rather than delegating to `log-decision.js`'s `run`.

From `.claude/skills/gh-api-module-pattern/SKILL.md`:

> **An argv array stops shell injection, not flag injection.** [...] For `git` the separator is **`--end-of-options`, not `--`** [...] **`--end-of-options` alone never resolves a revision — it needs `--verify` alongside it.**

> **A seam whose calls are *probes* runs quiet, and carries its own error class so the CLI can pick the exit code.** `plugin/bin/lib/verify/changed-files.js` [...] raises a named `ChangedFilesError` [...] and the *CLI* — not the module — decides what an unresolvable base means per mode [...] and both re-`throw` anything that is not a `ChangedFilesError` rather than flattening an unrelated bug into a tidy exit code.

(For skill-gate, an unresolvable base is the Deliverable 4 `cannot tell:` case; any other throw is also `cannot tell:` because Deliverable 4 says "any step of the gate throws" — it is reported, never swallowed silently.)

From `.claude/skills/skill-prose-conformance-tests/SKILL.md`:

> When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** — `assert.throws(() => assertBlock(mutated), { message }, …)` — preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control.

> Build throwaway git repos from `tests/helpers/git-fixtures.js` (`gitRepo`, `FIXTURE_TIMEOUT_MS`), never a hand-rolled `git init` ladder

> Slice with `tests/helpers/conformance-asserts.js`'s `sectionOf(text, '## Heading')` and `lineStartingWith(text, prefix)` instead of writing another local copy [...] `sectionOf` matches the whole heading line, throws when it is missing, and ends at the next `## ` or the end of the text.

> Import the shipped parser's constants; never retype them into the test's own helper

From `.claude/skills/skill-prose-conformance-tests/executable-snippet-pins.md`:

> Reach for **byte-pinning** when the probe has to wrap the snippet in fixture-specific surroundings — then assert it byte-identical **and** execute it.

> Pass `CLAUDE_PLUGIN_ROOT` with forward slashes (`path.join(ROOT, 'plugin').split(path.sep).join('/')`)

From `.claude/skills/shared-contract-extraction/SKILL.md`:

> 1. **Derive the consumer list before writing the contract.** Grep every spelling of the retired vocabulary **and its regex-escaped form**; leaf-only sub-files and test pins are what a shape-match sweep misses. Pair the single-line grep with a `grep -z` / `\s+` control scan — hard-wrapped prose splits a literal mid-command `[IL-66]`.

> - **The contract owns recognition and policy; consumers own outcomes.**

> 4. **Update the edges, once.** Every skill relationship is stated once in `docs/skill-graph.md` [...] A new `_shared` file means adding its consumer edges there and adding nothing to any `SKILL.md`'s relationship prose.

From `.claude/skills/prose-code-twin-pin/SKILL.md`:

> If a twin exists, does a conformance test pin the two equal? [...] either two imported constants [...] or the prose table parsed row-for-row against the imported constant when the vocabulary's canonical form lives in the prose itself. Either shape is a real pin; a test only asserting that individual literal strings are *present* somewhere is not

From `.claude/skills/windows-checkout-test-parity/SKILL.md`:

> When code parses text it reads from a tracked file [...] add a CRLF case beside the LF one. Build it from the same string with `.replace(/\n/g, '\r\n')`

> Building a test's expected list of repo-relative names with `path.join` when the list comes from `git diff --name-only` [...] Build the expected names with `path.posix.join`

From `.claude/skills/git-ground-truth-test-env/SKILL.md`:

> 1. **A reader call in a test passes an explicit env.** [...] 3. **Prove both under the runner.** Run `node tools/run-tests.js --files-from <list>`, never only a bare `node --test`

## Review Focus

1. A journey `files:` list written inline (`files: [a.js, b.js]`) or with a quoted entry (`- "a.js"`) — the shared parser returns `[]`/the quoted text, which would let a listed file look unlisted. Expected: `files:` with an inline value → `cannot tell:` (unparseable frontmatter); a quoted entry has its surrounding quotes stripped before matching. Test in Task 2.
2. A journey file with CRLF line endings — expected identical verdict to LF. Test in Task 2.
3. A changed file that is itself a journey symlink target, or `docs/journeys/sub/x.md` (nested) — expected: anything under `docs/journeys/` proceeds; nested `.md` files are not journeys to read (only top-level `docs/journeys/*.md`, matching `listJourneys`). Test in Task 1.
4. `--integration-branch` where the stamp-free base equals HEAD (nothing changed yet) — expected: empty list → `cannot tell:` for journeys/visual-review, never `skip`. Test in Task 2.
5. A caller passing `--files` with surrounding spaces or a trailing comma (`"a.js, b.js,"`) — expected: entries trimmed, empties dropped (as `design-detect.js` does). Test in Task 2.

---

### Task 1: Pure rules — `decide()` and its constants

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/skill-gate/index.js`
- Test: `tests/bin-lib/skill-gate/index.test.js`
- Read only: `plugin/bin/lib/design-detect/index.js` (import `evaluate`, `layer1`, `fileMatchesFrontendPredicate`, `SKIP_REASONS`), `plugin/bin/lib/journey-health/scope.js` (`journeyFileExists`'s last-segment `*` convention — replicate the matching, not the fs read), `plugin/skills/visual-review/SKILL.md` Step 0.5.

**Interfaces:**
- Produces (exports of `plugin/bin/lib/skill-gate/index.js`):
  - `SKILLS = ['journeys', 'visual-review', 'design-wrapper']`
  - `WRAPPER_MODES = ['pre-build', 'test', 'review', 'polish', 'survey']`
  - `CANNOT_TELL = 'cannot tell: '`
  - `NO_SURFACE_SET` — frozen array of exactly these 8 strings, in this order: `'test/**'`, `'tests/**'`, `'**/__tests__/**'`, `'**/*.test.{js,jsx,ts,tsx,cjs,mjs,cts,mts}'`, `'**/*.spec.{js,jsx,ts,tsx,cjs,mjs,cts,mts}'`, `'.claude-tweaks/pipelines/**'`, `'docs/superpowers/plans/**'`, `'docs/plans/*-ledger.md'`. Matching is hand-written per entry (no glob library), whole-segment, case-sensitive: `test/**`/`tests/**` = first segment equals it and at least one more segment; `**/__tests__/**` = some non-last segment equals `__tests__`; the two name rules = last segment matches `/\.(test|spec)\.(js|jsx|ts|tsx|cjs|mjs|cts|mts)$/` (one regex per entry); `.claude-tweaks/pipelines/**` = first two segments equal those; `docs/superpowers/plans/**` = first three; `docs/plans/*-ledger.md` = exactly three segments, `docs`,`plans`, and a last segment ending `-ledger.md` with no further `/`.
  - `VISUAL_SIGNAL_SURFACES = ['web', 'mobile', 'desktop']`, `VISUAL_NO_SIGNAL_SURFACES = ['backend', 'infra', 'terminal']`
  - `normalizeSurface(value) -> { kind: 'absent' } | { kind: 'known', value } | { kind: 'unrecognised', raw }` — `null`/`undefined`/`''` absent; lower-case; `frontend` → `web` (same as `layer2`); known = the six listed values.
  - `inNoSurfaceSet(file: string) -> boolean`
  - `pathShapeProblem(file: string) -> string|null` — non-null (a short description) when the path has a `.` or `..` segment, a leading `/`, a trailing `/`, a `\`, a `%`, or `://`. No normalisation.
  - `isJourneyPath(file) -> boolean` — first two segments are exactly `docs`, `journeys` and there is at least one more segment.
  - `journeyEntryMatch(entry: string, file: string) -> 'match'|'no-match'|'unmatchable'` — `unmatchable` when `entry` contains `?`, `[`, `**`, or a `*` outside its last `/`-segment; last-segment `*` matches `[^/]*` with the dirname compared literally; otherwise literal equality.
  - `decide({ skill, mode, surface, files, designIntegration, loadJourneys }) -> { decision, reason, journeys?, cannotTell?: true }`
    - `files`: `string[]` or `{ error: string }`. `loadJourneys()`: returns `{ journeys: [{ name, files: string[]|null }] }` or `{ error: string }` (`files: null` = no `files:` key); called lazily, only when a rule needs journeys.
    - `cannotTell: true` marks a Deliverable 4 result; the CLI strips it before printing.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/skill-gate/index.test.js`. Name each test with its AC clause id. Use a `journeysOf(list)` helper returning `() => ({ journeys: list })`. Required cases (exact values from the spec):
  - `AC2.1`/`AC2.2`: for every combination of mode ∈ `test, review, polish, survey`; surface ∈ `undefined, 'web', 'mobile', 'desktop', 'terminal', 'backend', 'infra'`; designIntegration ∈ `'enabled', 'disabled', null`; files ∈ `['plugin/bin/x.js']`, `['src/components/Button.tsx']` — `const g = decide({skill:'design-wrapper', mode, surface, files, designIntegration})` and `const e = evaluate({mode, designIntegrationValue: designIntegration, surface, files})`; assert `g.decision === e.decision` and `g.reason === e.reason` (when `e.reason` is undefined, `g.reason` is a non-empty string that does not start with `CANNOT_TELL`). No hard-coded expected values.
  - `AC3.1`: `visual-review` → `proceed` for `{surface:'web', files:['plugin/bin/x.js']}`; for `{surface:'backend', files:['src/components/Button.tsx']}`; for `{surface: undefined, files:['app/page.tsx']}`.
  - `AC3.2`: `visual-review` `{surface:'infra', files:['plugin/bin/x.js'], loadJourneys: journeysOf([{name:'dev-cli', files:['plugin/bin/x.js']}, {name:'other', files:['src/a.js']}])}` → `skip`, `journeys` deep-equals `['dev-cli']`.
  - `AC3.3`: with `files:['plugin/bin/x.js']`, `designIntegration:'enabled'`: surface `'Frontend'` → `proceed` for `visual-review` and for `pre-build`, and each `reason` strictly equals the reason the same call gives for surface `'web'`; surface `'kiosk'` → `proceed` for both, reason starts with `CANNOT_TELL`, `cannotTell === true`.
  - `AC3.4`/`AC3.5`: `pre-build` with surface `undefined`, `designIntegration:'enabled'` → `skip`. Also `pre-build` with `'backend'` and `'infra'` → `skip` with reason `SKIP_REASONS.NON_FRONTEND_SURFACE`; with `designIntegration:'disabled'` and surface `'web'` → `skip` with `SKIP_REASONS.DISABLED`; `null` → `SKIP_REASONS.MISSING`; `'terminal'` + enabled → `proceed`. Guard-branch discrimination: one case per guard where only that guard decides.
  - `AC4.1`, `AC4.3`, `AC4.4`, `AC4.5` (`journeys` → `proceed`): `['plugin/bin/x.js']`; `['docs/journeys/a.md','tests/a.test.js']`; `['tests/a.test.js']` with a journey `files:['tests/a.test.js']` (literal) and separately `files:['tests/*.test.js']` (last-segment `*`); `['tests/a.test.js']` with a journey entry `'tests/**'` (and separately `'src/**/x.js'`); `[]` (empty → `cannotTell`).
  - `AC4.2`/`AC4.6` (`journeys` → `skip`): `['tests/a.test.js']` with `journeysOf([])`; `['src/__tests__/a.js','docs/superpowers/plans/p.md']`; `['tests/a.test.js']` with `journeysOf([{name:'j', files:null}])`.
  - `AC5.1`/`AC5.5`/`AC5.6`: `inNoSurfaceSet` false for `contests/a.js`, `src/tests-data/a.js`, `packages/test/src/a.js`, `src/tests/a.js`, `.claude-tweaks/pipelines-old/a.md`, `Tests/a.js`; `isJourneyPath('docs/journeys-archive/a.md') === false`.
  - `AC5.2`/`AC5.3`/`AC5.4`/`AC5.6`: for `journeys` and for `visual-review` (surface `'backend'`), each of `tests/./a.test.js`, `tests/../a.test.js`, `/tests/a.test.js`, `tests/`, `tests\\a.test.js`, `tests/a%2etest.js`, `file://tests/a.test.js` → `proceed` and the reason does not start with `CANNOT_TELL` (a closed-rule proceed).
  - `NO_SURFACE_SET` per-entry positive cases: `test/a.js`, `tests/a.js`, `src/__tests__/a.js`, `src/a.test.mts`, `src/a.spec.jsx`, `.claude-tweaks/pipelines/r/work/1-spec.md`, `docs/superpowers/plans/p.md`, `docs/plans/2026-11-16-x-ledger.md`; negatives `docs/plans/sub/x-ledger.md`, `src/a.test.py`, `test` (no second segment).
  - Review Focus 3: `journeys` with `['docs/journeys/sub/x.md']` → `proceed`.
  - `journeyEntryMatch` table: `('src/*.js','src/a.js')→match`, `('src/*.js','src/sub/a.js')→no-match`, `('src/*/a.js', …)→unmatchable`, `('src/a?.js', …)→unmatchable`.
  - Lazy load: `journeys` with `['plugin/bin/x.js']` and `loadJourneys: () => { throw new Error('must not load') }` → `proceed`.
  - `loadJourneys` returning `{error:'x'}` on a path that needs it → `proceed`, `cannotTell`, reason starts `CANNOT_TELL`.
  - `visual-review` with `[]` and surface absent → `proceed`, `cannotTell`; and with `[]` and surface `'web'` → `proceed`, `cannotTell` (empty list is checked before the surface).

- [ ] **Step 2: Run** `node --test tests/bin-lib/skill-gate/index.test.js` — Expected: FAIL (`Cannot find module '../../../plugin/bin/lib/skill-gate'`).

- [ ] **Step 3: Implement** `plugin/bin/lib/skill-gate/index.js`. Rule order (the reason strings are this task's to choose; keep them short, name the deciding input, never begin a rule-reached one with `CANNOT_TELL`):
  - `design-wrapper`, modes `test|review|polish|survey`: `files` error → cannot tell; else return `evaluate({ mode, designIntegrationValue: designIntegration, surface, files })`'s `decision` and `reason` (when `evaluate` returns no reason on proceed, supply `'design-detect proceeds (track {track})'`).
  - `design-wrapper` `pre-build`: `layer1(designIntegration)` skips → skip with its reason; surface absent → skip (`'no surface declared'`); `backend`/`infra` → skip `SKIP_REASONS.NON_FRONTEND_SURFACE`; unrecognised → cannot tell; else proceed (`'surface {value} routed to pre-build'`). No file sniff.
  - `visual-review`: `files` error or empty → cannot tell (checked first: spec Deliverable 4 makes an empty list a cannot-tell case for `visual-review` whatever the surface); surface known and in `VISUAL_SIGNAL_SURFACES` → proceed (`'frontend surface declared ({value})'`, normalised value so `Frontend` and `web` match); unrecognised → cannot tell; any path with `pathShapeProblem` → proceed (reason names it); any `fileMatchesFrontendPredicate` file → proceed (names the first); else `loadJourneys()` (error → cannot tell); skip with reason `no frontend surface ({surface: {v} | no surface declared}) and no UI trigger file in the diff` and `journeys` = names (sorted) of journeys with any entry that is `match` for any changed file (an `unmatchable` entry does not overlap here; the skip is decided by the surface/file rule).
  - `journeys`: `files` error or empty → cannot tell; any `pathShapeProblem` → proceed; any file not `inNoSurfaceSet` → proceed (`'changed file outside the no-surface set: {f}'`); any `isJourneyPath` → proceed; `loadJourneys()` error → cannot tell; any entry `unmatchable` → proceed (names journey + entry); any `match` → proceed (names journey + file); else skip (`'every changed file is test code or a pipeline artifact, and no journey lists one'`).
  - Unknown skill/mode → `throw` (the CLI validates first; the IO layer turns a throw into cannot tell).

- [ ] **Step 4: Run** `node --test tests/bin-lib/skill-gate/index.test.js` — Expected: PASS. Then revert one guard at a time in a scratch copy (e.g. drop the `pathShapeProblem` check) and confirm the matching test goes red; restore.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/skill-gate/index.js tests/bin-lib/skill-gate/index.test.js
git commit -m "Add skill-gate rules — journeys, visual-review and design-wrapper load verdicts, refs #5605"
```

---

### Task 2: IO layer and the `skill-gate.js` CLI

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/skill-gate/index.js` (add IO functions)
- Create: `plugin/bin/skill-gate.js`
- Test: `tests/bin-lib/skill-gate/cli.test.js` (new), extend `tests/bin-lib/skill-gate/index.test.js` for `readJourneys`
- Read only: `plugin/bin/lib/verify/changed-files.js` (`resolveBase`, `changedFiles`, `ChangedFilesError`), `plugin/bin/lib/log-decision/append.js` (`resolveTarget`, `formatEntry`, `appendEntry`), `plugin/bin/pr-checks.js` (worked example of `--run` exit 3 + `logged`), `plugin/bin/lib/health-core/frontmatter-list.js` (`splitFrontmatterFence`, `parseFrontmatterListField`), `plugin/bin/lib/path-guard/index.js`, `tests/helpers/run-cli.js`, `tests/helpers/git-fixtures.js`, `tests/apply-refine-labels-run-dir-anchoring.test.js` (main-vs-shadow fixture shape).

**Interfaces:**
- Consumes: Task 1's `decide`, `SKILLS`, `WRAPPER_MODES`, `CANNOT_TELL`.
- Produces:
  - `parseJourneyText(text: string) -> { files: string[]|null } | { error: string }` — the frontmatter rules below, pure (no fs); `readJourneys` calls it per file. Exported for Task 5.
  - `readJourneys(root: string, { fsImpl } = {}) -> { journeys: [{ name, files: string[]|null }] } | { error: string }` — top-level `docs/journeys/*.md` only, sorted by name. `ENOENT` on the directory → `{ journeys: [] }`; any other readdir error → error. Each `.md` entry: `lstatType`; a symlink → `resolveLeaf`; `dangling` → error; resolved but not `isAncestorOrSelf(canonicalRealpath(root), resolved)` → error (never read); read failure → error. Frontmatter: no leading `---` line → `files: null`; a `---` that never closes → error (unparseable); a line matching `/^files:\s*\S/` (inline value) → error; else `parseFrontmatterListField(text, 'files')` with surrounding single/double quotes stripped from each item, or `null` when no `files:` line exists. CRLF text reads the same as LF.
  - `gate({ skill, mode, surface, files, integrationBranch, root, designIntegration, env, execImpl, decideImpl = decide, fsImpl }) -> { decision, reason, journeys?, cannotTell? }` — resolves `files` from `integrationBranch` when `files` is null: `resolveBase({ integrationBranch, requireNonDegenerate: true, execImpl })` then `changedFiles({ base, execImpl })`; a `ChangedFilesError` (or any throw) → `{ error: 'cannot resolve the changed files: {message}' }`. `execImpl` is an `execFileSync`-compatible function that injects `cwd: root` and `env`. Wraps the whole `decideImpl(...)` call in try/catch: a throw → `{ decision: 'proceed', reason: CANNOT_TELL + 'gate error: ' + message, cannotTell: true }`. The cannot-tell reason for an unresolvable base / empty list / journey read error is `CANNOT_TELL + '{what could not be told}'`.
  - CLI `plugin/bin/skill-gate.js`: `run(argv, deps)` / `realDeps` / guard as the Global Constraints quote. `deps` keys: `stdout`, `stderr`, `cwd`, `env`, `now`, `mainRoot` (undefined in realDeps), `gate` (defaults to the lib's), `appendDecision` (defaults to `appendEntry`), `readDesignIntegration(root)` (defaults to `readDesignIntegrationFlagFromFile`), `repoRoot()` (git `rev-parse --show-toplevel` in `deps.cwd()`, falling back to `deps.cwd()`).
  - Flags: `--skill`, `--mode`, `--surface`, `--files <a,b>` (split on `,`, trimmed, empties dropped; `--files ""` = empty list), `--integration-branch <ref>`, `--run`, `--section`, `--step`, `--help`/`-h`. Exit 2 with `USAGE` on stderr for: unknown flag; a value flag at argv end or followed by a token starting `--`; unknown `--skill`; `design-wrapper` without `--mode` or with a mode outside `WRAPPER_MODES`; `--mode` with a non-wrapper skill; both `--files` and `--integration-branch`; neither, except for `pre-build`; one or two of `--run/--section/--step`. `--help` prints `USAGE` to stdout, exits 0, before anything else.
  - Then `--run` → `resolveTarget({ runDir, cwd: deps.cwd(), mainRoot: deps.mainRoot })`; not ok → stderr naming missing vs not-anchored, exit 3, nothing written (checked before the gate runs).
  - Result: a `cannotTell` result writes `skill-gate: {reason}\n` to stderr once. A `skip` with `--run`: `appendDecision({ runDir, section, entry: formatEntry({ status:'SKIP', now: deps.now(), step: `${step} (skipped)`, text: `condition: ${reason} → fallback: ${label} not loaded`, reversibility: 'n/a' }) })`; success → `logged: true`; a throw → one stderr line, `logged: false`. A skip without `--run` → `logged: false`. Print `JSON.stringify({ decision, reason, ...(journeys && { journeys }), ...(skip && { logged }) })` + `\n`; exit 0.

- [ ] **Step 1: Write the failing tests.** In `tests/bin-lib/skill-gate/cli.test.js` use `runCliSync` (absolute CLI path) with `env: { PATH: process.env.PATH, ...(SystemRoot) }` plus hermetic git vars, and `gitRepo()` fixtures (`FIXTURE_TIMEOUT_MS`). Cases, named by AC clause id:
  - `AC1.1`–`AC1.7` (one test, seven assertions): in a `gitRepo()` with no `## Design integration` section, `--files tests/a.test.js,.claude-tweaks/pipelines/r/work/1-spec.md --surface backend` prints `"decision":"skip"` for `--skill journeys`, `--skill visual-review`, and `--skill design-wrapper --mode` each of `pre-build test review polish survey`.
  - `AC6.1` unresolvable base: `--skill journeys --integration-branch no-such-branch` in a fixture with one commit → exit 0, `proceed`, reason starts `cannot tell: `, stderr has exactly one line, no `decisions.md` line when `--run` was also given.
  - `AC6.2` unreadable `docs/journeys/`: a directory with mode `000` (skip via `tests/helpers/root.js`'s `chmodDenialSkip` under root or win32) — expected cannot tell. `AC6.3` a journey `---\nfiles:\n` with no closing fence. `AC6.4` a `docs/journeys/x.md` symlink to a file outside the fixture. `AC6.5` a dangling `docs/journeys/x.md` symlink. `AC6.6` `deps.gate` replaced with one whose `decideImpl` throws (call the lib's `gate` with `decideImpl: () => { throw new Error('boom') }`) → cannot tell. Each: exit 0, `proceed`, `cannot tell: ` prefix, one stderr line, no decisions line. Symlink cases skip on win32 when symlink creation throws `EPERM`.
  - `AC6.7` (no rule-reached proceed carries the prefix): `--skill journeys --files plugin/bin/x.js` → reason does not start `cannot tell: `, stderr empty.
  - `AC7.1`: a fixture main checkout with `.claude-tweaks/pipelines/run-1/` (pass `mainRoot` via deps or run from that checkout so `resolveTarget` anchors); `--skill journeys --files tests/a.test.js --run {dir} --section "/build" --step "Common Step 6"` → `logged: true`, `decisions.md` gains exactly one line matching `/^- SKIP \d{2}:\d{2}:\d{2} — Common Step 6 \(skipped\): condition: .+ → fallback: journeys not loaded\. Reversibility: n\/a\.$/m` under a `## /build` heading, and naming the reason text.
  - `AC7.2`: same flags with `--files plugin/bin/x.js` (proceed) → decisions.md unchanged (byte compare), no `logged` key.
  - `AC7.3`: skip with none of the three → `logged: false`.
  - `AC7.4`: `--run` without `--section`, and `--run` + `--section` without `--step` → exit 2.
  - `AC7.5`: a worktree-local shadow run dir (`linkedWorktreeOf`) → exit 3, the shadow's `decisions.md` byte-unchanged, nothing on stdout.
  - `AC12.1`/`AC12.2`: `--skill nope`; `--skill design-wrapper` with no `--mode`; `--bogus`; `--skill` as the last argv; each exits 2 with stderr containing `usage:`; `--help` exits 0 with `usage:` on stdout.
  - Review Focus 4: `--integration-branch main` on a fixture whose HEAD equals `main` → `journeys` `proceed`, `cannot tell: ` (empty list).
  - Review Focus 5: `--files " tests/a.test.js , "` → same verdict as `--files tests/a.test.js`.
  - One `spawnCli` smoke test of the script entry (`--help`, exit 0).
  In `index.test.js` add `readJourneys` cases: missing dir → `{journeys: []}`; no frontmatter → `files: null`; `files:` list; quoted item `- "a.js"` → `'a.js'` (Review Focus 1); `files: [a.js]` → error (Review Focus 1); CRLF copy of a fixture built with `.replace(/\n/g, '\r\n')` → same result as LF (Review Focus 2); a nested `docs/journeys/sub/y.md` is not listed.

- [ ] **Step 2: Run** `node --test tests/bin-lib/skill-gate/cli.test.js tests/bin-lib/skill-gate/index.test.js` — Expected: FAIL (`skill-gate.js` missing; `readJourneys` not a function).

- [ ] **Step 3: Implement** the IO functions and the CLI per the Interfaces block. In the CLI, `--integration-branch` passes through to `resolveBase` unmodified (it applies `preferOriginRef` and `--end-of-options` itself).

- [ ] **Step 4: Run** `node tools/run-tests.js --files-from {list}` with a list file naming both test files, plus `tests/bin-lib/cli-entry-conformance.test.js`, `tests/bin-lib/exit-code-conformance.test.js`, `tests/path-guard-conformance.test.js`, `tests/windows-hide-spawn-conformance.test.js` — Expected: all pass. Real-input probe: run `node plugin/bin/skill-gate.js --skill journeys --integration-branch main` in this worktree and record the printed line in the task report (expected `proceed`: this branch changes `plugin/bin/` files).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/skill-gate.js plugin/bin/lib/skill-gate/index.js tests/bin-lib/skill-gate/cli.test.js tests/bin-lib/skill-gate/index.test.js
git commit -m "Add skill-gate.js CLI — fail-open file and journey reads, decisions.md skip line, refs #5605"
```

---

### Task 3: Shared contract `_shared/skill-load-gate.md`

**Role:** integration

**Files:**
- Create: `plugin/skills/_shared/skill-load-gate.md`
- Modify: `plugin/skills/_shared/design-wrapper-handling.md` (the `## Caller-side pre-check` section: replace its body with a pointer to `_shared/skill-load-gate.md`, keeping the heading and the `--surface` bullet verbatim (the spec, `skill-load-gate.md` and two wrapper mode files cite that bullet here); say `bin/design-detect.js` stays the wrapper's own Layers 1-3 twin, used by the wrapper's own preconditions)
- Create: `tests/skill-load-gate-conformance.test.js` (this task adds the AC9 and AC13 tests; Task 4 adds AC8 and AC14 to the same file)
- Modify: `tests/design-wrapper-caller-precheck.test.js` (its first test asserts the pre-check section's old body; re-point it to assert the section cites `_shared/skill-load-gate.md`; keep the three `live:` design-detect CLI tests unchanged)

**Interfaces:**
- Consumes: Task 1/2 exports `NO_SURFACE_SET`, `VISUAL_SIGNAL_SURFACES`, `VISUAL_NO_SIGNAL_SURFACES`, the CLI's flags and JSON.
- Produces: the file's exact structure later tasks cite:
  - `## Invocation` with one fenced `bash` block holding exactly one line:
    `node "${CLAUDE_PLUGIN_ROOT}/bin/skill-gate.js" --skill <skill> [--mode <mode>] [--surface <value>] (--files "<a,b>" | --integration-branch <ref>) [--run "$PIPELINE_RUN_DIR" --section "/<caller-skill>" --step "<step name>"]`
    and a flag list: `--surface` found per `_shared/design-wrapper-handling.md`'s `--surface` bullet (cited, never moved or restated: the spec's Deliverable 7 and `design-wrapper/modes/pre-build.md:21` / `modes/review-seed-capture.md:27` cite that bullet where it is); `--files` is the caller's already-resolved list; `--integration-branch` is the ref `_shared/integration-branch.md` resolves; `--run`/`--section`/`--step` together when the step has a run directory.
  - `## Result handling`: `skip` → do not invoke the skill; repeat the gate's `reason` verbatim in the caller's own output; `logged: false` → the caller names the step, the skill and the reason in its own output (standalone: its handoff); `proceed` → invoke the skill as the step documents; a `cannot tell:` proceed is a proceed. Exit 2 or 3, or no JSON on stdout → proceed (the gate failed open by not running) and log one `SKIP` naming the failure. A `skip` from `design-wrapper` uses the same wire reasons as the wrapper's own `{skipped: reason}`, so callers' result tables need no separate branch.
  - `## The no-surface set` with a bullet list, between `<!-- no-surface-set:start -->` and `<!-- no-surface-set:end -->`, one backticked entry per line (`- \`test/**\``), in `NO_SURFACE_SET` order, followed by one sentence why (test code and pipeline artifacts, which no persona of a journey uses) and the Gotchas note that a project keeping product code under top-level `test/`/`tests/` has that diff's journeys load skipped (logged; a journey listing such a file turns it back into a load).
  - `## Rules` — one short paragraph per skill stating Deliverable 3's rule and the closed-rule sentence; names `visual-review/SKILL.md` Step 0.5 as the prose twin of the visual-review rule and states the one difference (a UI file proceeds whatever the declared surface); states that the four `evaluate()` modes read an unrecognised surface as no surface while the gate's own rules proceed on one (Technical Approach's last paragraph).
  - `## Deliberately not gated` — `visual-review`'s own call to `design-wrapper survey` after a browser review; `wrap-up/verification-brief.md` Step 2.5's visual-review safety net; `/claude-tweaks:specify`, `/claude-tweaks:tidy`, `/claude-tweaks:init` invoking the wrapper by a human's choice.
  - `## Callers` — the seven-row table from Deliverable 7 (step, `--skill`/`--mode`, changed-file source).

- [ ] **Step 1: Write the failing tests** in `tests/skill-load-gate-conformance.test.js`:
  - `AC9.1`/`AC9.2`: extract the single line inside `sectionOf(SHARED, '## Invocation')`'s ```` ```bash ```` fence; `assert.strictEqual(line, SNIPPET)` with `SNIPPET` the literal line above. Then in a `gitRepo()` fixture with an anchored run dir `.claude-tweaks/pipelines/r1/`, substitute `<skill>`→`journeys`, `<caller-skill>`→`build`, `<step name>`→`Common Step 6`, drop the optional `[--mode <mode>]`/`[--surface <value>]` groups, choose `--files "tests/a.test.js"`, keep the `--run` group with `--section "/build" --step "Common Step 6"`, and run it under `spawnSync('bash', ['-c', cmd])` with `cwd` = fixture, `PIPELINE_RUN_DIR` = run dir, `CLAUDE_PLUGIN_ROOT` = `path.join(ROOT,'plugin').split(path.sep).join('/')`. Assert exit 0 and JSON `decision` ∈ `{proceed, skip}` (here `skip`) and the run dir's `decisions.md` holds the SKIP line. Skip on win32 when `bash` is absent.
  - `AC13.1`: the backticked entries between the two markers deep-equal `NO_SURFACE_SET` (imported). Go-red control: append `- \`spec/**\`` inside the markers in a string copy → the comparison helper throws with its own message; and a copy of the constant with one extra entry (`[...NO_SURFACE_SET, 'spec/**']`) compared against the live md → throws.
  - `AC13.2`: from `sectionOf(VISUAL, '## Step 0.5: Mode — \`recommendation\` (short-circuit)')`, take the Layer 2 bullet; the backticked words in the clause ending `is a signal on its own` deep-equal (sorted) `VISUAL_SIGNAL_SURFACES`; those inside the parenthesis after `any other declared value` deep-equal (sorted) `VISUAL_NO_SIGNAL_SURFACES`. Go-red: remove `` `desktop` `` from a copy → throws; add `'kiosk'` to a copy of either constant → throws.
  - Update `tests/design-wrapper-caller-precheck.test.js`'s first test to assert `sectionOf(HANDLING, '## Caller-side pre-check')` contains `_shared/skill-load-gate.md`.

- [ ] **Step 2: Run** `node --test tests/skill-load-gate-conformance.test.js tests/design-wrapper-caller-precheck.test.js` — Expected: FAIL (shared file missing; section lacks the citation).

- [ ] **Step 3: Write** `plugin/skills/_shared/skill-load-gate.md` (target under 7,000 bytes) and the design-wrapper-handling.md pointer (net smaller). Before writing, run the moved-prose pin check: `git grep -n -F -e 'Caller-side pre-check' -e 'never pays for loading' -e 'design-detect.js" --mode' -- tests plugin docs` and re-point every test hit the edit breaks (expected today: `tests/design-wrapper-caller-precheck.test.js`, `tests/design-wrapper-review-surface-gate-prose.test.js` — read it and confirm whether it pins this section).

- [ ] **Step 4: Run** the two test files plus `node --test tests/design-wrapper-review-surface-gate-prose.test.js` and every `tests/**` file the grep in Step 3 named — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/skill-load-gate.md plugin/skills/_shared/design-wrapper-handling.md tests/skill-load-gate-conformance.test.js tests/design-wrapper-caller-precheck.test.js
git commit -m "Add _shared/skill-load-gate.md — one invocation and result contract for the skill-load gate, refs #5605"
```

---

### Task 4: Seven caller steps cite the gate

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/skills/build/SKILL.md` (Common Step 1.7 at the `### Common Step 1.7` section; Common Step 6)
- Modify: `plugin/skills/build/design-prebuild.md` (lines 3, 9, 18: the surface-routing condition is now the gate's; keep the trivial-plan and design-mode skips and their SKIP trace; drop `surface not routed` from the trace's condition alternatives since the gate logs that skip itself)
- Modify: `plugin/skills/test/design-gate.md` (`## Invocation`, line 11)
- Modify: `plugin/skills/review/code-mode-steps.md` (`## Step 6: Visual Review`, `## Step 6.5: Design Quality Pass (Impeccable)`)
- Modify: `plugin/skills/flow/steps-and-gates.md` (`### Polish-phase decision tree`, plus the `polish` row of the Allowed Steps table at line 15 only if its "Skipped on non-frontend specs (wrapper detection)" clause becomes false — it becomes "(skill-load gate)")
- Modify: `plugin/skills/flow/survey.md` (`## Survey procedure`)
- Modify: `plugin/skills/flow/SKILL.md` (lines 56, 191, 206: drop the invocation forms `design-wrapper polish <spec>` and `design-wrapper survey <changed-files>`; point at `steps-and-gates.md`'s Polish-phase decision tree and `survey.md`)
- Modify: `plugin/skills/flow/polish-execution.md` (lines 7-8: the two "invoke `/claude-tweaks:design-wrapper polish <spec>`" sentences run only after the decision tree's gate proceeds — add "after the gate in `steps-and-gates.md`'s Polish-phase decision tree proceeds" to line 8, nothing more)
- Modify: `plugin/skills/review/review-summary-template.md` (the `### Visual Review` skipped bullet at line 127 also names the gate's reason and journey names)
- Read only (AC14 pin, do not change): `plugin/skills/wrap-up/verification-brief.md` Step 2.5 row with `Skipped — no UI changes`
- Modify: `tests/design-wrapper-caller-precheck.test.js` (its tests 2 and 3 assert `/Caller-side pre-check/` in `design-gate.md` and `code-mode-steps.md`; re-point them to assert a citation of `_shared/skill-load-gate.md` with `--mode test` / `--mode review`)
- Test: `tests/skill-load-gate-conformance.test.js` (add AC8, AC14, AC10)

**Interfaces:**
- Consumes: `_shared/skill-load-gate.md` (Task 3) — cite it by that path; never restate the bash line.
- Produces: each step's gate sentence, placed **before** the first text in that step's section that invokes the skill, naming `--skill`/`--mode` as in this table, and stating the skill is not invoked on `skip`:

  | Step (section anchor) | First invocation text the citation must precede | Gate flags |
  |---|---|---|
  | `plugin/skills/build/SKILL.md` `### Common Step 1.7: Design Pre-Build (frontend specs + terminal)` | `design-wrapper pre-build` | `--skill design-wrapper --mode pre-build`, `--surface`, no file list |
  | `plugin/skills/build/SKILL.md` `### Common Step 6: User Journey Capture` | `/claude-tweaks:journeys` | `--skill journeys --integration-branch` |
  | `plugin/skills/test/design-gate.md` whole file | `design-wrapper test` | `--skill design-wrapper --mode test --files` |
  | `plugin/skills/review/code-mode-steps.md` `## Step 6: Visual Review` | `/claude-tweaks:visual-review` | `--skill visual-review --files` |
  | `plugin/skills/review/code-mode-steps.md` `## Step 6.5: Design Quality Pass (Impeccable)` | `design-wrapper review` | `--skill design-wrapper --mode review --files` |
  | `plugin/skills/flow/steps-and-gates.md` `### Polish-phase decision tree` | `design-wrapper polish` | `--skill design-wrapper --mode polish --integration-branch` |
  | `plugin/skills/flow/survey.md` `## Survey procedure` | `design-wrapper survey` | `--skill design-wrapper --mode survey --files` |

  Each step passes `--surface` where `_shared/skill-load-gate.md`'s `--surface` rule finds one, and `--run "$PIPELINE_RUN_DIR" --section "/{caller-skill}" --step "{step name}"` when the step has a run dir (the same `--section` its other `log-decision.js` calls use: `/build`, `/test`, `/review`, `/flow`). Common Step 6 stays mandatory on `proceed` (keep "This is not optional" for that case). Review Step 6 is gated in both code and full mode; on `skip` it writes the Visual Review status `Skipped — no UI changes` with the gate's reason and journey names. The polish decision tree gets a new first branch: `Gate (_shared/skill-load-gate.md, --skill design-wrapper --mode polish) skip → note skip, proceed to wrap-up (no re-verify)` above `Invoke /claude-tweaks:design-wrapper polish <spec>`.

- [ ] **Step 1: Write the failing tests** in `tests/skill-load-gate-conformance.test.js`:
  - A `STEPS` table (file, section-slicer, invocation literal, `--skill`, `--mode`) — sections via `sectionOf` (for `###` headings slice from the heading line to the next `### ` or `## `; write a local `subsectionOf` only if `sectionOf` cannot take a `###` heading — check its implementation first).
  - `assertStep(text, step)`: (a) `text.indexOf('_shared/skill-load-gate.md')` ≥ 0 and `<` `text.indexOf(step.invocation)` (both ≥ 0), message `"{name}: gate citation must precede the first '{invocation}'"`; (b) text contains `--skill ${skill}` and, when set, `--mode ${mode}`, message `"{name}: names --skill/--mode"`; (c) text matches `/on `?skip`?[^.]*\bnot invoke/i` or `/skill is not (invoked|loaded) on `?skip/i`, message `"{name}: says the skill is not invoked on skip"`.
  - `AC8.1`: every row passes `assertStep` on the live text.
  - `AC8.2`: for each row, a copy of that section with every `_shared/skill-load-gate.md` removed → `assertStep` throws with message matching that row's name; every other row still passes on its live text (one loop, one assertion per row).
  - `AC8.3`/`AC8.4`: `flow/SKILL.md` does not match `/design-wrapper polish </` nor `/design-wrapper survey </` (absence control: run the same regexes against `git show 026e203f3:plugin/skills/flow/SKILL.md` via `execFileSync('git', ['show', '026e203f3:plugin/skills/flow/SKILL.md'])` and assert they match there — skip that control when the commit is not in the object store).
  - `AC14.1`: the constant `const STATUS = 'Skipped — no UI changes'` appears in review Step 6's section, in `review-summary-template.md`'s `- **Status:**` line under `### Visual Review`, and in `verification-brief.md`'s Step 2.5 table row (`lineStartingWith(VB, '| \`Skipped — no UI changes\`')`); go-red: each of the three with the string altered (`'Skipped — no UI change'`) in a copy → that file's assertion throws with its own message.
  - Waived AC10 as a committed test: `tests/skill-size-single-source.test.js` (AC3.1) fails the suite on any skill-size number outside `plugin/bin/lib/skill-audit/budgets.js`. AC10 is verified by `wc -c` in Step 4 and recorded as an `AC evidence` decisions.md entry.

- [ ] **Step 2: Run** `node --test tests/skill-load-gate-conformance.test.js` — Expected: FAIL on AC8.1 (no citations yet) and AC8.3.

- [ ] **Step 3: Edit the nine files.** Size budget: in `code-mode-steps.md`, Step 6.5's pre-check sentence (≈900 bytes, starting `Before invoking the wrapper, run`) becomes a citation that also opens the section, before `Invoke \`/claude-tweaks:design-wrapper review <spec>\``; the saving pays for Step 6's gate line. In `build/SKILL.md`, Step 1.7's surface clause (`For a surface routed to pre-build — ... materialize.md\`) —`) becomes the citation; the saving pays for Step 6's line. `flow/SKILL.md` only shrinks. Moved-prose pin check first: `git grep -n -F -e 'surface routed to pre-build' -e 'lazy-load relevant design references' -e 'Delegate to \`/claude-tweaks:visual-review --mode=recommendation\`' -e 'against the full diff produced by the pipeline' -e 'Invoke /claude-tweaks:design-wrapper polish' -e 'via the Skill tool. See \"Polish phase execution\"' -e 'then invoke \`/claude-tweaks:design-wrapper survey' -e 'Skipped on non-frontend specs' -- tests plugin` — the only hits today are the edited files themselves; for any hit outside them, grep `tests/` for that file's basename and re-point a pinning test. Also run `node --test tests/ceremony-profile-roster.test.js` after editing `steps-and-gates.md` (it reads anchors from prose).

- [ ] **Step 4: Run** `node --test tests/skill-load-gate-conformance.test.js tests/design-wrapper-caller-precheck.test.js tests/ceremony-profile-roster.test.js tests/visual-review-recommendation-surface-gate.test.js tests/wrap-up-record-resolution-conformance.test.js` and the rail suite `node --test tests/bin-lib/skill-audit/*.test.js` (glob, not bare dir) — Expected: PASS. Run `wc -c plugin/skills/review/code-mode-steps.md plugin/skills/flow/SKILL.md plugin/skills/build/SKILL.md`, compare each against its ceiling (AC10), and record it: write one line (AC10, the command, the three sizes vs ceilings) with the Write tool to a scratch file and run `node plugin/bin/log-decision.js --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-16T004127-record-5605" --section "/build" --status AUTO --step "AC evidence" --text-file {file}`.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/SKILL.md plugin/skills/build/design-prebuild.md plugin/skills/test/design-gate.md plugin/skills/review/code-mode-steps.md plugin/skills/flow/steps-and-gates.md plugin/skills/flow/survey.md plugin/skills/flow/SKILL.md plugin/skills/flow/polish-execution.md plugin/skills/review/review-summary-template.md tests/skill-load-gate-conformance.test.js tests/design-wrapper-caller-precheck.test.js
git commit -m "Gate seven skill steps on skill-gate.js — journeys, visual-review and design-wrapper load only on proceed, refs #5605"
```

---

### Task 5: Replay tool

**Role:** integration

**Files:**
- Create: `tools/skill-gate-replay.js`
- Test: `tests/skill-gate-replay.test.js`

**Interfaces:**
- Consumes: Task 1's `decide`, `SKILLS`, `WRAPPER_MODES`, `isJourneyPath`, `inNoSurfaceSet`, and Task 2's `parseJourneyText(text)` (applied to `git show` output).
- Produces: `node tools/skill-gate-replay.js [--repo <dir>] [--ref <ref>] [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>]` (defaults: cwd, `origin/main` falling back to `main`, 30 days before today, today) printing one JSON object: `{ ref, since, until, commits, results: { "<skill>[ <mode>]": { skip, proceed } }, journeysWrongSkips }`. Work commits: `git log --first-parent --format=%H%x00%s -z --end-of-options {ref} --since --until`, excluding subjects starting `[reconcile]` or `chore(main): release`. Per commit: changed files from `git diff-tree --no-commit-id --name-only -r -z -m --first-parent --end-of-options {sha}` (a root commit: `--root`); journeys from `git ls-tree -z --name-only {sha} -- docs/journeys/` (top-level `.md` only) and `git show {sha}:{path}`; `designIntegration` from `git show {sha}:CLAUDE.md` via `readDesignIntegrationFlag` (absent → null). No surface. Keys: `journeys`, `visual-review`, `design-wrapper pre-build|test|review|polish|survey`. `journeysWrongSkips` counts commits where `journeys` skipped and a changed file `isJourneyPath` (Deliverable 1 as written; structurally 0, since the rule proceeds on any such file). Also report `journeysSkipsWithoutJourneyGuard`: the count of commits that the no-surface-set and `files:` conditions alone would skip, and of those, `journeysWrongSkipsWithoutJourneyGuard`, the ones that changed a file under `docs/journeys/` — this measures whether the other two conditions would skip a commit that wrote a journey. Also exports `replay({ repo, ref, since, until, execImpl })` for the test.

- [ ] **Step 1: Write the failing test** `tests/skill-gate-replay.test.js`, `AC15.1`: a `gitRepo()` fixture with three commits after an initial one — (1) `tests/a.test.js` only; (2) `docs/journeys/a.md` + `tests/b.test.js`; (3) `src/x.js` — call `replay({ repo, ref: 'HEAD', since: '2000-01-01', until: '2100-01-01' })` restricted to those three (exclude the initial commit by passing its sha as an `--after-sha` option, or by making the initial commit's subject `[reconcile] init`); assert `results.journeys` deep-equals `{ skip: 1, proceed: 2 }` and `journeysWrongSkips === 0`. Also assert `journeysSkipsWithoutJourneyGuard === 1` and `journeysWrongSkipsWithoutJourneyGuard === 0` (commit 2's `docs/journeys/a.md` is outside the no-surface set, so it proceeds under the first condition already).

- [ ] **Step 2: Run** `node --test tests/skill-gate-replay.test.js` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `tools/skill-gate-replay.js` per Interfaces (argv arrays, `-z`, `--end-of-options`, quiet stdio).

- [ ] **Step 4: Run** the test — Expected: PASS. Then the real-input probe (Deliverable 1): `mkdir -p "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-16T004127-record-5605/evidence"` then `node tools/skill-gate-replay.js --ref origin/main --since 2026-10-17 --until 2026-11-16 > "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-16T004127-record-5605/evidence/skill-gate-replay.txt"`. Independent count: `git log --first-parent --oneline origin/main --since 2026-10-17 --until 2026-11-16 | wc -l` minus the excluded subjects must equal `commits`. Expected `journeysWrongSkips: 0`. Record the summary with `node plugin/bin/log-decision.js --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-16T004127-record-5605" --section "/build" --status AUTO --step "AC evidence" --text-file {file}` where `{file}` (written with the Write tool) holds one line: AC1 of Deliverable 1, the command, the per-skill counts, and the evidence path.

- [ ] **Step 5: Commit**

```bash
git add tools/skill-gate-replay.js tests/skill-gate-replay.test.js
git commit -m "Add skill-gate replay — what the gate would skip over merged work, refs #5605"
```

---

### Task 6: Docs — skill graph and plugin structure

**Role:** integration

**Files:**
- Modify: `docs/skill-graph.md` — every row that today states the design-wrapper caller-side pre-check (grep `Caller-side pre-check` and `design-detect.js` — rows at roughly lines 224, 225, 650), plus the `/build`→`/journeys`, `/review`→`/visual-review`, `/flow`→`/design-wrapper` (polish, survey), `/build`→`/design-wrapper` (pre-build), `/test`→`/design-wrapper` edges and their reverse rows: state that the step runs `bin/skill-gate.js` first (contract `_shared/skill-load-gate.md`) and does not load the skill on `skip`. Add `_shared/skill-load-gate.md`'s consumer edges where the file lists `_shared` contracts.
- Modify: `docs/plugin-structure.md` — add a `plugin/bin/lib/skill-gate/` line beside the other `plugin/bin/lib/*` lines, a `node plugin/bin/skill-gate.js ...` command line beside `design-detect.js`'s (line ~307), `_shared/skill-load-gate.md` wherever `_shared` files are listed, and `tools/skill-gate-replay.js` wherever `tools/*.js` are listed.

- [ ] **Step 1:** `git grep -n -e 'Caller-side pre-check' -e 'design-detect.js' -e 'claude-tweaks:journeys' -e 'visual-review --mode=recommendation' -- docs/skill-graph.md docs/plugin-structure.md` and list each hit as edit / no-change in the task report.
- [ ] **Step 2:** Make the edits.
- [ ] **Step 3: Run** `node --test tests/skill-graph*.test.js tests/plugin-structure*.test.js` (only files that exist — `ls` first) — Expected: PASS.
- [ ] **Step 4: Commit**

```bash
git add docs/skill-graph.md docs/plugin-structure.md
git commit -m "Document the skill-load gate in the skill graph and plugin structure, refs #5605"
```

---

Waived AC10.1: verified by wc -c in Task 4 Step 4 and recorded as an AC evidence entry; tests/skill-size-single-source.test.js forbids a committed per-file size number.
Waived AC10.2: a measurement statement, the ceilings are in Global Constraints.
Waived AC11.1: no edit to design-detect files (Global Constraints); verified at Common Step 5 by running the command on base and HEAD and running tests/bin-lib/design-detect/cli.test.js.
Waived AC16.1: verified by the full suite through /claude-tweaks:test at Common Step 5 and the test phase.
Waived docs/superpowers/specs/2026-11-15-audit-simplification-design.md: read in Task 2 Step 3 for unit 3.1's argument-parser contract (unknown flag and missing value are usage errors, --help exits 0), which Task 2's Interfaces already encode.
Waived plugin/bin/lib/cli-args.js: does not exist (checked 2026-11-16 in this worktree); Task 2 writes its own parser.
Waived plugin/bin/lib/design-detect/index.js: read-only import in Task 1.
Waived plugin/bin/lib/journey-health/scope.js: read-only in Task 1 for the last-segment * convention.
Waived plugin/bin/lib/verify/changed-files.js: read-only import in Task 2.
Waived plugin/skills/visual-review/SKILL.md: read-only; Task 3's AC13.2 test reads Step 0.5.
Waived plugin/skills/wrap-up/verification-brief.md: read-only; Task 4's AC14.1 test reads Step 2.5.
Waived wrap-up/verification-brief.md: same file as above.

## Scope sweep (Check B classification)

No change, by file: CHANGELOG.md, docs/incident-log.md, docs/plans/2026-11-15-in-process-health-sweep-clis-ledger.md, docs/superpowers/plans/2026-11-14-in-process-health-cli-entry.md, docs/superpowers/plans/2026-11-15-in-process-health-sweep-clis.md (append-only history); plugin/bin/design-detect.js, plugin/bin/lib/design-detect/index.js, tests/bin-lib/design-detect/cli.test.js (AC11: untouched); plugin/skills/design-wrapper/SKILL.md, plugin/skills/design-wrapper/modes/{doctor,pre-build,review,review-seed-capture,test}.md (the wrapper's own Layers 1-3 and --surface-lines gate, which stay); plugin/skills/flow/summary-template.md (its Skipped — no UI changes is the stories row, a different status); plugin/skills/visual-review/SKILL.md, plugin/skills/wrap-up/verification-brief.md (read-only pins); tests/design-wrapper-review-surface-gate-prose.test.js (pins the --surface-lines gate in modes/review.md, untouched); tests/visual-review-recommendation-surface-gate.test.js, tests/wrap-up-record-resolution-conformance.test.js (pin Step 0.5 and verification-brief, untouched — run them in Task 4 Step 4 as a regression check). docs/journeys/call-a-plugin-bin-cli-in-process-from-a-test-5374.md and docs/journeys/get-a-visual-review-recommendation-only-for-a-ui-surface-2927.md: handled by Common Step 6 (journeys), not by a plan task.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1, AC15 | Task 5 |
| Deliverable 2, AC12 | Task 2 |
| Deliverable 3, AC1-AC5 | Task 1 (AC1 end-to-end in Task 2) |
| Deliverable 4, AC6 | Task 1 (rules), Task 2 (IO cases) |
| Deliverable 5, AC7 | Task 2 |
| Deliverable 6, AC9, AC13 | Task 3 |
| Deliverable 7, AC8, AC10, AC14 | Task 4 |
| Deliverable 8 | Task 6 |
| AC11 | Global Constraints (no edit); verified at Common Step 5 by running `node plugin/bin/design-detect.js --mode review --files a.tsx --surface web` on base and HEAD |
| AC16 | Common Step 5 (`npm test -- --full` via `/claude-tweaks:test`) |
| Decision rule (PR body states each choice) | Choices made here: flag-first ordering for `pre-build`; malformed paths are closed-rule proceeds (no `cannot tell:` prefix); exit 2 when a non-pre-build call names no file source; append.js import over log-decision passthrough; quoted `files:` items unquoted, inline `files:` values unparseable |
