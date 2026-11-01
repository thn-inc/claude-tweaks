# QA Story Secret Scrub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A QA story can declare `secrets:`; after it runs, a deterministic `bin/` helper scrubs every artifact the story produced and the QA report records the outcome per story.

**Architecture:** A pure-ish library under `plugin/bin/lib/qa-scrub/` (spec parsing, aria-snapshot locator resolution, the scan/scrub/delete/verify pass, the outcome line) behind a thin `plugin/bin/qa-scrub.js` CLI. The qa-agent calls the CLI after closing a story's session, only when its prompt carries a `**Secrets file:**`; the `/test qa` dispatcher writes that file from the story's `secrets:` block. `lib/qa-report/compose.js` passes a validated per-story `scrub` object into `report.json`, and refuses a failed scrub on a non-FAIL story.

**Tech Stack:** Node 18+ (`fs`, `path`), `node --test`, no npm deps. Markdown skill/agent prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-30T102355-record-4477/work/4477-spec.md`

Scope keywords: qa-agent, story-results, REPORT_JSON, schema_version: 2

## Global Constraints

- Never write a secret value to stdout, stderr, `decisions.md`, the QA report, or a test fixture that looks real. Fixtures use an obviously fake token: `FAKE-QA-TOKEN-0000-not-a-real-secret` (and `FAKE-QA-KEY-9999` for a locator value).
- Replacement marker for a scrubbed value: `[REDACTED:qa-secret]`.
- Outcome line, exact copy: `{N} secret value(s) scrubbed from {M} artifact(s); {K} screenshot(s) removed`.
- A story without `secrets:` produces byte-identical artifacts to today and the helper is never invoked — no new key appears in `report.json` for it.
- A failed scrub is never reported clean: the story is FAIL with the remaining paths listed.
- No external dependencies; `node --test` only. CLI follows the `run(argv, deps)` + `require.main` / `process.exitCode` contract (`.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`).
- Exit vocabulary for `qa-scrub.js` (Payload-1/Invocation-2 family, like `qa-report.js`): `0` scrubbed clean (including nothing matched), `1` secrets payload unreadable/unparseable/invalid, `2` malformed invocation, `3` scrub incomplete (paths remain or could not be checked).

## Review Focus

1. A `secrets:` pattern that matches the empty string (`.*`, `a?`) — refuse it at parse time (exit 1), never loop or redact everything.
2. A value split across JSON escaping in a trace (`"FAKE\"…"`) — the literal value's JSON-escaped form is scrubbed too (test in Task 2).
3. `.playwright-cli/` is shared by parallel stories — only files with mtime >= `--since` are in scope, and a file is rewritten only if it actually holds a match (test in Task 2).
4. A trace that is a zip container cannot be scrubbed in place — it is deleted and counted, never skipped silently (test in Task 2).
5. A locator secret that resolves to nothing — the scrub cannot prove the value is gone, so it fails (exit 3) rather than reporting clean (test in Task 2).

**Real-input probe:** waived — no browser can be installed in this sandbox (`playwright-core install chromium` download fails), so no real `playwright-cli` run is available. Fixture shapes are derived from the installed `@playwright/cli` 0.1.22 / playwright-core source (`lib/coreBundle.js`): `tracing-start` records a *live* trace into `.playwright-cli/traces/` as `trace-{ms}.trace` (JSONL text), `trace-{ms}.network`, and a sha1-named `resources/` dir (screencast frames are JPEG); console output is appended to `.playwright-cli/console-{date}.log`; snapshots are written once to `.playwright-cli/page-{date}.yml`.

---

### Task 1: Secrets spec parser and aria-snapshot locator resolver

**Role:** integration

**Files:**
- Create: `plugin/bin/lib/qa-scrub/secrets.js`
- Create: `plugin/bin/lib/qa-scrub/snapshot-locator.js`
- Create: `plugin/bin/lib/qa-scrub/line.js`
- Test: `tests/bin-lib/qa-scrub/secrets.test.js`
- Test: `tests/bin-lib/qa-scrub/snapshot-locator.test.js`
- Test fixture: `tests/fixtures/qa-scrub/page-reveal.yml` (an aria snapshot in playwright-cli's format containing the fake token and key)

**Interfaces:**
- Produces:
  - `parseSecrets(input: unknown) -> { secrets: Array<{kind:'pattern', regex: RegExp, source: string} | {kind:'locator', locator: {role?:string,name?:string,label?:string,placeholder?:string}}> } | { error: string }`
  - `resolveLocatorValues(yamlText: string, locator) -> string[]` (distinct, trimmed, unquoted)
  - `scrubLine({ values_scrubbed, artifacts_scrubbed, screenshots_removed }) -> string`
  - `MIN_VALUE_LENGTH = 4`

Rules for `parseSecrets`: input must be a non-empty array. Each entry is an object with exactly one of `pattern` (non-empty string; compiled with flags `g`; refuse `pattern-matches-empty` when `new RegExp(src).test('')`; refuse `pattern-invalid` on a compile error) or `locator` (object with exactly one locator type). Locator types accepted: `role` (with optional `name`), `label`, `placeholder`. Refuse `testid` with `locator-testid-unsupported` (aria snapshots carry no test ids — use `pattern`) and `text` with `locator-text-unsupported` (a text locator names the value itself — use `pattern`). Error strings are `{code}: entry {i}` and never echo the pattern.

Rules for `resolveLocatorValues` over playwright aria YAML (`- role "name" [attrs]: inline`, children indented by two spaces, `- text: …` text nodes, `- /prop: …` property lines): a node matches `role`+`name` when role equals and (no `name` given or the quoted name equals); `label` matches any node whose quoted name equals the label; `placeholder` matches a node with a direct child `- /placeholder: {value}`. A matched node's values are its inline value plus every descendant's inline value and `text:` value, excluding `/prop:` lines; strip surrounding quotes, trim, and return them all — the length floor (`MIN_VALUE_LENGTH`) is the caller's (Task 2) decision.

- [ ] **Step 1: Write the failing tests**

`secrets.test.js` — `test('parses pattern and role/label/placeholder locators')`, `test('refuses testid and text locators with named codes')`, `test('refuses a pattern that matches the empty string')`, `test('refuses an invalid regex without echoing it')` (assert the error string does not contain the pattern text), `test('refuses an empty array, a non-array, and an entry with both keys')`.

`snapshot-locator.test.js` (fixture `page-reveal.yml` includes: `- textbox "API key" [ref=e5]: FAKE-QA-KEY-9999`; `- region "Your token" [ref=e3]:` with child `- code [ref=e4]: FAKE-QA-TOKEN-0000-not-a-real-secret`; a `- textbox "Email" [ref=e7]:` with child `- /placeholder: you@example.com` and inline-less; a `- link "Docs" [ref=e9]:` with child `- /url: https://example.test/docs`):
- `test('AC6.1: role+name resolves the inline value')` → `resolveLocatorValues(y, {role:'textbox', name:'API key'})` deepEquals `['FAKE-QA-KEY-9999']`.
- `test('label resolves a descendant code value')` → `{label:'Your token'}` → `['FAKE-QA-TOKEN-0000-not-a-real-secret']`.
- `test('property lines are never values')` → `{role:'link', name:'Docs'}` → `[]`.
- `test('placeholder matches the node carrying it')` → `{placeholder:'you@example.com'}` → `[]` (no value typed yet), and against a variant line `- textbox "Email" [ref=e7]: typed-value-1234` → `['typed-value-1234']`.
- `test('no match yields an empty array')`.

`line.js` covered in `secrets.test.js`: `test('AC3.1: scrubLine renders the exact copy')` → `scrubLine({values_scrubbed:1, artifacts_scrubbed:4, screenshots_removed:2})` === `'1 secret value(s) scrubbed from 4 artifact(s); 2 screenshot(s) removed'`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/qa-scrub/`
Expected: FAIL — `Cannot find module '…/qa-scrub/secrets'`.

- [ ] **Step 3: Implement the three modules per the Interfaces and rules above**

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/qa-scrub/`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/qa-scrub/ tests/bin-lib/qa-scrub/ tests/fixtures/qa-scrub/
git commit -m "Add qa-scrub secrets parser and snapshot locator resolver — refs #4477"
```

### Task 2: The scrub pass

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/qa-scrub/scrub.js`
- Test: `tests/bin-lib/qa-scrub/scrub.test.js`
- Test fixtures: `tests/fixtures/qa-scrub/trace-reveal.trace` (JSONL with the fake token in a frame-snapshot event and once JSON-escaped with an embedded quote variant), `tests/fixtures/qa-scrub/console-reveal.log` (`[    1234ms] token issued: FAKE-QA-TOKEN-0000-not-a-real-secret`)

**Interfaces:**
- Consumes: Task 1's `parseSecrets` output shape, `resolveLocatorValues`, `scrubLine`, `MIN_VALUE_LENGTH`.
- Produces: `scrubStoryArtifacts({ secrets, screenshots: string, traces?: string|null, cliDir?: string|null, since?: Date|null }) -> Outcome` where
  `Outcome = { ok: boolean, values_scrubbed: number, artifacts_scrubbed: number, screenshots_removed: number, deleted: Array<{path, reason:'zip-container'|'binary'}>, remaining: string[], errors: Array<{path?:string, locator?:number, code:string}>, reveal: 'snapshot'|'unknown'|'none', no_matches: boolean, line: string }`. `REDACTION_MARKER = '[REDACTED:qa-secret]'` exported.

Algorithm (decisions the implementer must follow):
1. Scope: every file under `screenshots` and `traces` (recursive; a missing dir is empty), plus every file under `cliDir` whose mtime >= `since`. Classify by leading bytes: image (PNG `89 50 4E 47`, JPEG `FF D8 FF`, GIF `47 49 46 38`, WEBP `RIFF....WEBP`), zip (`50 4B 03 04`), text (no NUL byte), else binary.
2. Locator values: run `resolveLocatorValues` over every in-scope text file ending `.yml`/`.yaml`; union per locator. A locator with no value → `errors.push({locator:i, code:'locator-unresolved'})`; a value shorter than `MIN_VALUE_LENGTH` → `{locator:i, code:'locator-value-too-short'}` and it is not used.
3. Matchers: each pattern regex; each literal value as an escaped regex, plus its JSON-escaped form (`JSON.stringify(v).slice(1,-1)`) when that differs.
4. Find: text files are matched as UTF-8; binary files as `latin1`. Record distinct matched strings in memory only (`values_scrubbed` = their count). Reveal time T = min mtime of matching `.yml`/`.yaml` files (`reveal:'snapshot'`); matches only in other files → `reveal:'unknown'`; no matches anywhere → `reveal:'none'`, `no_matches:true`.
5. Act: rewrite each matching text file with every match replaced by `REDACTION_MARKER` (via `lib/atomic-write.js`'s `writeFileAtomic`); delete every zip (`zip-container`) and every matching binary (`binary`). Images: `reveal:'snapshot'` → delete those with mtime >= T; `'unknown'` → delete all in scope; `'none'` → delete none. `artifacts_scrubbed` = rewritten + non-image deletions; `screenshots_removed` = image deletions.
6. Verify: re-read every surviving non-image file and re-run all matchers; any hit → `remaining`. Any fs error → `errors.push({path, code})` and the path into `remaining`. Any `locator-unresolved`/`locator-value-too-short` error puts every surviving in-scope file into `remaining` (the value cannot be proven gone).
7. `ok = remaining.length === 0 && errors.length === 0`; `line = scrubLine(counts)`.

Test helper: build a temp tree with `fs.mkdtempSync` holding `screenshots/` (`00_open.png`, `01_click-reveal.png`, `02_verify.png` — PNG magic + body; `01`/`02` bodies embed the fake token bytes so `grep` can see them), `traces/` (copy of `trace-reveal.trace`), `cli/` (copy of `page-reveal.yml` as `page-2026-10-30T10-00-02-000Z.yml`, `console-reveal.log`, `traces/resources/frame1` JPEG-magic file). Set mtimes with `fs.utimesSync`: `00_open.png` = t0, snapshot = t1, `01`/`02` = t2/t3, cli files = t1..t3, with `since` = t0 - 1s; a `cli/page-old.yml` holding the token with mtime before `since`.

- [ ] **Step 1: Write the failing tests**

- `test('AC1.1: a pattern secret leaves zero matches under the story dirs (grep -r)')` — run with `[{kind:'pattern', …/FAKE-QA-TOKEN-\d{4}-[a-z-]+/}]`, then `execFileSync('grep', ['-r', '-F', 'FAKE-QA-TOKEN-0000', screenshots, traces, cliDirInScopeFiles…])` throws with `status === 1`; `cli/page-old.yml` (out of scope) is untouched.
- `test('AC2.1: screenshots from the reveal step onward are removed')` — `01_click-reveal.png`, `02_verify.png` and the in-scope JPEG frame no longer exist; `screenshots_removed === 3`.
- `test('AC2.2: earlier screenshots are kept')` — `00_open.png` exists byte-identical.
- `test('AC6.1: snapshot YAML, trace and console log are rewritten with the marker')` — each holds `[REDACTED:qa-secret]` and not the token; the JSON-escaped variant in the trace is gone too.
- `test('AC3.1: counts and line')` — `values_scrubbed`, `artifacts_scrubbed` (3 text files), `screenshots_removed` (3) and `line` equal `scrubLine` of them; `JSON.stringify(outcome)` does not contain `FAKE-QA-TOKEN`.
- `test('a locator secret resolves from the reveal snapshot and joins the scrub')` — `{kind:'locator', locator:{role:'textbox', name:'API key'}}` scrubs `FAKE-QA-KEY-9999` everywhere.
- `test('AC5.1: an unreadable trace fails the scrub and lists its path')` — add `traces/broken.trace` as a dangling symlink (works as root, unlike `chmod 0`) → `ok === false`, `remaining` includes that path, `errors` has an entry for it with a non-empty `code`.
- `test('a zip trace is deleted and counted')` — a `traces/t.trace` starting `PK\x03\x04` → `deleted` has `{reason:'zip-container'}`, file gone, counted in `artifacts_scrubbed`.
- `test('an unresolved locator fails rather than reporting clean')` — `{role:'textbox', name:'Nope'}` → `ok === false`, `errors` has `locator-unresolved`.
- `test('no matches deletes nothing and flags no_matches')` — pattern `NEVER-PRESENT-\d+` → `ok === true`, `no_matches === true`, all files present.
- `test('a sibling story file in cliDir without the secret is not rewritten')` — an in-scope `cli/page-sibling.yml` without the token keeps its mtime and bytes.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/qa-scrub/scrub.test.js`
Expected: FAIL — `Cannot find module '…/qa-scrub/scrub'`.

- [ ] **Step 3: Implement `scrubStoryArtifacts` per the algorithm**

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/qa-scrub/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/qa-scrub/scrub.js tests/bin-lib/qa-scrub/scrub.test.js tests/fixtures/qa-scrub/
git commit -m "Add qa-scrub artifact scrub pass — refs #4477"
```

### Task 3: `qa-scrub.js` CLI

**Role:** integration

**Files:**
- Create: `plugin/bin/qa-scrub.js`
- Modify: `docs/plugin-structure.md` (a `plugin/bin/lib/qa-scrub/` module row beside `plugin/bin/lib/qa-report/`, and a command line beside `qa-report.js`'s)
- Modify: `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` (name `qa-scrub.js` in the *Payload-1/Invocation-2* bullet beside `qa-report.js`, with its domain exit 3)
- Test: `tests/bin-lib/qa-scrub/cli.test.js`

**Interfaces:**
- Consumes: `parseSecrets`, `scrubStoryArtifacts`.
- Produces: `node plugin/bin/qa-scrub.js --secrets <file.json> --screenshots <dir> [--traces <dir>] [--cli-dir <dir> --since <ISO-8601>]`; exported `run(argv, deps)`, `parseArgs(argv)`. Stdout: one JSON line = the Outcome (exit 0/3) or `{ok:false, error:'<code>'}` (exit 1). Usage on stderr for exit 2.

Rules: flags looked up with `Object.hasOwn`; each value-taking flag rejects a missing/empty/`--`-prefixed value; `--cli-dir` without `--since` is malformed (the dir is shared across parallel stories); `--since` must parse to a valid `Date`. `deps` = `{ readFile, scrub, stdout, stderr }`.

- [ ] **Step 1: Write the failing tests** — `test('exit 0 prints the outcome line JSON')` (spawn the real binary against a Task 2-style temp tree; parse stdout; `ok === true`), `test('exit 3 when a path remains')` (dangling-symlink trace), `test('exit 1 on an invalid secrets payload, error code only')` (pattern `.*`; stdout has `error: 'pattern-matches-empty: entry 0'`), `test('exit 1 on unreadable secrets file')`, `test('exit 2 on --cli-dir without --since, trailing bare flag, unknown flag')`, `test('stdout never contains the secret')`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/qa-scrub/cli.test.js` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement the CLI**, header comment stating the exit vocabulary and that `--secrets` holds patterns/locators only, never values.
- [ ] **Step 4: Run** `node --test tests/bin-lib/qa-scrub/ tests/bin-lib/exit-code-conformance.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add plugin/bin/qa-scrub.js tests/bin-lib/qa-scrub/cli.test.js docs/plugin-structure.md .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md && git commit -m "Add qa-scrub.js CLI — refs #4477"`

### Task 4: `report.json` carries the per-story scrub outcome

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/qa-report/compose.js` (validate + emit `scrub`)
- Test: `tests/bin-lib/qa-report/compose.test.js`

**Interfaces:**
- Consumes: `scrubLine` (Task 1).
- Produces: payload story field `scrub?: { ok: boolean, values_scrubbed: int>=0, artifacts_scrubbed: int>=0, screenshots_removed: int>=0, remaining?: string[] }`; report `stories[i].scrub = { ok, values_scrubbed, artifacts_scrubbed, screenshots_removed, remaining, line }` **only when the payload story carries `scrub`** (key absent otherwise). Validation errors: `invalid-scrub: {id}` (wrong shape), `scrub-failed-not-fail: {id}` (`ok === false` on a non-FAIL story). `line` is recomputed with `scrubLine`, never taken from the payload. The agent forwards Task 2's whole Outcome as `scrub`; compose keeps only the keys above and ignores the rest (`deleted`, `errors`, `reveal`, `no_matches`, `line`). When the helper never ran (exit 1/2) the agent sends `{ok:false, values_scrubbed:0, artifacts_scrubbed:0, screenshots_removed:0, remaining:[<the three dirs>]}`.

- [ ] **Step 1: Write the failing tests** — `test('AC4.1: a story without scrub has exactly the pre-change keys')` (deepEqual `Object.keys(report.stories[0])` to the 11 existing keys), `test('AC3.1: a scrubbed story carries counts and the composed line')`, `test('AC5.1: a failed scrub on a PASS story is refused')`, `test('AC5.1: a failed scrub on a FAIL story lists remaining paths')`, `test('a malformed scrub is refused')` (negative count, non-boolean ok, non-string remaining entry).
- [ ] **Step 2: Run** `node --test tests/bin-lib/qa-report/compose.test.js` — Expected: FAIL on the new tests only.
- [ ] **Step 3: Implement** in `validate` and the `stories.map` (spread `scrub` in conditionally).
- [ ] **Step 4: Run** `node --test tests/bin-lib/qa-report/ tests/qa-report-writer-conformance.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Carry per-story secret scrub outcome in report.json — refs #4477"` (compose.js + test).

### Task 5: Story schema, dispatch, agent, and reporting prose

**Role:** integration

**Files:**
- Modify: `plugin/skills/stories/SKILL.md` (Story schema (v2): one paragraph + YAML lines for the optional story-level `secrets:` field — entries `pattern:` (JS regex) or `locator:` (`role`+`name`, `label`, `placeholder`; not `testid`/`text`, with why); what happens at run time)
- Modify: `plugin/skills/stories/story-examples.md` (new `### Example 5: Reveal-once secret` — a story that issues a token and asserts it shows once, with `secrets:` carrying one pattern and one locator, fake values)
- Modify: `plugin/skills/test/qa-prompts.md` (step 19: when a story declares `secrets:`, write it as a JSON array to `{RUN_DIR}/secrets/{story.id}.json` with the Write tool and add `**Secrets file:**` and `**Scrub helper:**` (the literal absolute `{plugin-root}/bin/qa-scrub.js`) to the structured template; one Instructions bullet: after close, run the helper and report per the agent's Section 6.5; the REPORT_JSON shape gains an optional `"scrub"` key emitted only when the helper ran; legacy `workflow` stories cannot declare secrets)
- Modify: `plugin/agents/qa-agent.md` (Parse: two new optional fields; Setup a0: when `**Secrets file:**` is present, record `STORY_STARTED_AT` via `node -p "new Date().toISOString()"` before `open`; new `### 6.5 Secret scrub` — only when `**Secrets file:**` is present, after Close: `node "{Scrub helper}" --secrets "{Secrets file}" --screenshots "{SCREENSHOT_PATH}" --traces "{TRACES_BASE}/<story-id>" --cli-dir "<working dir>/.playwright-cli" --since "{STORY_STARTED_AT}"`; branch: exit 0 → `SCRUB: {line}` line + REPORT_JSON `scrub` object, `no_matches: true` → add caveat "secrets declared but no artifact matched — check the story's secrets: entries"; exit 3 → story FAIL, error `secret scrub incomplete: {n} path(s) still hold a secret value or could not be checked`, list `remaining`; exit 1/2 → story FAIL, error `secret scrub did not run: {error}`, remaining = the three dirs; never print a secret value or a snapshot line holding one; Report examples unchanged for stories without secrets)
- Modify: `plugin/skills/test/qa-reporting.md` (Phase 4 extracts `scrub` from REPORT_JSON; Phase 5 payload story gains optional `scrub`; schema `stories[]` shows `scrub` as present only when the story declared secrets; QA Review Summary gains `## Secret Scrub` — one row per story with its `line`, only when any story has `scrub`)
- Modify: `docs/skill-graph.md` (the `qa-agent` row near line 603: for a story declaring `secrets:` it runs `bin/qa-scrub.js` after closing the session)
- Test: `tests/qa-scrub-prose-conformance.test.js`
- Must stay green (plan-audit Check B surfaced them as pinning the same prose): `tests/stories-caption-expand-only.test.js`, `tests/qa-prompts-step-origin.test.js`, `tests/qa-report-writer-conformance.test.js`

**Interfaces:**
- Consumes: CLI flags and exit codes (Task 3), `scrub` payload shape (Task 4).

- [ ] **Step 1: Write the failing conformance test** — one assertion function per pin, run against the live text and against a control with the pinned clause removed (go-red control runs the same function and expects a throw):
  - `test('AC4.2: qa-agent invokes the scrub helper only under a Secrets file')` — Section 6.5 exists, names `qa-scrub.js` flags `--secrets`/`--screenshots`/`--traces`/`--cli-dir`/`--since`, and is conditioned on `**Secrets file:**`.
  - `test('AC5.1: qa-agent maps exit 3 and exit 1/2 to FAIL with remaining paths')`.
  - `test('qa-prompts writes the secrets file and adds both fields to the structured template')`.
  - `test('stories schema documents secrets: pattern and locator')` and `test('story-examples has a reveal-once example')`.
  - `test('qa-reporting carries scrub through Phase 4 and Phase 5')`.
- [ ] **Step 2: Run** `node --test tests/qa-scrub-prose-conformance.test.js` — Expected: FAIL.
- [ ] **Step 3: Edit the five prose files** per the Files block (edit in place; keep every existing sentence that still holds).
- [ ] **Step 4: Run** `node --test tests/qa-scrub-prose-conformance.test.js tests/qa-report-writer-conformance.test.js` and then `npm test` — Expected: PASS; full suite no new failures.
- [ ] **Step 5: Commit** — `git commit -m "Document story secrets: and wire the qa-agent scrub — refs #4477"`

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (schema field + docs) | 1 (parser), 5 (SKILL.md, story-examples.md) |
| Deliverable 2 (scrub after story, bin helper) | 2, 3, 5 (agent wiring) |
| Deliverable 3 (report line; failure never clean) | 1 (`scrubLine`), 4, 5 |
| AC1.1 | Task 2 |
| AC2.1, AC2.2 | Task 2 |
| AC3.1 | Tasks 1, 2, 4 |
| AC4.1 | Task 4 |
| AC4.2 | Task 5 |
| AC5.1 | Tasks 2, 4, 5 |
| AC6.1 | Tasks 1, 2 |
| Gotcha: zip traces | Task 2 |
| Gotcha: `.playwright-cli/` outside the story dirs | Tasks 2 (`cliDir` + `since`), 5 |
| Gotcha: never log values | Global Constraints; Tasks 2, 3 tests |
