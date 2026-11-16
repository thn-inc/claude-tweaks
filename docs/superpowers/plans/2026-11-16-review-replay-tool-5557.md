# Review Replay Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the review/tiebreak replay scratch scripts with one tested maintainer tool, `tools/review-replay.js` (`baseline`, `counterfactual`, `extract`, `score`), plus a thin workflow script.

**Architecture:** A CLI with the `run({ argv, deps })` seam and exit codes of `tools/driver-merge-check-eval.js`, over small modules under `tools/review-replay/`. `extract` builds judge prompts from `plugin/skills/review/step3-tiebreak.md` as it is at run time; `score` settles replies with `plugin/bin/lib/tiebreak.js`'s `resolveTiebreak`. The workflow script only hands each prompt file to one agent.

**Tech Stack:** Node 18+ CommonJS (`'use strict'`), `node --test`, no dependencies. The workflow script is an ES module for the Workflow tool.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T000458-record-5557/work/5557-spec.md` (revised 2026-11-16 for the record's three plan-review Decisions: discipline lines from the archived bundle with a counted fallback; the scratch `cant-tell` rule with failed judges counted by reason; AC8 met by a filed capture record)

**Scope keywords:** review-replay, replay-scratch, tiebreak-replay

## Global Constraints

- `tools/` does not ship (`docs/decisions/0015-*`). Nothing under `plugin/` may require or name `tools/review-replay` (AC12).
- Exit codes follow `tools/driver-merge-check-eval.js`: 0 ok; 1 runtime failure; 2 malformed invocation; 3 not a clean result (extract shortfall, or score with any `notJudged`).
- Seam: `run({ argv, deps })` returns the exit code (a Promise is fine). deps: `fs`, `git(args) -> stdout` (throws), `writeTree(head, destDir)`, `log(line)`, `err(line)`, `pluginRoot` (default `path.join(__dirname, '..', 'plugin')`).
- Every text file read is split on `/\r?\n/` (Windows checkout, `.claude/skills/windows-checkout-test-parity`).
- Chunk order follows the run's `review-findings.json` order. Never group by lens or by file.
- Fixtures under `tests/fixtures/review-replay/` are hand-written and hold only what a test asserts — no archived record bodies or review text.
- No file this plan creates or edits outside `docs/superpowers/plans/` and the ledger may contain the string `replay-scratch` (AC9's grep).
- Arm option: `--arm name=<id>,chunk=<n>,profile=<profile>,repeat=<n>`; `profile` is one of `fast|standard|capable|frontier` and resolves to `{ model, effort }` through `PROFILES` in `plugin/bin/lib/model-profiles/profiles.js`.

## Review Focus

1. A judge that cites the absolute extracted-tree path (the prompt's `Location:` is absolute) must still settle: `score` strips the tree prefix, in both `/` and native-separator spellings, before `resolveTiebreak` — test in Task 4.
2. A run whose verdict lines carry no `tiebreak:{id}` (older resolver) is matched by lens, path and line and counted under `fallbackMatched`, never silently dropped — test in Task 1.
3. `step3-tiebreak.md` checked out with CRLF line endings must yield the same prompt as the LF file — test in Task 2.
4. A finding whose file is absent at the reviewed commit is excluded with a reason, not written as a prompt — test in Task 3.
5. A results journal with an agent that has a `started` event but no `result` (crashed judge) counts that agent's findings `notJudged` and still totals its tokens — test in Task 4.
6. An archived `digested:`/`console:` tiebreak line whose reason is neither `verdict:cant-tell` nor `evidence-unverified` (e.g. `status:DONE`, `status:BLOCKED`, `no-evidence`, `could-not-parse`) is a failed judge, not a verdict: the finding gets no archived verdict, is never written as a prompt, and is counted under its reason — tests in Tasks 1 and 3 (record Decision Q2).
7. `score` identifies each judge by the `Replay judge {label}.` line in its own transcript's first user message — an assumption about the Workflow agent transcript shape that only AC8's live run confirms; a miss must surface as `unidentifiedAgents`/`notJudged`, never as a silently smaller denominator — test in Task 4.
8. Each prompt's two discipline lines come from that run's own `context/review-dispatch.md`; a run without it (or a bundle missing either line) uses today's `subagent-dispatch-core.md` lines, and the number of prompts that did is counted — never a silent mix, never an exclusion — test in Task 3 (record Decision Q1).

---

### Task 1: CLI skeleton, archive reader and `baseline`

**Files:**
- Create: `tools/review-replay.js`, `tools/review-replay/schema.js`, `tools/review-replay/archive.js`
- Create fixtures: `tests/fixtures/review-replay/archive/run-a/{decisions.md,review-findings.json,timing.json,packet-inputs/manifest.json,work/101-spec.md,context/review-dispatch.md}`, `tests/fixtures/review-replay/archive/run-b/{decisions.md,review-findings.json,timing.json,wrap-up-pack.json}`, `tests/fixtures/review-replay/archive/run-none/decisions.md`, `tests/fixtures/review-replay/archive/run-bad/decisions.md/.keep` (a directory named `decisions.md`, so the read throws `EISDIR` on every platform)
- Create: `tests/review-replay/helpers.js` (fake deps: a `git` that answers from a table, a `writeTree` that copies `tests/fixtures/review-replay/tree/`, captured `log`/`err`)
- Test: `tests/review-replay/baseline.test.js`

**Interfaces:**
- Produces (`schema.js`, the one home of both sides' schemas — `extract` and `score` import every key list from it): `SCHEMA_VERSION = 1`, `MANIFEST_FILE = 'manifest.json'`, `FIXTURE_FILE = 'fixture.json'`, `VERDICTS_FILE = 'archived-verdicts.json'`, `JOURNAL_FILE = 'journal.jsonl'`, `VERDICT_CLASSES = ['confirmed', 'refuted', 'cant-tell']`, `EXCLUSION_REASONS` (the strings below and Task 3's), `MANIFEST_KEYS = ['schemaVersion', 'template', 'arms']`, `ARM_KEYS = ['name', 'chunk', 'profile', 'model', 'effort', 'repeat', 'prompts']`, `PROMPT_KEYS = ['file', 'name', 'run', 'findingIds']`, `JOURNAL_EVENT_TYPES = ['started', 'result']`, `armLabel(arm, repeat, name) -> string` (`${arm}|${repeat}|${name}`), `parseArmLabel(label) -> {arm, repeat, name} | null`, `IDENTITY_RE = /^Replay judge (\S+)\.$/m` (the identity line the workflow puts first in each judge's prompt; Task 4 reads it back from the agent's transcript), `validateManifest(obj) -> string[]` (problems, from the key lists).
- Produces (`archive.js`):
  - `parseDecisions(text) -> { verdicts: [{ id: string|null, lens, path, line: number, verdict }], failedJudges: [{ id: string|null, lens, path, line: number, reason }], pairConfirmed: [{ lens, path, line }], fixCommits: string[], hasReview: boolean }`
  - `matchVerdicts(findings, verdicts, failedJudges = []) -> { byId: Map<id, verdict>, fallbackMatched, verdictsWithoutFinding, findingsWithoutVerdict, failedJudgeByReason: { [reason]: n }, failedJudgeIds: Set<id> }` — a finding matched (by id, else by lens/path/line) to a failed-judge line and to no verdict line is counted in `failedJudgeByReason[reason]` and `failedJudgeIds`, not in `findingsWithoutVerdict`.
  - `readRun(dir, deps) -> { run, dir, excluded: string|null, why: string[], findings: [{ id, lens, path, line, claim, severity, kind }] | null, verdicts, failedJudges, pairConfirmed, head: string|null, base: string|null, dispatchBundle: string|null, lensAgents: [{ agentId, lens, side: 'A'|'B'|null, out, cc }], cost: { lensAgents, tiebreakAgents, lensOut, lensCc, tbOut, tbCc, tbCr, tbSeconds }, specFiles: string[] }` — `dispatchBundle` is the text of `{dir}/context/review-dispatch.md`, `null` when absent or unreadable.
  - `listRuns(root, fs) -> string[]` (run directories directly under `root` and under `root/archive`, sorted by basename)
- Produces (`tools/review-replay.js`): `run({ argv, deps })`, `parseArgs(argv) -> { opts } | { error }`, `defaultDeps()`; subcommand `baseline --runs <root> [--select <name,...>]` prints one JSON object `{ runs: [readRun results minus findings/claims], excluded: [{ run, reason }] }`.

Rules `parseDecisions` must implement (lines containing `Console item` are ignored for verdicts):
- confirmed: `lens "{lens}" finding {path}:{line} confirmed by tiebreak` with optional `:{12-hex id}` right after `tiebreak`.
- refuted: `lens "{lens}" finding {path}:{line} dropped: refuted by tiebreak`, id from the line's `Tiebreak tiebreak:{id}:` step; also the older `refuted by tiebreak` with no id.
- cant-tell (record Decision Q2, the scratch rule): `Tiebreak tiebreak:{id}: lens "{lens}" finding {path}:{line} (digested|console): (verdict:cant-tell|evidence-unverified)`.
- failed judge (record Decision Q2): the same `Tiebreak tiebreak:{id}: lens "{lens}" finding {path}:{line} (digested|console): {reason}` shape with any other reason token (the run of non-space characters after `: `, trailing `.`/`,`/`;` stripped — e.g. `status:DONE`, `status:BLOCKED`, `no-evidence`, `could-not-parse`) → a `failedJudges` entry, never a verdict.
- pair: `Reproduction: lens "{lens}" finding {path}:{line} reproduced.` (never `not reproduced`).
- fix commits: `Step 3 Routing: applied .*\(commit ([0-9a-f]{7,40})\)`.
- `hasReview`: any verdict, pair or `not reproduced` line.

`readRun` rules: `decisions.md` read error other than ENOENT → `excluded: 'decisions-unreadable'`; ENOENT → `'no-decisions'`; `!hasReview` → `'no-review'`. Head = `git rev-parse {c}^` of the earliest (`git log -1 --format=%ct {c}`) fix commit the clone knows; none known → `why` gets `'no-fix-commit'` or `'fix-commit-not-in-clone'`. Base = `packet-inputs/manifest.json`'s `mergeBase`, else `wrap-up-pack.json`'s `inputs.base`; none → `why` gets `'no-recorded-base'`. Cost from `timing.json` `dispatches.items`: lens `/^(Review )?[Ll]ens 3[a-j]/`, side `/\b(?:agent |reviewer )?\(?([AB])\)?\s*$/`, tiebreak `/^Tiebreak/i`; fields `tokens.output`, `tokens.cacheCreate`, `tokens.cacheRead`, `wallClockMs` (the same source the old baseline script read; the PR names `timing.json` `dispatches.items[].tokens`). Findings from `review-findings.json` (`reporterSeverity` → `severity`, null → `'unknown'`), else `null`. `specFiles` = run-dir-relative `work/*.md`.

Fixture content: run-a has four findings in `review-findings.json` (ids `aaaaaaaaaaa1`, `aaaaaaaaaaa2`, `aaaaaaaaaaa3`, `aaaaaaaaaaa4`, severities medium, low, info, low), id-carrying verdict lines (confirmed, refuted, cant-tell via `digested: verdict:cant-tell`) plus one verdict line for an id not in the file, a `Tiebreak tiebreak:aaaaaaaaaaa4: … digested: status:DONE …` failed-judge line for the fourth finding, a `context/review-dispatch.md` whose `READ-ONLY REVIEW:` and `SHELL DISCIPLINE:` lines are hand-written and differ from today's `subagent-dispatch-core.md` text (each line backtick-quoted, as in a real bundle), a fix commit line `(commit 1111111)`, and `packet-inputs/manifest.json` `{"mergeBase": "<40 hex b>"}`. run-b has two findings and verdict lines with no ids (fallback), a fix commit line `(commit 2222222)`, and its base in `wrap-up-pack.json`. Fake git: `log -1 --format=%ct 1111111` → `100`, `rev-parse 1111111^` → `<40 hex a>`, `log -1 --format=%ct 2222222` → `200`, `rev-parse 2222222^` → `<40 hex c>` (run-b must reach Task 3's selection: its prompts are the discipline-fallback case).

- [ ] **Step 1: Write the failing tests** in `tests/review-replay/baseline.test.js`:
  - `AC1.1: baseline reports both reviewed runs with verdicts, head, base and cost` — run-a: 3 matched verdict classes, `head === HEAD_A`, `base === BASE_A`, `cost.tiebreakAgents` equal to the fixture's tiebreak item count.
  - `AC1.2: a run without reviews is excluded with reason no-review`.
  - `AC1.3: an unreadable decisions.md is reported with reason decisions-unreadable and excluded` — and exit code 0.
  - `matchVerdicts counts fallbackMatched, verdictsWithoutFinding and findingsWithoutVerdict` — run-a: fallback 0, verdictsWithoutFinding 1, findingsWithoutVerdict 0; run-b: fallback 2.
  - `a digested status:DONE tiebreak line is a failed judge counted by reason, not a cant-tell verdict` — run-a: `failedJudgeByReason` equals `{ 'status:DONE': 1 }`, `byId` has no entry for `aaaaaaaaaaa4`; and `parseDecisions` over the two lines `… digested: evidence-unverified.` / `… console: no-evidence.` yields one cant-tell verdict and one failed judge with reason `no-evidence`.
  - `readRun returns the run's context/review-dispatch.md text as dispatchBundle, null for a run without one` — run-a non-null, run-b null.
  - `parseArgs rejects an unknown subcommand with exit 2`.
- [ ] **Step 2: Run** `node --test tests/review-replay/baseline.test.js` — Expected: FAIL (`Cannot find module '../../tools/review-replay'`).
- [ ] **Step 3: Implement** `schema.js`, `archive.js` and the CLI skeleton with `baseline`.
- [ ] **Step 4: Run** `node --test tests/review-replay/baseline.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `git add tools/review-replay.js tools/review-replay/schema.js tools/review-replay/archive.js tests/review-replay tests/fixtures/review-replay` then `git commit -m "Add review-replay baseline over archived runs — refs #5557"`.

### Task 2: Prompt builder from the production template

**Files:**
- Create: `tools/review-replay/prompt.js`
- Test: `tests/review-replay/prompt.test.js`

**Interfaces:**
- Consumes: nothing from Task 1 but the finding shape `{ id, lens, path, line, claim, severity, kind, positions? }`.
- Produces:
  - `loadTemplate(tiebreakMdText) -> { block: string[], rest: string[] }` — throws `Error('step3-tiebreak.md: ...')` naming what is missing.
  - `disciplineLines(text) -> { readOnly: string, shell: string } | null` — the backtick-quoted line beginning `` `READ-ONLY REVIEW: `` and the one beginning `` `SHELL DISCIPLINE: `` in `text` (a composed `context/review-dispatch.md` or `subagent-dispatch-core.md`), backticks stripped; `null` when either is absent (record Decision Q1).
  - `fillFinding(block, finding, { treeRoot, base, head }) -> string[]`
  - `buildPrompt(template, findings, ctx) -> string` — `ctx = { treeRoot, base, head, discipline: { readOnly, shell } }`; one finding: the production single-finding prompt; two or more: the chunk adapter.
  - `CHUNK_HEADER_RE = /^#{1,6}\s*Finding\s+([0-9a-f]{12})\s*$/` (shared with Task 4's splitter).

Template rules: find the line `## Dispatch`, then the first ```` ``` ```` fence after it; that fence's body is the template (throw if either is missing). `block` = the lines before the first blank line followed by `Reply with exactly`; `rest` = from `Reply with exactly` to the fence end. Fill: `Finding: {` → claim; `Severity: {` (block only) → severity; `Location: {` → `{treeRoot}/{path}:{line}` (`path.join` with `treeRoot`, then the path written as the platform spells it); `Diff scope: {` → `{base}...{head}`; `Positions:` and its following `- {` lines dropped unless `finding.positions` (then one `- {claim} ({severity})` per position). In `rest`: the `[... READ-ONLY REVIEW` line → `ctx.discipline.readOnly`; `[... SHELL DISCIPLINE` → `ctx.discipline.shell` (which text supplies them — the run's bundle or the fallback — is Task 3's choice, not this module's); `SCRATCH:` and `[Use:` lines dropped. Any of Finding/Severity/Location/Diff scope/READ-ONLY/SHELL placeholders not found → throw.

Chunk adapter (until #5540 lands): mark the function with the comment `// remove when #5540 has landed and tiebreak.js exports a chunk splitter`. Prompt = `{N} findings follow, each under its own "### Finding {id}" header. Judge each one on its own: one finding being right or wrong says nothing about the next.` + a blank line + per finding `### Finding {id}` then its filled block + blank line, then `rest` with its `Reply with exactly these lines, then your status line:` line replaced by `For each finding, write its "### Finding {id}" header on its own line followed by exactly these lines; after the last finding, your one status line:` (throw if that line is absent).

- [ ] **Step 1: Write the failing tests** (the template comes from the live `plugin/skills/review/step3-tiebreak.md` read in the test, plus edited copies):
  - `single-finding prompt carries claim, severity, absolute Location and diff scope, and no SCRATCH or [Use: line`.
  - `AC5.1: editing a copy of step3-tiebreak.md changes the prompt` — append a sentence to the rules line of a copy; the built prompt contains it, the one built from the original does not.
  - `a missing ## Dispatch fence throws naming step3-tiebreak.md`.
  - `CRLF template builds the same prompt as LF` (CRLF text built from the LF text with `.replace(/\n/g, '\r\n')`).
  - `chunk prompt lists every finding under its ### Finding header in input order and keeps the rules once`.
  - `disciplineLines reads both lines from the live subagent-dispatch-core.md and returns null when either is missing` — and `buildPrompt` places the passed `ctx.discipline` lines verbatim.
- [ ] **Step 2: Run** `node --test tests/review-replay/prompt.test.js` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `prompt.js`.
- [ ] **Step 4: Run** `node --test tests/review-replay/prompt.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `git add tools/review-replay/prompt.js tests/review-replay/prompt.test.js` then `git commit -m "Build replay judge prompts from step3-tiebreak.md — refs #5557"`.

### Task 3: `extract`

**Review risk:** high

**Files:**
- Create: `tools/review-replay/extract.js`; Modify: `tools/review-replay.js` (subcommand wiring)
- Modify: `tests/review-replay/helpers.js` — the fake `git` table gains `cat-file -e {head}^{commit}` (succeeds) for `<40 hex a>` and `<40 hex c>`, and `ls-tree -r --name-only {head}` answering the file list of `tests/fixtures/review-replay/tree/` (the one run-a finding's file is absent from that tree, so it is absent from the listing too)
- Create fixture: `tests/fixtures/review-replay/tree/` (the few source files run-a/run-b findings point at; one run-a finding points at a file absent from it)
- Test: `tests/review-replay/extract.test.js`

**Interfaces:**
- Consumes: `readRun`, `matchVerdicts`, `listRuns` (Task 1); `loadTemplate`, `buildPrompt` (Task 2); schema constants.
- Produces: `extract(opts, deps) -> exit code`. Options: `--runs <root>` (required), `--out <dir>` (required, must not exist or be empty), `--select <name,...>`, `--min-runs <n>`, `--min-findings <n>`, `--quota <sev>=<n>[,<sev>=<n>...]`, `--arm ...` (at least one, repeatable), `--template <path>` (default `{pluginRoot}/skills/review/step3-tiebreak.md`), `--dispatch-core <path>` (default `{pluginRoot}/skills/_shared/subagent-dispatch-core.md`).
- Writes, only after selection succeeds: `{out}/trees/{run}/` (via `deps.writeTree(head, dir)`, then each `specFiles` entry copied to `{tree}/.claude-tweaks/pipelines/{run}/{specFile}`); `{out}/prompts/{arm}/{run}--{k}.md`; `{out}/manifest.json` = `{ schemaVersion, template: { path, sha1 }, arms: [{ name, chunk, profile, model, effort, repeat, prompts: [{ file (absolute), name, run, findingIds }] }] }`; `{out}/fixture.json` = `{ schemaVersion, requested, totals: { runs, findings, bySeverity }, counts: { fallbackMatched, verdictsWithoutFinding, findingsWithoutVerdict, failedJudgeByReason, disciplineFallbackPrompts }, excluded: [{ run, reason }], runs: [{ run, tree, head, base, findings: [{ id, lens, path, line, claim, severity, kind }], baselineTiebreak: { agents, out, cc, cr, seconds } }] }`; `{out}/archived-verdicts.json` = `{ schemaVersion, verdicts: { "{run}/{id}": verdict } }`.

Selection: runs in `--select` order, else `listRuns` order. Exclude with reason: `readRun`'s `excluded`; no findings artifact (`'no-findings-artifact'`); no head (`why[0]`); no recorded base (`'no-recorded-base'`); head not in clone (`git cat-file -e {head}^{commit}` throws → `'head-not-in-clone'`). Eligible findings: an archived verdict and the path listed by `git ls-tree -r --name-only {head}` (else counted in `excluded` as `{ run, finding, reason: 'file-absent-at-head' }`). A failed-judge finding (Task 1's `failedJudgeIds`) has no archived verdict, so it is never eligible; it is summed into `counts.failedJudgeByReason` (record Decision Q2). Discipline lines (record Decision Q1): per run, `disciplineLines(run.dispatchBundle)`; when that is `null` (no bundle, or a bundle missing either line), `disciplineLines` of `--dispatch-core`'s text, and every prompt written for that run adds one to `counts.disciplineFallbackPrompts`; `--dispatch-core` itself yielding `null` is a runtime failure (exit 1, stderr names the file). No run is excluded for this. A run with no eligible finding is excluded `'no-eligible-findings'`. Add whole runs until `--min-runs`, `--min-findings` and every quota are met. Not met after every run → print to stderr one JSON line `{ shortfall: { requested, available } }`, write nothing, exit 3. Chunks: per run, per arm, consecutive slices of `chunk` findings in `review-findings.json` order. Stdout: one JSON summary `{ totals, requested, excluded, arms: [{ name, prompts }] }`.

- [ ] **Step 1: Write the failing tests:**
  - `AC1.4: extract over the fixture archive writes trees, prompts per arm, manifest, fixture and verdicts; unreadable and review-less runs are excluded with reasons`.
  - `AC2.1/AC2.2: no prompt contains an archived verdict, an archived rationale, or the verdicts file name — one assertion each` — for each prompt: not includes `VERDICTS_FILE`; not includes any `dropped: refuted by tiebreak`/`confirmed by tiebreak`/`digested:` text; not includes the Evidence quotes or the `Step 3 Routing` rationale text from the fixture's `decisions.md`.
  - `AC10.1: a --min-findings above the eligible count reports the shortfall, exits 3 and writes no arm` — `{out}` contains nothing afterwards.
  - `AC10.2: an unmet --quota info=<n> reports the shortfall and exits 3`.
  - `a finding whose file is absent at head is excluded with file-absent-at-head` (Review Focus 4).
  - `the run's spec file is in the tree at .claude-tweaks/pipelines/{run}/work/` (Deliverable 6).
  - `prompts take the discipline lines from the run's own review-dispatch.md, and a run without one uses dispatch-core's lines and is counted` — run-a's prompts contain run-a bundle's hand-written lines and not dispatch-core's; run-b's contain dispatch-core's; `counts.disciplineFallbackPrompts` equals the number of run-b prompts across all arms; run-b is not excluded.
  - `a failed-judge finding is written to no prompt and counted under its reason` — no prompt's `findingIds` holds `aaaaaaaaaaa4`; `counts.failedJudgeByReason` equals `{ 'status:DONE': 1 }`.
  - `an unknown --arm profile exits 2`.
- [ ] **Step 2: Run** `node --test tests/review-replay/extract.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `extract.js`; default `writeTree` in `defaultDeps`: `execFileSync('git', ['archive', head, '--', '.', ':(exclude).claude-tweaks'], { maxBuffer: 1 << 30, windowsHide: true })` piped as `input` to `execFileSync('tar', ['-x', '-C', dest], { windowsHide: true })`.
- [ ] **Step 4: Run** `node --test tests/review-replay/extract.test.js tests/review-replay/baseline.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `git add tools/review-replay.js tools/review-replay/extract.js tests/review-replay/extract.test.js tests/review-replay/helpers.js tests/fixtures/review-replay/tree` then `git commit -m "Add review-replay extract with quotas and shortfall exit — refs #5557"`.

### Task 4: `score`

**Review risk:** high

**Files:**
- Create: `tools/review-replay/score.js`; Modify: `tools/review-replay.js`
- Test: `tests/review-replay/score.test.js`

**Interfaces:**
- Consumes: schema constants and `parseArmLabel` (Task 1), `CHUNK_HEADER_RE` (Task 2), `extract` output files (Task 3), `resolveTiebreak` from `plugin/bin/lib/tiebreak.js`.
- Produces: `score(opts, deps) -> exit code`; options `--out <extract dir>` (required), `--transcripts <workflow dir>` (required), `--reference <arm>` (default the manifest's first arm; unknown → exit 2). `splitChunkReply(text, ids) -> Map<id, string|null>` — adapter, marked `// remove when #5540 has landed and tiebreak.js exports a chunk splitter`. `settleReply(finding, text, treeRoot) -> { verdict: 'confirmed'|'refuted'|'cant-tell'|null, reason: string|null }` (verdict null = not judged). `agentIdentity(transcriptText) -> label|null` — the label from the first `type: 'user'` entry's message text (string `message.content`, or the concatenated `text` blocks of an array) matching `IDENTITY_RE` (`schema.js`, Task 1).

Reading results (`{transcripts}/journal.jsonl` and `{transcripts}/agent-{agentId}.jsonl`, the two files the old score script read): `started` events give the set of `agentId`s; `result` events give `agentId` → `result` (a string; anything else is no reply). Which arm, repeat and prompt an agent judged comes from `agentIdentity` over that agent's own transcript — the prompt text the workflow gave it — never from a journal field the old script did not read (the old script keyed arms on `started.phase`, which a data-driven arm list cannot use, since `meta.phases` is fixed in source). A started agent whose transcript is missing or carries no identity, or whose label `parseArmLabel` rejects, is counted in `unidentifiedAgents` (output top level) and judges nothing; its prompt's findings stay `notJudged`. Reply text: the tree root prefix (`treeRoot + '/'` and `treeRoot + path.sep`) removed everywhere before settling. `splitChunkReply`: sections start at a `CHUNK_HEADER_RE` line; the reply's last non-empty line (the status line) is appended to every section; an id with two sections, or none, maps to null. `settleReply`: `resolveTiebreak({ lens, path, line, claim, reporterSeverity: severity, kind }, text, { readFile: (p) => fs.readFileSync(path.join(treeRoot, p), 'utf8') })`; outcome `confirmed` → confirmed, `drop` → refuted; any other outcome with reason `verdict:cant-tell` or `evidence-unverified` → cant-tell; any other reason (`status:*`, `no-evidence`, `no-line`, `evidence-path-mismatch`, `bad-finding-field`, `could-not-parse`, …) → verdict null with that reason — the archived side's Decision Q2 rule applied to the replay side (spec `## Plan Review Clarifications`), counted per arm in `notJudgedByReason`. Agreement (matching the old score script's rule: replay verdict equals archived verdict; the difference — the new rule compares the settled verdict, the old one compared the judge's raw verdict — goes in the PR): per arm over every repeat × finding, in total, per archived verdict class and per finding severity; `vsReference` pairs (finding, repeat) judged in both arms. Cost per arm, per agent with that arm's label, from `{transcripts}/agent-{agentId}.jsonl`: assistant messages deduplicated by `message.id`, max of `usage.output_tokens`, `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens`; seconds from first to last `timestamp`. Output one JSON object: `{ findings, reference, counts (copied from fixture.json, so failed judges by reason and the discipline fallback count sit beside agreement), baseline: { agents, out, cc, cr, seconds }, unidentifiedAgents, arms: { [name]: { judged, notJudged, notJudgedByReason: { [reason]: n } (a missing reply, a duplicate or absent chunk section, and an unidentified agent use the reasons `no-reply`, `chunk-split` and `unidentified-agent`), cantTell, total: { agree, n }, byClass: { [class]: { agree, n } }, bySeverity: { [sev]: { agree, n } }, vsReference: { agree, n }, cost: { agents, requests, output, cacheRead, cacheCreate, seconds } } } }`. Exit 3 when any arm has `notJudged > 0`, else 0.

- [ ] **Step 1: Write the failing tests** (each test runs Task 3's `extract` over the fixture archive into a temp dir with two arms, `one` (chunk 1) and `eight` (chunk 8), then writes a journal and agent transcripts from fixed reply strings):
  - `AC3.1/AC3.2: score prints agreement in total, per verdict class and per severity, and agents and tokens per arm` — exact expected numbers written in the test (e.g. arm `one`: `total { agree: 3, n: 4 }`, the class and severity splits, `cost.output` equal to the sum of the fixed usage values), and `counts.failedJudgeByReason` equal to `{ 'status:DONE': 1 }`.
  - `AC4.1: a results file missing one judge's reply leaves that judge's findings notJudged and scores the rest` — exit 3.
  - `AC4.2: a chunk reply that names a finding id twice leaves that finding notJudged and scores the others`.
  - `a started agent with no result counts notJudged and its tokens still total` (Review Focus 5).
  - `a reply settling with reason status:BLOCKED or no-evidence is notJudged under that reason, while evidence-unverified settles as cant-tell` (spec Plan Review Clarification).
  - `an agent whose transcript carries no Replay judge identity line is counted in unidentifiedAgents and its findings stay notJudged`.
  - `a reply citing the absolute tree path settles as the repo-relative path` (Review Focus 1).
  - `the chunk adapter must go once tiebreak.js exports a chunk splitter` — `assert.ok(!Object.keys(require('../../plugin/bin/lib/tiebreak.js')).some((k) => /chunk|split/i.test(k)), 'remove the review-replay chunk adapter: #5540 has landed')`.
- [ ] **Step 2: Run** `node --test tests/review-replay/score.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `score.js`.
- [ ] **Step 4: Run** `node --test tests/review-replay/score.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `git add tools/review-replay.js tools/review-replay/score.js tests/review-replay/score.test.js` then `git commit -m "Add review-replay score settled through tiebreak.js — refs #5557"`.

### Task 5: Workflow script and round-trip schema test

**Review risk:** high

**Files:**
- Create: `tools/review-replay/replay.workflow.js`
- Test: `tests/review-replay/workflow.test.js`, `tests/review-replay/roundtrip.test.js`

**Interfaces:**
- Consumes: the manifest shape (Task 3) as Workflow `args`; `armLabel` format (Task 1).
- Produces: a workflow whose `meta` is `{ name: 'review-replay', description, phases: [{ title: 'Judges', detail: 'one agent per prompt file per repeat' }] }` and whose body, for each arm × repeat × prompt, builds `const label = \`${arm.name}|${r}|${p.name}\`` and calls `agent(\`Replay judge ${label}.\nRead ${p.file} and follow it exactly; it is your whole task.\`, { label, phase: 'Judges', model: arm.model, effort: arm.effort })` exactly once in source, run through `parallel`, returning `[{ arm, repeat, name, reply }]`. The label format must equal `armLabel`'s, and the identity line must match `IDENTITY_RE` (the workflow cannot require either; the tests pin them together). The identity line is how `score` maps an agent transcript to its arm, repeat and prompt (Task 4).

- [ ] **Step 1: Write the failing tests:**
  - `AC7.1: replay.workflow.js holds no Verdict: rule, no model name outside meta, and one agent call` — read the file, cut the `export const meta = {...}` block, assert no `/Verdict:/`, no `/\b(opus|sonnet|haiku|fable)\b/i` outside meta, exactly one `/\bagent\(/`.
  - `AC11.1: extract's manifest and a fixed reply set round-trip through score using schema.js constants` — run `extract`, assert `validateManifest(manifest)` is `[]` and every key in `MANIFEST_KEYS`/`ARM_KEYS`/`PROMPT_KEYS` is present; build the journal with labels from `armLabel`; `score` exits 0 with every finding judged.
  - `the workflow's label template matches armLabel` — extract the template literal from the source and compare against `armLabel('A', 1, 'N')` with the placeholders substituted.
  - `the workflow's identity line round-trips through agentIdentity` — extract the agent prompt template literal from the source, substitute `label = armLabel('A', 1, 'N')` and a file path, wrap it as the first user entry of a transcript, and assert `agentIdentity` returns that label.
- [ ] **Step 2: Run** `node --test tests/review-replay/workflow.test.js tests/review-replay/roundtrip.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the workflow script.
- [ ] **Step 4: Run** `node --test tests/review-replay/` — Expected: PASS.
- [ ] **Step 5: Commit** `git add tools/review-replay/replay.workflow.js tests/review-replay` then `git commit -m "Add the thin replay workflow and round-trip schema test — refs #5557"`.

### Task 6: `counterfactual`

**Files:**
- Create: `tools/review-replay/counterfactual.js`; Modify: `tools/review-replay.js`
- Create fixtures: `tests/fixtures/review-replay/transcripts/{proj}/{session}/subagents/agent-{id}.jsonl` for run-a's lens agents (one pair with findings tables, one pair where reviewer B's transcript has no table), and run-a's `timing.json` lens items naming those agent ids with ` A`/` B` sides.
- Test: `tests/review-replay/counterfactual.test.js`

**Interfaces:**
- Consumes: `readRun`, `listRuns` (Task 1).
- Produces: `counterfactual(opts, deps) -> exit code`; options `--runs <root>`, `--select`, `--transcripts <dir>` (required; indexed recursively for `agent-{id}.jsonl`). `parseFindingsTable(text) -> rows[] | null` — rows `{ sev, path, line, text }` from `| sev | path:line | text |` lines (sev in critical/high/medium/low/info, `*`/`` ` `` stripped); `null` when the last assistant text has neither a table row nor `No findings` (unreadable), `[]` for `No findings`. Output JSON: `{ runs, lensPairs, transcripts: { total, unreadable, unreadableShare }, confirmed: { total, located, byA, byB, byBoth, singleReviewerShare }, refuted: { total, byA, byB } }` where a row matches a confirmed finding on the same path within 5 lines (the old script's rule), confirmed = pair-confirmed plus tiebreak-confirmed, `singleReviewerShare = (byA + byB) / 2 / located`, and a pair with an unreadable side counts toward `transcripts.unreadable` but not toward the shares. A missing transcript file is unreadable too.

- [ ] **Step 1: Write the failing tests:**
  - `AC6.1: counterfactual over two paired reviewer transcripts reports the single-reviewer share` — exact `byA`, `byB`, `located`, `singleReviewerShare`.
  - `AC6.2: a reviewer transcript with no findings table counts as unreadable, not zero findings, and the unreadable share is reported` — `transcripts.unreadable === 1`, `unreadableShare === 0.25`.
  - `a No findings reply is a readable empty table`.
- [ ] **Step 2: Run** `node --test tests/review-replay/counterfactual.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `counterfactual.js`.
- [ ] **Step 4: Run** `node --test tests/review-replay/counterfactual.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `git add tools/review-replay.js tools/review-replay/counterfactual.js tests/review-replay/counterfactual.test.js tests/fixtures/review-replay` then `git commit -m "Add review-replay counterfactual over reviewer transcripts — refs #5557"`.

### Task 7: Plugin source scan, docs, scratch cleanup

**Files:**
- Test: `tests/review-replay/no-plugin-reference.test.js`
- Modify: `docs/plugin-structure.md` (the `tools/` line's list, and one command line beside `node tools/efficiency-report.js`)
- Delete: `tools/replay-scratch/baseline.js`
- Delete: `tools/replay-scratch/counterfactual.js`
- Delete: `tools/replay-scratch/prep-tiebreak.js`
- Delete: `tools/replay-scratch/score-tiebreak.js`
- Delete: `tools/replay-scratch/tiebreak-replay.workflow.js`
- Delete: `tools/replay-scratch/README.md`
- Keep: `review-yield.js` in that directory (#5556 deletes it and the then-empty directory)

**Interfaces:**
- Consumes: the CLI's final usage text (Tasks 1-6).

Governing skill (`.claude/skills/bin-source-scan-conformance`): a source scan needs a floor on matched sites and a go-red self-test for its matcher. Here the matcher is "file text contains `tools/review-replay`", comments included (a mention in a comment is still a naming).

- [ ] **Step 1: Write the failing test** `AC12.1: no file under plugin/ names tools/review-replay` — walk `plugin/` recursively (skip `node_modules`), read each file as utf8, collect offenders; assert offenders `[]`; floor: walked file count `>= 500`; self-test: the same `findOffenders(dir)` over a temp dir holding one file with the string returns that file.
- [ ] **Step 2: Run** `node --test tests/review-replay/no-plugin-reference.test.js` — Expected: PASS for the scan once written (nothing under `plugin/` names it); confirm the self-test goes red by temporarily making `findOffenders` return `[]`, then restore.
- [ ] **Step 3: Docs** — add to `docs/plugin-structure.md`'s `tools/` line, after `driver-merge-check-eval.js (...)`: `review-replay.js (#5557 — the review and tiebreak replay: baseline, counterfactual, extract, score over archived run directories; arms are data; prompts come from step3-tiebreak.md at run time and replies settle through plugin/bin/lib/tiebreak.js; tests in tests/review-replay/), review-replay/ (archive.js, prompt.js, extract.js, score.js, counterfactual.js, schema.js, replay.workflow.js — the Workflow script that starts one judge per prompt file)`; and a command line after the `efficiency-report.js` one: `node tools/review-replay.js baseline|counterfactual|extract|score ...   # Review/tiebreak replay (#5557, maintainer-side, not shipped) — extract --runs <root> --out <dir> --arm name=<id>,chunk=<n>,profile=<p>,repeat=<n> [--select ...] [--min-runs n] [--min-findings n] [--quota sev=n,...]; run tools/review-replay/replay.workflow.js with the manifest as args; score --out <dir> --transcripts <workflow dir> [--reference <arm>]; exit 0 ok, 1 runtime failure, 2 malformed invocation, 3 not a clean result`.
- [ ] **Step 4: Delete** the six scratch files with `git rm`.
- [ ] **Step 5: Verify AC9.1** — run `git grep -n -F 'replay-scratch' -- . ':!.claude-tweaks/pipelines' ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md'` — Expected: no output. Control (absence-grep check): the same grep without the pathspec excludes prints the spec's lines, so the pattern can match. AC9's directory half waits on #5556 (`review-yield.js` stays).
- [ ] **Step 6: Run** `node --test tests/review-replay/` — Expected: PASS.
- [ ] **Step 7: Commit** `git add tests/review-replay/no-plugin-reference.test.js docs/plugin-structure.md` then `git commit -m "Retire the scratch replay scripts for tools/review-replay — refs #5557"` (the `git rm` deletions are staged already).

## Done by the orchestrator, not a task

- **AC8** (record Decision "plan review, AC8"): a dispatched build agent has no Workflow tool, so the build does not run the live replay. After Task 7, the orchestrator files one record through `/claude-tweaks:capture` carrying: the exact commands from the final usage text (`baseline`, `extract` with a `chunk=1` arm and a `chunk=8` arm, the workflow start with the manifest as `args`, `score`); the nine review run names of the 2026-11-15 replay — `2026-11-12T104917-spec-5216`, `2026-11-13T000404-record-5269`, `2026-11-13T003948-spec-5293`, `2026-11-13T005056-spec-5297`, `2026-11-13T093429-spec-5352`, `2026-11-13T130826-spec-5366`, `2026-11-14T095442-spec-5384`, `2026-11-14T213352-spec-5454`, `2026-11-15T070437-spec-5382` (60 findings; read from the scratch run's own `manifest.json`); and the scratch numbers to compare with (52 of 60 agreement for the chunked judge; 63 agents and 2.83M cache-creation tokens archived against 10 agents and 0.63M in the replay; model `opus`, effort `high`, 2026-11-15), plus what that run's PR must state (the usage field `score` reads, the `step3-tiebreak.md` revision against the reviews' date range). AC8 is met when that record exists; the PR names it.
Waived AC8.1: met by the capture record above, per the record's Decision — no Workflow tool in a dispatched build.
Waived AC8.2: carried by the capture record's comparison numbers.
Waived AC8.3: carried by the capture record.
Waived AC8.4: carried by the capture record.
Waived AC8.5: carried by the capture record; the usage field (`message.usage` of each `agent-{id}.jsonl` assistant message, deduplicated by `message.id`) is also stated in the PR from the code.
Waived AC8.6: a statement about AC8's nature, not a testable clause.
- **Decision rule** (record, author 2026-11-16): every reading the build takes where the record leaves a choice is stated in the PR body. Known now: the agreement rule compares the settled verdict (the scratch rule compared the judge's raw verdict); `status:DONE` digests count as failed judges under Decision Q2's "any other reason".
Waived AC9.2: the scratch scripts are on `main` at build (checked: `tools/replay-scratch/` exists in this checkout), so the deletion runs and this branch of AC9 does not apply.
Waived tools/driver-merge-check-eval.js: read only, as the seam and exit-code model.
Waived tools/replay-scratch/score-tiebreak.js: read for its agreement rule (Task 4 matches it) and deleted in Task 7.
Waived tools/replay-scratch/baseline.js: read for its cost source and deleted in Task 7.
Waived tools/replay-scratch/counterfactual.js: read for its matching rule and deleted in Task 7.
Waived tools/replay-scratch/prep-tiebreak.js: read and deleted in Task 7.
Waived tools/replay-scratch/tiebreak-replay.workflow.js: read and deleted in Task 7.
Waived tools/replay-scratch/README.md: deleted in Task 7.
Waived plugin/skills/review/step3-tiebreak.md: read at run time by Task 2; never edited.
Waived plugin/bin/lib/tiebreak.js: required by Task 4; never edited.
Waived tests/review-tiebreak-step-conformance.test.js: not touched; the Windows rule it warns about is applied through Task 2's CRLF test.

- Deliverable 9's comments on #5540 and #5541 naming the commands for their arms are posted by the orchestrator after Task 7, from the final usage text.
