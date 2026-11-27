# `/claude-tweaks:design` (steps 1-7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/claude-tweaks:design {topic or issue}` — a resumable, file-backed design session (evidence → frame → storyboard → perspectives → alternatives → pre-mortem → builder check) whose readers run on the top tier through #6351's `--exception design-reader`.

**Architecture:** A small read-mostly helper CLI, `plugin/bin/design-session.js` over `plugin/bin/lib/design-session/`, owns every mechanical decision the record's acceptance criteria turn on — folder slug and match, which step to resume at, the outcome gate on notes, the four-round cap, the evidence source check, and composing each reader's brief from files only (so a brief cannot carry conversation). The skill (`plugin/skills/design/SKILL.md` plus one lazy-loaded sub-file per step and `reader-briefs.md`) carries the judgment and the conversation, and calls the CLI at each gate. Registration follows the house sites; `CLAUDE.md` edits replace words, never add lines.

**Tech Stack:** Node 18+ CommonJS, no dependencies; `node --test`; markdown skill files.

**Spec:** `.claude-tweaks/pipelines/2026-11-27T180207-record-6352/work/6352-spec.md` (record #6352). Read it in full before any task.

**Scope keywords:** design-session, /claude-tweaks:design

## Global Constraints

- The session folder is `docs/superpowers/specs/{date}-{topic}/` holding `evidence.md`, `design.md`, `storyboard.*`, `notes-round-N.md`; on start the skill reads the folder and continues at the first step whose file is missing or unfinished (spec Deliverables).
- Readers: "five fresh readers, each given only the frame and the storyboard: the person using it, the smallest version that would do, which part owns what, the token cost, how it gets introduced"; steps 3 and 4 "repeat until a round has no serious note, at most four rounds" (spec).
- Top tier: every reader resolves with `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" frontier --exception design-reader --session-dir "{design folder}"`; exit 3 prints only `{"stepDown":{"reason":"…"}}` and "the calling skill stops and asks the maintainer, and never lowers the tier itself"; exit 1 is a refusal (`plugin/skills/_shared/frontier-exception.md`). Step 1's searchers are the one exception: `resolve-profile.js fast`.
- The session itself: compare the session's own model with the `model` field `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" frontier` prints; when lower, say so before step 2 and the maintainer decides (spec).
- "Every question comes with a recommended answer and its reason. Open questions about what the maintainer wants are asked openly, one at a time. Every decision is appended to a dated list in `design.md` with who made it" (spec).
- The skill never writes outside its folder, never creates an issue, never commits, never starts building; after step 7 it names `/claude-tweaks:specify {design.md path}` (spec, Gotchas).
- `CLAUDE.md` is at 150/150 lines (`tests/direct-test-run-guard.test.js` AC13.1) and 24,497/24,576 bytes (`tests/claude-md-budget.test.js`): a registration there replaces words, it does not add lines (spec Gotchas).
- A skill reference inside a step body is the fully-qualified `/claude-tweaks:{skill}` form (CLAUDE.md Cross-references).
- Every `plugin/skills/**/*.md` file stays under `RAIL_BYTES` (52,500 B) and `RAIL_LINES` (2,000); `description` ≤ 1,536 chars and must tell `/claude-tweaks:design` apart from `/claude-tweaks:design-wrapper` (spec Gotchas; `docs/skill-authoring.md` Frontmatter conventions).
- Scope and edit discipline, verbatim: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Working directory: every command runs as `git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow-record-6352" …` or with absolute paths, one plain command per Bash call, never a `cd … &&` chain.

**Governing project skills (quoted verbatim; read each named file in full before its task):**

- `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` governs `plugin/bin/design-session.js` (Tasks 1-4): "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes." / "It exports `run` and `realDeps`; `argv` is `process.argv.slice(2)`, and `run` returns an integer exit code or a Promise of one. The script entry is the file's last statement: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`." / "A relative path is resolved against `deps.cwd()`, never left to `path.resolve` or `fs`" / "Tests call the CLI through `tests/helpers/run-cli.js` (`runCli`, or `runCliSync` for a synchronous `run`), passing an absolute `cliPath`" / "each converted CLI keeps one or two `spawnCli` smoke tests for the script entry, shebang and exit code."
- `.claude/skills/skill-prose-conformance-tests/SKILL.md` governs `tests/design-skill-conformance.test.js` (Task 6): "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`." / "Slice with `tests/helpers/conformance-asserts.js`'s `sectionOf(text, '## Heading')` and `lineStartingWith(text, prefix)` instead of writing another local copy" / "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message**" / "When the prose tells the reader to run a CLI, pin the whole call line including each argument's value, not the command and flag alone." / "Also check each `--flag` in the pinned line against the CLI's own `--help` usage, with a go-red that renames one flag."
- Its sub-file `mirrored-and-dispatched-prose-pins.md` governs the reader briefs: "(1) assert the inlinable body is a strict, non-empty subset of the whole file … and (2) sweep that same body for a closed list of forbidden self-references — `SKILL.md`, `_shared/`, `Step {N}`, `above`/`below`, and the file's own name … A third, narrower check — fenced-code-block balance".
- No other `.claude/skills/` skill names a file this plan touches (searched by file and module name).

## Review Focus

1. A topic whose slug collides with an older session of a different topic sharing the same words — the helper matches only `YYYY-MM-DD-{slug}` exactly, newest first, never a prefix (Task 1 test `slug match is exact, not prefix`).
2. A `design.md` hand-edited by the maintainer between sessions (a section reordered, a status line with extra spaces or lowercase) — status parsing is tolerant of whitespace and case on `Status:` but never infers `done` from content (Task 2 test `status line is whitespace- and case-tolerant`).
3. A reader that returns `NO NOTES` or a malformed reply — the round still closes only when every perspective is recorded; a malformed reply is re-prompted once per the contract, then recorded as a note `minor` with outcome required (Task 4 prose; Task 6 pin).
4. A step-down partway through a round's resolutions — no reader is dispatched until all five resolutions returned exit 0 (Task 4 prose; Task 6 ordering pin).
5. Resume after the fourth round closed with serious notes — the helper reports `cap-reached`, never `start-round` 5 (Task 2 test `round cap`).

---

### Task 1: Slug, folder match and evidence check (`lib/design-session`)

**Role:** integration

**Files:**
- Create: `plugin/bin/lib/design-session/folder.js`
- Create: `plugin/bin/lib/design-session/evidence.js`
- Test: `tests/bin-lib/design-session/folder.test.js`
- Test: `tests/bin-lib/design-session/evidence.test.js`

**Interfaces:**
- Produces: `slugFor(input: string) -> string` (throws `Error('empty topic')` on an input with no `[a-z0-9]` after normalizing); `findFolder({ specsDir: string, slug: string, today: string /* YYYY-MM-DD */ }, fsImpl = fs) -> { folder: string, existing: boolean }`; `checkEvidence(text: string) -> { done: boolean, unsourced: number[] /* 1-based line numbers */ }`; `SOURCE_RE` (exported).

- [ ] **Step 1: Write the failing tests** — `folder.test.js`: `slugFor('#6352') === 'issue-6352'`; `slugFor('6352') === 'issue-6352'`; `slugFor('  Ordering: Café & Tea!  ') === 'ordering-cafe-tea'`; a 120-char topic yields ≤ 50 chars and never ends in `-` or mid-word (cut back to the last `-` when the cut lands inside a word); `slugFor('!!!')` throws `/empty topic/`; `findFolder` over a temp dir holding `2026-11-01-ordering`, `2026-11-20-ordering`, `2026-11-20-ordering-v2` and a file `2026-11-25-ordering` returns `{folder: …/2026-11-20-ordering, existing: true}` (test name `slug match is exact, not prefix`); an empty dir returns `{folder: {specsDir}/{today}-{slug}, existing: false}` and creates nothing. `evidence.test.js`: a file whose first line after the H1 is `Status: done` and whose every `- ` bullet carries ` — source: ` plus a source matching `SOURCE_RE` gives `{done: true, unsourced: []}` (name `AC1.1: every evidence line names a source`); one bullet without a source, or with `source: somewhere`, is reported by line number; `Status: in-progress` gives `done: false`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/design-session/folder.test.js tests/bin-lib/design-session/evidence.test.js` — Expected: FAIL (`Cannot find module`).
- [ ] **Step 3: Implement.** `slugFor`: `#N`/`N` → `issue-N`; else NFKD, strip combining marks, lowercase, `[^a-z0-9]+` → `-`, trim `-`, cap 50 at a word boundary. `findFolder`: directories only, `^\d{4}-\d{2}-\d{2}-{escaped slug}$`, lexicographic max. `SOURCE_RE` accepts exactly: an issue/PR ref `#\d+`, a commit sha `[0-9a-f]{7,40}`, a `path:line` (`\S+\.\w+:\d+`), a run folder `.claude-tweaks/pipelines/\S+`; several sources may be joined by `, `. Status line: the first non-blank line after the H1, `/^status:\s*(done|in-progress)\s*$/i`.
- [ ] **Step 4: Run the same command** — Expected: PASS.
- [ ] **Step 5: Commit** `git add` the four files; message `Add design-session folder and evidence helpers — slug, folder match, source check (refs #6352)`.

### Task 2: Step status and resume (`lib/design-session/status.js`, `notes.js`)

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/design-session/notes.js`
- Create: `plugin/bin/lib/design-session/status.js`
- Test: `tests/bin-lib/design-session/notes.test.js`
- Test: `tests/bin-lib/design-session/status.test.js`

**Interfaces:**
- Consumes: `checkEvidence` (Task 1).
- Produces: `MAX_ROUNDS = 4`; `PERSPECTIVES = ['user', 'smallest', 'ownership', 'token-cost', 'introduction']`; `OUTCOMES = ['changed', 'declined', 'accepted-risk']`; `parseNotes(text) -> { done: boolean, notes: [{ id: 'R.i', perspective, severity: 'serious'|'minor', outcome: 'changed'|'declined'|'accepted-risk'|null }], perspectivesRecorded: string[] }`; `checkNotes(text) -> { ok: boolean, pending: string[], serious: string[], missingPerspectives: string[] }`; `sectionStatus(designText, heading) -> 'done'|'partial'|'missing'`; `readStatus(folder, fsImpl = fs) -> { steps: {1..7: 'done'|'partial'|'missing'}, resumeAt: 1..7|'complete', round: number|null, action: 'start'|'continue'|'start-round'|'finish-round'|'revise-storyboard'|'cap-reached'|'close-perspectives'|null, openSerious: string[] }`.

The file formats this task fixes (the skill and `reader-briefs.md` in Task 3 write exactly these):

```
design.md sections, in order — each heading's first non-blank line is `Status: done` or `Status: in-progress`:
## Frame                (step 2)
## Storyboard           (step 3; also carries `Round: N` and `File: storyboard.{ext}`)
## Perspectives         (step 4; `done` only when the loop is closed)
## Approaches           (step 5)
## Pre-mortem           (step 6)
## Builder check        (step 7)
## Decisions            (not a step: `- YYYY-MM-DD — {decision} — by: maintainer|model`)

notes-round-N.md:
# Perspective notes — round N
Status: in-progress|done
## N.i — {perspective} — serious|minor
{note text}
Outcome: pending | changed — {what changed} | declined — {why} | accepted-risk — {the risk, named}
(a perspective that returned NO NOTES is recorded as `## N.i — {perspective} — none` with no Outcome line)
```

Step rules for `readStatus`: step 1 is `done` when `evidence.md` exists and `checkEvidence(...).done && unsourced.length === 0`, `partial` when it exists otherwise. Steps 2, 5, 6, 7 read `sectionStatus`. Step 3 is `done` when its section is `done` and the `File:` it names exists in the folder. Step 4 is `done` when `## Perspectives` is `done`. `resumeAt` is the first step not `done`, except the 3↔4 loop: with R the highest `notes-round-R.md` — none and step 3 not done → `{resumeAt: 3, round: 1, action: 'start'}`; none and step 3 done → `{4, 1, 'start-round'}`; R exists and `checkNotes` not ok or file not `done` → `{4, R, 'finish-round'}`; R done with serious notes and R < MAX_ROUNDS → storyboard `Round:` > R and step 3 done ? `{4, R+1, 'start-round'}` : `{3, R+1, 'revise-storyboard'}`; R done with serious notes and R === MAX_ROUNDS → `{4, 4, 'cap-reached', openSerious}`; R done with no serious note → `{4, R, 'close-perspectives'}`. A `partial` step otherwise gives `action: 'continue'`; a `missing` one `'start'`.

- [ ] **Step 1: Write the failing tests** — `notes.test.js`: parses all three outcomes, `pending`, a missing Outcome line (→ `null`), and `none`; `checkNotes` names `pending` ids and `missingPerspectives` (`AC3.1: a note with no outcome blocks the next round or step`). `status.test.js`, each over a temp folder built in the test: `AC6.1: evidence and frame present resumes at step 3 and repeats nothing` (expects `{resumeAt: 3, round: 1, action: 'start'}` and `steps[1] === steps[2] === 'done'`); `half-written section resumes that step` (`## Approaches` `Status: in-progress` → `{resumeAt: 5, action: 'continue'}`); `resumes at step 6` and `resumes at step 7` (prior sections done); `complete session` → `'complete'`; `round cap` (`AC4.1: a fifth round is never started` — round 4 done with a serious note → `cap-reached`, `openSerious` lists it, never `round: 5`); `cap reached, then continued` (the same folder with `## Perspectives` `Status: done` → `resumeAt: 5`); `revise-storyboard` vs `start-round` by storyboard `Round:`; `status line is whitespace- and case-tolerant` (`  status:   DONE ` reads `done`; a section with no status line reads `partial`).
- [ ] **Step 2: Run** `node --test tests/bin-lib/design-session/notes.test.js tests/bin-lib/design-session/status.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the signatures above in `notes.js` and `status.js`; `sectionStatus` slices from the `## {heading}` line to the next `## ` line.
- [ ] **Step 4: Run the same command** — Expected: PASS.
- [ ] **Step 5: Commit** — message `Add design-session status reader — resume point, notes outcome gate, four-round cap (refs #6352)`.

### Task 3: The skill files

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/skills/design/SKILL.md`
- Create: `plugin/skills/design/step-1-evidence.md`, `step-2-frame.md`, `step-3-storyboard.md`, `step-4-perspectives.md`, `step-5-alternatives.md`, `step-6-pre-mortem.md`, `step-7-builder-check.md`
- Create: `plugin/skills/design/reader-briefs.md`

**Interfaces:**
- Consumes: the file formats and vocabulary fixed in Task 2 (headings, `Status:` lines, notes format, `PERSPECTIVES`, `OUTCOMES`, `MAX_ROUNDS`); the CLI surface of Task 4 (write prose against it exactly): `node "${CLAUDE_PLUGIN_ROOT}/bin/design-session.js" folder --topic "{topic}" --root "{repo root}" [--create]`, `… status --folder "{folder}"`, `… check-evidence --folder "{folder}"`, `… check-notes --folder "{folder}" --round {N}`, `… brief --folder "{folder}" --reader {user|smallest|ownership|token-cost|introduction|pre-mortem|builder} [--round {N}]`. Exit 0 ok, 1 refusal (stdout JSON names why), 2 usage/IO error.
- Produces: `reader-briefs.md` blocks delimited `<!-- brief:{name}:start -->` / `<!-- brief:{name}:end -->` for names `perspective-common`, `user`, `smallest`, `ownership`, `token-cost`, `introduction`, `perspective-output`, `pre-mortem`, `builder` — Task 4's `brief` reads them by these names.

Read first: `docs/skill-authoring.md` (SKILL.md structure, Frontmatter conventions, Interaction patterns, Parallel execution directives, Model-version prompting notes); `plugin/skills/_shared/subagent-output-contract.md` (Input Discipline, Implementer Status Protocol, "Not every consumer uses A/B/C"); `plugin/skills/_shared/subagent-dispatch-core.md` §Model Selection; `plugin/skills/_shared/frontier-exception.md`; `plugin/skills/research/source-registry.md` §Dispatch and `plugin/skills/specify/red-team.md` as the nearest fan-out examples; `plugin/skills/_shared/worktree-setup.md` §Adopt-or-create.

SKILL.md content (structure per `docs/skill-authoring.md`; no interaction-style line, no Relationship section):
- Frontmatter: `name: design`; `description` — a "Use when …" trigger: starting the design of anything that will be an order (a parent with parts), run as a session with the maintainer; disambiguate from `/claude-tweaks:design-wrapper` (Impeccable visual-design commands) and from `/superpowers:brainstorming` (single small fix); Keywords line. `argument-hint: "<topic|#N>"`. Keep it under 400 chars.
- `## When to Use` / when not (a single small fix → `/claude-tweaks:specify` via brainstorming; visual polish → design-wrapper).
- `## Input` — `$ARGUMENTS` is a topic or an issue ref; an optional repository named at start.
- `## Session folder and resume` — the repository is the current checkout unless the maintainer names another at start. The skill never creates a worktree or a branch (spec `## Planning Decisions`): before the first write, when `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values worktree-always` prints `true` and the session is in the main checkout (not a linked worktree: `git rev-parse --git-dir` equals `git rev-parse --git-common-dir`), stop and tell the maintainer to start the session inside a worktree (`/superpowers:using-git-worktrees`) and run `/claude-tweaks:design {topic}` again — the gate would refuse the write. Then `folder --create` and `status`; continue at `resumeAt`/`action`, loading only that step's sub-file. `resumeAt: 'complete'` → say the session is finished and render `## Next Actions`; nothing is rewritten. Say plainly that the folder is uncommitted until the maintainer commits it, and that a later session resumes it only from the same checkout.
- `## Model` — at start, before step 2: compare the session model with `resolve-profile.js frontier`'s `model`; lower → say so and ask (one `AskUserQuestion`, recommended "switch to the top tier and resume"). Readers: resolve every reader of a dispatch group first, one exception call each — and only for readers not yet recorded (a resumed round resolves only the perspectives `check-notes` lists in `missingPerspectives`, since every resolution counts against the 22-per-session limit whether or not its reader ran); only when all exit 0 dispatch the group in one message, each `Agent` call's `model` = the printed `model` and `effort` = `launchEffort` when non-null, the `effortLine` appended to the brief. Any exit 3 → stop before any reader of that round is started, show the `stepDown.reason` (for `limit`, also the count already used: the line count of `{folder}/frontier-exception-tally.log`, out of 22), ask; never lower the tier. Exit 1 → stop and show stderr. A credit/usage-exhaustion failure → `resolve-profile.js record-failure {model}` then stop and ask.
- `## How it asks` — the spec's three rules (Global Constraints) plus: decisions go to `## Decisions` as `- YYYY-MM-DD — {decision} — by: maintainer|model`.
- `## Steps` — a 7-row table: step, sub-file, the artifact it leaves, its completion marker.
- `## Next Actions` — after step 7: `**/claude-tweaks:specify {design.md path}** — shape the design into records (recommended)`; plus a resume line `/claude-tweaks:design {topic}`.
- `## Component-Skill Contract` — standalone, human-present; contains the literal phrase `no \`PIPELINE_RUN_DIR\` signal` (Task 5 adds the exemption); never invoked by a pipeline.
- `## Anti-Patterns` — at least: proposing before `evidence.md` is shown; lowering a reader's tier on a step-down; starting a fifth round; passing conversation to a reader; writing outside the folder, creating a worktree or branch, creating an issue, committing, or starting to build.

Sub-files (each opens with one line naming what loads it; every skill reference fully qualified):
- `step-1-evidence.md` — Form B parallel searchers, `[Use: Fast]` resolved by `resolve-profile.js fast`, one per area: issues open and closed (`gh issue list --search`), merges of the last six weeks (`git log --merges --since`), run data (`.claude-tweaks/pipelines/*/decisions.md`), the code, earlier designs (`docs/superpowers/specs/`), the settings file and schema (`.claude-tweaks/policy.yml`, `plugin/bin/lib/policy-schema.js`) for a feature built but switched off. Inline a define-in-prompt template: `CLAIM: … / SOURCE: {#N | sha | path:line | run folder}` lines then the `STATUS:` line; read-only, no git writes. The main thread writes `evidence.md` (H1, `Status:` line, one `- {claim} — source: {source}` bullet per claim), runs `check-evidence` until exit 0, then shows it; nothing is proposed before.
- `step-2-frame.md` — with the maintainer: problem, why now, goals, non-goals, anti-goals, the one measure and its duration or "not measurable"; writes `## Frame`.
- `step-3-storyboard.md` — the cheapest picture in the form its kind needs (screen sketches through `/claude-tweaks:design-wrapper shape`, output written or copied into the folder; example calls with answers; sample rows before/after; a typed-out session; a one-page local HTML picture for a system); writes `storyboard.{ext}` and `## Storyboard` with `Round:` and `File:`.
- `step-4-perspectives.md` — per round: `brief` for each perspective not yet recorded (exit 1 → stop and show why), resolve them all, dispatch in one message, re-prompt a malformed reply once per the contract; a reply still malformed after that is recorded as one `minor` note for that perspective whose text says the reader's reply was unusable (it needs an outcome like any other); transcribe every note into `notes-round-N.md` with `Outcome: pending`, take each note's outcome from the maintainer, run `check-notes` until exit 0, mark the round `done`. Then follow `status`: `revise-storyboard` → step 3; `cap-reached` → list `openSerious` and ask (continue to step 5, or stop) — on continue, mark `## Perspectives` `Status: done` and append the choice, naming the open serious notes, to `## Decisions` (`by: maintainer`); `close-perspectives` → mark `## Perspectives` done.
- `step-5-alternatives.md` — two or three real ways with what each gives up; the maintainer chooses; writes `## Approaches`.
- `step-6-pre-mortem.md` — one reader (`brief --reader pre-mortem`); each answer becomes a design change or a risk the maintainer accepts by name; writes `## Pre-mortem`.
- `step-7-builder-check.md` — one reader (`brief --reader builder`, which drops `## Decisions`); answers already in the conversation go into the document, small ones are settled and marked `by: model`, the rest go to the maintainer in one message; writes `## Builder check`; then Next Actions.
- `reader-briefs.md` — a meta lead (not sent), then the named blocks. `perspective-common`: role ("a fresh reader; you see only the frame and storyboard below"), read-only. One block per perspective with its question. `perspective-output`: `OUTPUT FORMAT (required)` — `NOTE: serious | minor` / `WHERE:` / `NOTE-TEXT:` / `WHY:` repeated (at most 6), or `NO NOTES`; the rubric (serious = would make the design wrong, unbuildable or not worth it if shipped as is; minor = improves it, safe to ship without); the trailing `STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED` line as the last non-empty line. `pre-mortem`: the question "it is three months later and this failed; why?" and `FAILURE:` / `LIKELIHOOD: high | medium | low` / `EVIDENCE:` blocks. `builder`: "plan the build from this document alone; report only what you would have to guess" and `GUESS:` / `WHERE:` / `NEEDED-BECAUSE:` blocks. Blocks must name no `SKILL.md`, `_shared/`, `Step {N}`, `above`/`below`, or `reader-briefs.md`, and keep fences balanced.

- [ ] **Step 1: Write the files** per the content above.
- [ ] **Step 2: Run** `node --test tests/skill-conventions.test.js tests/bin-lib/skill-audit/house-structure.test.js tests/bin-lib/skill-audit/anti-patterns.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/bin-lib/skill-audit/option-description.test.js tests/argument-hint-input.test.js` — Expected: PASS (catalog, graph, csc and mirror suites go green in Task 5).
- [ ] **Step 3: Commit** — message `Add /claude-tweaks:design skill files — seven step sub-files and reader briefs (refs #6352)`.

### Task 4: Brief composer and the `design-session.js` CLI

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/design-session/brief.js`
- Create: `plugin/bin/design-session.js`
- Test: `tests/bin-lib/design-session/brief.test.js`
- Test: `tests/bin-lib/design-session/cli.test.js`

**Interfaces:**
- Consumes: Tasks 1-2 exports; Task 3's `reader-briefs.md` block names.
- Produces: `readBlocks(briefsText) -> Map<name, text>` (throws on a missing or unbalanced marker); `composeBrief({ folder, reader, round, briefsText }, fsImpl = fs) -> { ok: true, text } | { ok: false, reason: 'round-cap'|'pending-outcomes'|'no-frame'|'no-storyboard'|'unknown-reader', detail }`; the CLI of Task 3's Interfaces, with `run(argv, deps)` / `realDeps` per the CLI wrapper contract; `--help` prints the usage with every flag.

Brief rules: a perspective brief = `perspective-common` + that perspective's block + `## Frame` section body + the storyboard (inline when its extension is `.md`, `.txt` or `.html`, else its absolute path and "Read this file") + `perspective-output`. Refuse `round > MAX_ROUNDS` (`round-cap`) and a round R whose `notes-round-(R-1).md` fails `checkNotes` (`pending-outcomes`). `pre-mortem` and `builder` briefs = their block + `design.md` with the `## Decisions` section removed; both refuse while the last notes round has a pending outcome. Nothing but these files reaches the text.

- [ ] **Step 1: Write the failing tests** — `brief.test.js` over a temp folder plus the live `reader-briefs.md` read via `readText`: `AC2.1: a perspective brief holds the frame, the storyboard and the note template, and nothing else` (the composed text equals the exact concatenation of the four pieces — so no other input can be present; then a sentinel string placed in a `## Decisions` entry and in `evidence.md` is absent); `builder brief drops the decisions list`; `AC4.1: brief refuses round 5` (`reason: 'round-cap'`); `AC3.2: brief refuses while a note has no outcome`; a missing marker in a mutated briefs text throws. `cli.test.js` via `runCliSync`: every subcommand's exit 0/1/2 and JSON; `check-notes` exits 1 naming pending ids; `status` prints `readStatus`'s object; `--help` lists `--topic`, `--root`, `--create`, `--folder`, `--round`, `--reader`; one `spawnCli` smoke test.
- [ ] **Step 2: Run** `node --test tests/bin-lib/design-session/brief.test.js tests/bin-lib/design-session/cli.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `brief.js` and `design-session.js` (resolve the skill's `reader-briefs.md` as `path.join(__dirname, '..', 'skills', 'design', 'reader-briefs.md')`; `--folder` and `--root` relative to `deps.cwd()`).
- [ ] **Step 4: Run** the two files, then `node --test tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — message `Add design-session CLI — reader briefs composed from session files only (refs #6352)`.

### Task 5: Registration

**Role:** integration

**Files:**
- Modify: `docs/skill-graph.md` (new `## design` section between `## demo` and `## design-wrapper`)
- Modify: `plugin/skills/help/context-flow.md` (a `| \`/design\` |` row in `| Skill | Reads | Writes | Deletes |`)
- Modify: `plugin/skills/help/reference-card.md` (a row in `## Component` after `/claude-tweaks:research`; a `## Common Workflows` entry; `## Artifact Lifecycle` row)
- Modify: `plugin/skills/help/SKILL.md` (only if its Brainstorming item names the entry for an order — check, and add the one line there if so)
- Modify: `README.md` (`## Skills` paragraph's component list; `## Common workflows` if it names the order entry)
- Modify: `docs/getting-started.md` (`### Plan phase` paragraph `**\`/claude-tweaks:design\`** — …`)
- Modify: `docs/plugin-structure.md` (`**Component:**` list; `### Skills with sub-files` row; `## Commands` entry for `plugin/bin/design-session.js`)
- Modify: `CLAUDE.md` (Subagent Contract "Used by" list gains `/design` (reader fan-out, define-in-prompt note template, `plugin/skills/design/reader-briefs.md`); the `claude-tweaks Pipeline` **Entry point** line names `/claude-tweaks:design` as the entry for an order and `/claude-tweaks:specify` for the rest — both within 150 lines and 24,576 bytes, by tightening words in the same paragraphs)
- Modify: `tests/bin-lib/skill-audit/csc-registry.test.js` (`design: /no \`PIPELINE_RUN_DIR\` signal/,` in `PIPELINE_RUN_DIR_EXEMPT`, alphabetical)
- `plugin/bin/lib/skill-audit/skill-catalog.js`: no change — the catalog is directory-derived (`listSkillDirs`); record this in the commit message.

The reference-card `Takes` cell is byte-identical to the frontmatter `argument-hint` (`` `<topic\|#N>` `` form per the card's escaping). Skill-graph edges (state each once, `| Target | Relationship |`): `/claude-tweaks:specify` (the design ends by naming it; specify accepts `design.md`), `/claude-tweaks:design-wrapper` (step 3 invokes `shape`), `/superpowers:brainstorming` (still the route for a single small fix), `/help`, `_shared/frontier-exception.md` (the readers' only tier source; update its row's "once that skill exists" clause to name `plugin/skills/design/step-4-perspectives.md`). Mirror surfaces for the hint: the `### Argument-hint mirror surfaces` table in `docs/skill-authoring.md` — walk it, and grep `README.md docs/ plugin/skills/help/` for `design-wrapper` to find prose that should also name the new skill.

- [ ] **Step 1: Make the edits.**
- [ ] **Step 2: Run** `node --test tests/skill-catalog-completeness.test.js tests/argument-hint-mirrors.test.js tests/bin-lib/skill-audit/csc-registry.test.js tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js tests/claude-md-budget.test.js tests/direct-test-run-guard.test.js tests/subagent-contract-clauses.test.js` — Expected: PASS.
- [ ] **Step 3: Commit** — message `Register /claude-tweaks:design — skill graph, help, README, getting started, plugin structure, CLAUDE.md (refs #6352)`.

### Task 6: Dispatch-prose conformance test

**Role:** integration

**Files:**
- Test: `tests/design-skill-conformance.test.js`

**Interfaces:**
- Consumes: Task 3's files; Task 4's `readBlocks` and CLI `--help`.

Assertions (each its own `test`, each with a message-matched go-red control on a mutated in-memory copy, via `missingFactsOf`/`assertEachPatternGoesRed` where a region states several facts):
- `AC2.1: every reader block is self-contained` — each `reader-briefs.md` block is a strict non-empty subset of the file; none names `SKILL.md`, `_shared/`, `Step {N}`, `above`, `below`, `reader-briefs.md`; fences balanced; `perspective-output` carries `NOTE: serious | minor`, the rubric's two definitions, and `STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED` as its last line.
- `AC2.1: readers get the brief CLI's output and nothing from the conversation` — `step-4-perspectives.md`, `step-6-pre-mortem.md`, `step-7-builder-check.md` each pin the full `brief` call line with its arguments and state that the brief is the whole prompt.
- `AC5.1: a step-down stops before any reader of the round starts` — in `SKILL.md` `## Model`, the full exception call line (`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" frontier --exception design-reader --session-dir "{design folder}"`) precedes the dispatch sentence (`indexOf` order, proven by splicing the dispatch sentence above it), and the exit-3 clause says stop and ask and never lower the tier.
- `AC4.2: after the fourth round the skill lists open serious notes and asks` — pinned in `step-4-perspectives.md` against `cap-reached`, with the continue path's `## Perspectives` done marking and its `## Decisions` entry.
- `a malformed reply is re-prompted once, then recorded as a minor note` — pinned in `step-4-perspectives.md`.
- `a resumed round resolves only unrecorded perspectives` — `SKILL.md` `## Model` names `missingPerspectives`.
- `the skill never creates a worktree` — over the code regions of every `plugin/skills/design/*.md`, no `EnterWorktree` call, `git worktree add` or `git branch`; and `SKILL.md` `## Session folder and resume` pins the `worktree-always` stop.
- `AC3.2: the skill refuses to go on while a note has no outcome` — `check-notes` call line pinned with `--round`.
- `AC1.1: evidence is shown before anything is proposed` — `step-1-evidence.md` pins `check-evidence` before the show-the-file sentence.
- `AC8.1: no write outside the folder, no issue, no commit` — over the code regions (fences and inline spans) of every `plugin/skills/design/*.md`, no `gh issue create`, `git commit`, `/claude-tweaks:capture`; the extraction is non-empty.
- `every --flag in a pinned call line is one the CLI accepts` — each flag of the pinned `design-session.js` and `resolve-profile.js` lines appears in that CLI's usage (`design-session.js --help`; `resolve-profile.js`'s header usage), with a go-red that renames one flag.
- `skill references in step bodies are fully qualified` — no bare `` `/specify` ``/`` `/design-wrapper` `` outside the skill-graph-style prose; pinned by a regex over the sub-files.

- [ ] **Step 1: Write the test.** Read prose with `readText`, slice with `sectionOf`.
- [ ] **Step 2: Run** `node --test tests/design-skill-conformance.test.js` — Expected: PASS; then temporarily confirm each control fails for its own message (the controls are in the file, so a passing run already proves them).
- [ ] **Step 3: Commit** — message `Pin /claude-tweaks:design dispatch prose — self-contained briefs, step-down order, round cap (refs #6352)`.

### Task 7: Captured prompt and full suite

**Role:** integration

**Files:** none committed (evidence goes to the run directory).

- [ ] **Step 1: Capture one reader prompt (AC2.2).** Build a scratch session folder under the session scratchpad with a `## Frame` and `storyboard.md`, then run `node plugin/bin/design-session.js brief --folder "{scratch folder}" --reader user --round 1` and write its stdout to `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-27T180207-record-6352/evidence/captured-reader-prompt.txt` (create `evidence/` first with `mkdir -p`). Log one `AC evidence` entry: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}"`, the text naming AC2.2, the command, and the file path. The PR body quotes the file at Common Step 7.
- [ ] **Step 2: Run** `npm test -- --full > "{run dir}/evidence/full-suite.txt" 2>&1` — Expected: exit 0 (`AC7.1: npm test -- --full passes, including the skill conventions, house structure and skill-graph suites`). Re-run any failing file alone before concluding a regression.

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 1 `evidence.test.js`; Task 6 |
| AC2.1 | Task 4 `brief.test.js`; Task 6 |
| AC2.2 | Task 7 Step 1 |
| AC3.1 | Task 2 `notes.test.js` |
| AC3.2 | Task 4 `brief.test.js`; Task 6 |
| AC4.1 | Task 2 `status.test.js`; Task 4 |
| AC4.2 | Task 6 |
| AC5.1 | Task 6 |
| AC6.1 | Task 2 `status.test.js` |
| AC7.1 | Task 7 Step 2 |
| AC8.1 | Task 6 |
