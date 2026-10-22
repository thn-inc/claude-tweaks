# Quote Session-Tmp Path Placeholders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every temp-path placeholder on a shell command line in `plugin/skills/**/*.md` is double-quoted, and a conformance test fails when one is not.

**Architecture:** One new `node --test` suite carries a small shell-quote-state scanner. It walks every `bash`/`sh`/`shell` fence in `plugin/skills/**/*.md`, tracks quote context across lines (so a placeholder inside a multi-line `node -e "…"` string counts as quoted), and reports each target placeholder that sits in unquoted command context. The skill fences are then edited in place until the sweep is empty.

**Tech Stack:** Node 18+, `node:test`, `node:assert/strict`, `tests/helpers/read-skill.js`'s `readText`.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T002612-record-3544/work/3544-spec.md` (materialized from GitHub issue #3544)

## Global Constraints

- Edit the fences in place; touch only the placeholder's quoting (and the two specify substitution values in Task 1). No rewording, no reflow.
- Read governed markdown through `readText` from `tests/helpers/read-skill.js`, never a raw `fs.readFileSync`.
- Fence-opening regexes use `\r?\n`-safe line splitting; fences may be indented (`   ```bash`).
- Every go-red control runs the same scanner function the live sweep runs (Go-red control check).
- Commits: `{Verb} {what} — {detail}` style, ending with `refs #3544` — never `closes`/`fixes`.
- Every edited skill file stays far under `RAIL_BYTES` (52,500 B): the largest, `_shared/trust-table.md`, is 31,206 B and is not edited; `_shared/record-queue-fetch.md` is 14,279 B and grows by about 14 B plus one sentence.

## Survey result (Deliverable 1)

Target placeholders, with the shell-level verdict at HEAD `1d3934f5c`:

| File:line | Placeholder | Verdict |
|---|---|---|
| `_shared/record-queue-fetch.md:67` | `{tmp-records-file}` | unquoted — quote (Task 1) |
| `_shared/record-queue-fetch.md:72` | `{tmp-records-file}` (redirect target) | unquoted — quote (Task 1) |
| `_shared/record-queue-fetch.md:76` | `{tmp-open-only-file}` (redirect target) | unquoted — quote (Task 1) |
| `_shared/record-queue-fetch.md:84` | `{tmp-records-file}` | unquoted — quote (Task 1) |
| `_shared/record-queue-fetch.md:137`, `:166` | `{tmp-faceted-file}` (redirect after a `node -e "…"` string) | unquoted — quote (Task 1) |
| `_shared/record-queue-fetch.md:73,79-81,132` | `{tmp-*}` inside a `node -e "…"` JS literal | already inside a double-quoted shell argument — no change |
| `_shared/trust-table.md` (all shell lines) | `{tmp-parent-issues}` etc. | already quoted, or inside `node -e "…"` — no change |
| `_shared/trust-table.md:301-302`, `capture/SKILL.md:107-108` | `{Session-scoped … with {tmp-records-file} = …}` | substitution directive, not a command — no change; scanner skips it |
| `_shared/session-tmp-root.md:43` | `{tmp-var}=$(…)` | a variable name, never a path — exempt |
| `specify/decomposition-mode.md:50`, `specify/record-creation.md:42` | substitution value `"$SPECIFY_ALL_ISSUES"` | pre-quoted; once the fences quote, it yields `""$SPECIFY_ALL_ISSUES""` (unquoted `$VAR`) — change to bare `$SPECIFY_ALL_ISSUES` (Task 1) |
| `walkthrough/SKILL.md:60` | `--filename={frame-path}` (a `sessionTmpPath`) | unquoted — quote (Task 2) |
| `walkthrough/SKILL.md:72` | `{frame-dir}`, `{gif-path}`, `{steps-json-path}` | unquoted — quote (Task 2) |
| `review/review-effort-derivation.md:20` | `> {ctx-dir}/record-{n}.json`, `{ctx-dir}` = `$CTX_DIR` (`os.tmpdir()` mkdtemp, or the main checkout under `--run`; this checkout's own path has a space) | unquoted — quote (Task 2) |
| `{subject-dir}` (four merge files) | — | already quoted by #3522 — joins the sweep as a regression guard |
| `review/step3-lens-dispatch.md:92` | `{path-A} {path-B}` (`categorise-reproduction`; session-tmp paths printed by `session-tmp-resolve.js`) — in a blockquoted bash fence the opener regex could not open | unquoted — quote (final-review wave) |
| `review/step3-debate-and-refutation.md:17` | `{path-F}` (`detect-overlap`; a `session-tmp-resolve.js` path) | unquoted — quote (final-review wave) |
| `review/step3-cross-lens-corroboration.md:12` | `{path-U}` (`corroborate-cross-lens`; a `session-tmp-resolve.js` path) | unquoted — quote (final-review wave) |
| `build/dispatch.md:24,25` | `--file {tmp}.md` (the `stage-item.js` temp file) | unquoted — quote (final-review wave) |
| `specify/next-mode-shape.md:95` | `--body-file {tmp}` in an unlabelled fence | unquoted — quote and label the fence `bash` (final-review wave) |
| `challenge/SKILL.md:95,97` | `--body-file {tmp}` in inline code spans (outside the fence sweep) | unquoted — quote anyway (final-review wave) |
| `review/step3-lens-dispatch.md:22,66` | blockquoted bash fences (the `compose-context.js` and `build-review-context.js` fences), previously invisible to `shellFences` | no target placeholder — now scanned, no change |
| `build/plan-review.md:103` | `--body-file {path}` in an inline span (`{path}` = the literal path `session-tmp-resolve.js` prints for `PLAN_REVIEW_BODY`) | unquoted — quote (inline-span wave); `{path}` pinned for this file only via `FILE_TARGETS` |
| `tidy/release-note-repair.md:70,72,73,123,129,130,144` | `{live-json}`, `{line-file}`, `{repaired-body}`, `{after-json}`, `{snapshot}` (lines 64-67 and 81 name them session-tmp; `{snapshot}` is a run-dir path when a run directory resolved) in inline command spans | unquoted — quote (inline-span wave); five names added to `NAMED_TARGETS` |
| `tidy/release-note-repair.md:104` | `cp {snapshot} {path}` | `{snapshot}` unquoted — quote (inline-span wave); `{path}` (the local-files record file, not session-tmp) left bare, not pinned |
| `_shared/pr-checklist-refresh.md:60,84` | `--summary-file {file}` (session-tmp, `bin/session-tmp-resolve.js`) in spans opening with a flag | unquoted — quote (inline-span wave); outside the mechanical sweep, `{file}` unpinned |
| `_shared/pr-checklist-refresh.md:83-84` | `--body-file {body-file}`, `--out {body-file}` in a span wrapping across lines | unquoted — quote in place (inline-span wave); wrapped spans are outside the mechanical sweep, so these uses are unpinned (`{body-file}` stays a named target for any future fence or single-line span) |
| inline command spans with `{subject-dir}` / `{tmp}` (`_shared/issue-claims.md:516`, `flow/worktree-merge.md:131`, `challenge/SKILL.md:95,97`) | — | already quoted — now counted by the span sweep |
| `release/bookkeeping.md:31`, `specify/red-team.md:91`, `test/verification.md:226`, `wrap-up/review-console.md:120` | `{file}`, `{path}`, `{proposal}`, `{scratch-file}` | location not stated as session-tmp — set aside, not touched |

Inline-code shell spans (single-line, opening with `gh`/`node`/`git`/`cp`/`mv`/`cat`/`rm`/`npx`/`bash`/`sh`) are swept by `scanSpansCorpus`. Prose mentions of a bare placeholder, spans opening with a flag, and spans wrapping across a newline are outside the sweep.

## Review Focus

1. A pre-quoted substitution value (`{tmp-records-file} = "$VAR"`) turns the newly quoted fence into `""$VAR""`. A reasonable person expects the variable to be quoted in the final command. Task 1's substitution-value ban covers it.
2. A placeholder inside a multi-line `node -e "…"` string is already quoted. A scanner that resets quote state per line would flag it, or would miss the unquoted `" > {tmp-faceted-file}` that follows the string. Task 1 covers both with helper tests.
3. A Windows `core.autocrlf` checkout yields `\r\n` lines. The sweep must find the same offenders, and Task 1's CRLF control checks that it does.
4. Apostrophes in `#` comments or heredoc bodies would desync the quote state. Task 1 has comment and heredoc controls, and an unbalanced fence that holds a target is itself reported as an offender, never silently passed.
5. Substitution directives (`{Session-scoped … with {tmp-records-file} = …}`) inside a fence are not commands. Task 1 has a directive control.

---

### Task 1: Scanner, conformance suite, and record-queue-fetch quoting

**Files:**
- Create: `tests/session-tmp-placeholder-quoting-conformance.test.js`
- Modify: `plugin/skills/_shared/record-queue-fetch.md` (lines 67, 72, 76, 84, 137, 166, plus one sentence after the read-fresh-or-fetch fence)
- Modify: `plugin/skills/specify/decomposition-mode.md:50`
- Modify: `plugin/skills/specify/record-creation.md:42`
- Test: `tests/session-tmp-placeholder-quoting-conformance.test.js`

**Interfaces:**
- Produces (all in the test file; Task 2 extends `NAMED_TARGETS` only):
  - `const NAMED_TARGETS = ['{subject-dir}']` — explicit non-`{tmp-*}` targets.
  - `const EXEMPT = ['{tmp-var}']` — a variable-name placeholder, never a path.
  - `isTarget(name: string) -> boolean` — `/^\{tmp-[a-z0-9-]+\}$/.test(name) && !EXEMPT.includes(name)` or `NAMED_TARGETS.includes(name)`.
  - `shellFences(text: string) -> Array<{ file?: string, startLine: number, lines: string[] }>` — splits on `/\r?\n/`; a fence opens on `/^\s*(```+|~~~+)\s*(bash|sh|shell)\s*$/` and closes on the next line matching the same marker run; other fence languages are skipped, but their bodies are still consumed so a nested marker does not desync.
  - `scanFence(lines: string[]) -> { offenders: Array<{ line: number, name: string }>, quoted: number, balanced: boolean }` — `line` is 0-based within `lines`; `name` is the placeholder (`'{tmp-records-file}'`), or `'unbalanced'` (see below).
  - `scanCorpus() -> { offenders: Array<{ file, line, name }>, quoted: number, fences: number, targetFences: number }` — over every `.md` under `plugin/skills`, `line` 1-based in the file.
  - `preQuotedSubstitutions(text: string) -> string[]` — matches of `/\{tmp-[a-z0-9-]+\}`?\s*=\s*`?"\$/g`.

- [ ] **Step 1: Write the failing tests**

`scanFence` algorithm (the signature does not determine it): a context stack, starting `['cmd']`, carried across lines.
- In `cmd`, `sub` or `bt` context: `\` skips the next char. `'` pushes `sq`, `"` pushes `dq`, `$(` and a bare `(` push `sub`, and `)` pops a `sub`. A backtick pushes `bt`, or pops when the top is `bt`. A `#` at word start (start of line, or after whitespace or `;|&(`) ends the line. A heredoc operator `<<-?\s*['"]?(\w+)['"]?` arms a terminator: after the current line, skip lines until one whose trimmed text equals the delimiter.
- In `dq`: `\` skips the next char, `"` pops, and `$(` pushes `sub`.
- In `sq`: `'` pops.
- Substitution directive: when the stack is exactly `['cmd']` and a line's trimmed text matches `/^\{[A-Z]/`, skip lines until the `{`/`}` count opened there returns to zero.
- At each `{name}` token (`/\{[a-z][a-z0-9-]*\}/`) where `isTarget(name)`: count it as quoted when the stack top is `dq` or `sq`, else push an offender.
- `balanced` is true when the stack is `['cmd']` and no heredoc or directive is open at the end. An unbalanced fence that contained at least one target pushes `{ line: lines.length - 1, name: 'unbalanced' }`.

Frozen excerpt constant `PRE_CHANGE_QUEUE_FETCH`: the exact bytes of `git show 1d3934f5c:plugin/skills/_shared/record-queue-fetch.md` lines 60-85 (the read-fresh-or-fetch fence body, between the ```` ```bash ```` and closing ```` ``` ```` lines). Copy it with `git show`, never retype it. Frozen constant `PRE_CHANGE_SPECIFY_SUBST`: the exact substring `` with {tmp-records-file} = "$SPECIFY_ALL_ISSUES"} `` from `git show 1d3934f5c:plugin/skills/specify/decomposition-mode.md` line 50.

Tests (names carry the AC ids):

```js
test('AC1.1: no target placeholder sits unquoted on a shell line in plugin/skills', () => {
  const r = scanCorpus();
  assert.ok(r.fences > 0 && r.targetFences > 0, 'empty haystack — the fence extractor found nothing');
  assert.ok(r.quoted >= QUOTED_FLOOR, `only ${r.quoted} quoted target sites found — the scanner stopped seeing them`);
  assert.deepStrictEqual(r.offenders, [], /* message listing file:line name */);
});
test('AC1.1 go-red: the frozen pre-change record-queue-fetch.md fence reports its four unquoted uses', () => {
  const r = scanFence(PRE_CHANGE_QUEUE_FETCH.split('\n'));
  assert.deepStrictEqual(r.offenders.map((o) => o.name),
    ['{tmp-records-file}', '{tmp-records-file}', '{tmp-open-only-file}', '{tmp-records-file}']);
  assert.strictEqual(r.quoted, 4);
  assert.strictEqual(r.balanced, true);
});
test('AC1.1 go-red (CRLF): the same excerpt with \\r\\n line ends reports the same four', () => { /* PRE_CHANGE_QUEUE_FETCH.replace(/\n/g, '\r\n') through shellFences-equivalent split /\r?\n/ then scanFence; same deepStrictEqual */ });
```

Helper proofs (each calls `scanFence` on a hand-built array and asserts `offenders`/`quoted`):
- `node -e "\n  require('{tmp-a}')\n" > {tmp-b}` gives `offenders` names `['{tmp-b}']` and `quoted` 1.
- `cp {tmp-a} "$S"` gives `['{tmp-a}']`, while `cp "{tmp-a}" "$S"` and `cp '{tmp-a}' x` each give `[]` with `quoted` 1.
- `X="$(node -e "console.log(require('{tmp-a}'))")"` gives `[]` with `quoted` 1.
- `# don't touch {tmp-a}` gives `[]` with `quoted` 0. The fence still reads `balanced`, because the comment's apostrophe was ignored.
- A heredoc (`node x.js <<'EOF'`, `it's {tmp-a}`, `EOF`, `cp {tmp-b} y`) gives `['{tmp-b}']`.
- A directive (`{Session-scoped block, with {tmp-records-file} =`, ` $VAR}`, `cp {tmp-b} y`) gives `['{tmp-b}']`.
- `{tmp-var}=$(node -e "x")` gives `[]` with `quoted` 0, because it is exempt.
- `echo "it's {tmp-a}` with no closing `"` gives `balanced` false and names `['unbalanced']`.
- `echo {owner} {repo}` gives `[]` with `quoted` 0, because these are non-targets.

Stale-check and substitution ban:
- `test('EXEMPT {tmp-var} is still a variable-name placeholder — shrink the list if this fails', …)`: `readText` on `_shared/session-tmp-root.md` matches `/^\{tmp-var\}=/m`.
- `test('AC1.1: no {tmp-*} substitution value is pre-quoted', …)`: across every `plugin/skills/**/*.md`, `preQuotedSubstitutions` returns `[]`. Its go-red runs the same function on `PRE_CHANGE_SPECIFY_SUBST`, which returns one match.

`QUOTED_FLOOR`: a literal equal to `scanCorpus().quoted` measured after Step 3's edits. Record the measured number in the commit message.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/session-tmp-placeholder-quoting-conformance.test.js`
Expected: FAIL. The AC1.1 live sweep lists the six `record-queue-fetch.md` lines (67, 72, 76, 84, 137, 166). The pre-quoted-substitution test lists the two specify files. The go-red, CRLF, helper and stale-check tests PASS. (Set `QUOTED_FLOOR` to `0` for this run.)

- [ ] **Step 3: Edit the fences in place**

- `record-queue-fetch.md`: wrap each of the six placeholders in double quotes, so `cp "$SNAPSHOT" "{tmp-records-file}"`, `> "{tmp-records-file}"`, `> "{tmp-open-only-file}"`, `cp "{tmp-records-file}" "$SNAPSHOT"`, and `" > "{tmp-faceted-file}"` (twice).
- Add one sentence immediately after the read-fresh-or-fetch fence, before "This block always fetches": `The fences quote every `{tmp-*}` placeholder themselves — substitute a bare path or a bare `$VAR`, never a pre-quoted value.`
- `decomposition-mode.md:50` and `record-creation.md:42`: change `= "$SPECIFY_ALL_ISSUES"}` to `= $SPECIFY_ALL_ISSUES}`. Leave the file's other `"$SPECIFY_ALL_ISSUES"` mentions alone; they are real shell expansions.
- Then set `QUOTED_FLOOR` to the measured `scanCorpus().quoted`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/session-tmp-placeholder-quoting-conformance.test.js tests/record-queue-fetch-conformance.test.js tests/session-tmp-root-migration.test.js tests/specify-record-creation-linking.test.js tests/specify-staged-for-caller.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add tests/session-tmp-placeholder-quoting-conformance.test.js plugin/skills/_shared/record-queue-fetch.md plugin/skills/specify/decomposition-mode.md plugin/skills/specify/record-creation.md
git commit -m "Quote {tmp-*} placeholders in record-queue-fetch fences — add a shell-quote conformance sweep, refs #3544"
```

---

### Task 2: Walkthrough and review temp-path placeholders

**Files:**
- Modify: `tests/session-tmp-placeholder-quoting-conformance.test.js` (`NAMED_TARGETS`, two go-red controls, `QUOTED_FLOOR`)
- Modify: `plugin/skills/walkthrough/SKILL.md` (lines 60, 72)
- Modify: `plugin/skills/review/review-effort-derivation.md:20`
- Test: `tests/session-tmp-placeholder-quoting-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's `NAMED_TARGETS`, `scanFence`, `scanCorpus`, `QUOTED_FLOOR`.
- Produces: `NAMED_TARGETS = ['{subject-dir}', '{frame-path}', '{frame-dir}', '{gif-path}', '{steps-json-path}', '{ctx-dir}']`.

- [ ] **Step 1: Write the failing tests**

Extend `NAMED_TARGETS` as above. Add frozen constants, copied with `git show 1d3934f5c:…`:
- `PRE_CHANGE_WALKTHROUGH_ENCODE`: `walkthrough/SKILL.md` line 72.
- `PRE_CHANGE_CTX_REDIRECT`: `review/review-effort-derivation.md` line 20, trimmed.

Add these tests:
- `test('AC1.1 go-red: the frozen walkthrough encode line reports {frame-dir}, {gif-path}, {steps-json-path}', …)`: `scanFence([PRE_CHANGE_WALKTHROUGH_ENCODE]).offenders.map((o) => o.name)` deep-equals `['{frame-dir}', '{gif-path}', '{steps-json-path}']`.
- `test('AC1.1 go-red: the frozen review redirect reports {ctx-dir}', …)`: `scanFence([PRE_CHANGE_CTX_REDIRECT])` gives `['{ctx-dir}']`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/session-tmp-placeholder-quoting-conformance.test.js`
Expected: FAIL. The AC1.1 live sweep lists `walkthrough/SKILL.md:60` (`{frame-path}`), `walkthrough/SKILL.md:72` (three names) and `review/review-effort-derivation.md:20` (`{ctx-dir}`). If it also lists any other `{ctx-dir}` or `{subject-dir}` site, quote that site in Step 3 too, and name it in the commit message. The new go-red tests PASS.

- [ ] **Step 3: Edit the fences in place**

- `walkthrough/SKILL.md:60`: change to `--filename="{frame-path}"`.
- `walkthrough/SKILL.md:72`: change to `--frames "{frame-dir}" --out "{gif-path}" … --steps-json "{steps-json-path}"`. Leave the rest of the line byte-identical.
- `review-effort-derivation.md:20`: change to `> "{ctx-dir}/record-{n}.json"`.
- Then re-measure and raise `QUOTED_FLOOR` to the new `scanCorpus().quoted`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/session-tmp-placeholder-quoting-conformance.test.js tests/walkthrough-conformance.test.js tests/bin-lib/walkthrough/encode-cli.test.js tests/bin-lib/review-context/prose.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add tests/session-tmp-placeholder-quoting-conformance.test.js plugin/skills/walkthrough/SKILL.md plugin/skills/review/review-effort-derivation.md
git commit -m "Quote walkthrough and review temp-path placeholders — extend the quoting sweep's named targets, refs #3544"
```

---

## Spec coverage

| Spec item | Covered by |
|---|---|
| Deliverable 1 (survey) | "Survey result" table above; `scanCorpus` is the mechanical form |
| Deliverable 2 (quote or record why not) | Task 1 Step 3, Task 2 Step 3; the "no change" rows above record why |
| Deliverable 3 (conformance test plus go-red on a frozen excerpt) | Task 1 Step 1 |
| AC1.1 | Task 1: `AC1.1` live sweep plus `AC1.1 go-red` on `PRE_CHANGE_QUEUE_FETCH` |
| AC2.1 (`npm test` passes) | Final Verification (`/claude-tweaks:build` Common Step 5) runs the full suite |
