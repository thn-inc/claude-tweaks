# Dispatch Render-Failure Stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `dispatch-prompt.js` non-zero exit for any call ends the dispatch firing (like the Claim permission stop), is relayed to the human and notified when headless, while a denied-twice call keeps ending only its own group.

**Architecture:** Prose-only change across `plugin/skills/dispatch/`. Every site that names the Claim permission stop as firing-ending gains the render-failure stop beside it. `tests/dispatch-prompt-cli-prose.test.js` pins the new prose with message-matched go-red controls, and four exact-text regexes in `tests/flow-claim-preflight.test.js` are extended to the new wording. No CLI or hook code changes.

**Tech Stack:** Markdown skill files; `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-12T235825-record-5255/work/5255-spec.md` (record #5255)

## Global Constraints

- Worktree: `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/record-5255`. Run `pwd` and `git -C "{worktree}" rev-parse --show-toplevel` as plain commands before any git or test command; use `git -C "{worktree}" …`, never `cd … &&`.
- Commit messages: `{Verb} {what} — {detail}, refs #5255` (never "closes"), ending with the line `Claude-Session: https://claude.ai/code/session_017vXcAfSWriPsfd3YRPzi9n`. Stage named files only.
- Every prose edit below is exact copy: apply each "Replace" block with the Edit tool, old text matched exactly once. Do not reword, rewrap or "improve" adjacent text.
- Size rail (`RAIL_BYTES` = 52,500 B, `plugin/bin/lib/skill-audit/budgets.js`). Measured on scratch copies with every edit applied: `SKILL.md` 52,469 → 52,328 B (172 B headroom; the cut is Task 2's infra-outage and Concurrency-note trims, with rationale moved to `design-notes.md`); `task-prompt.md` 51,966 → 51,986 B; `two-call-gate.md` 27,628 → 28,505 B; `reporting.md` 8,593 → 9,330 B; `design-notes.md` 6,004 → 7,883 B; `firing-exclusion.md` 4,660 → 4,788 B; `sequential-execution.md` 16,549 → 16,574 B; `next-ranking.md` 4,928 → 4,986 B. Do not add bytes to `SKILL.md` beyond Task 2's copy.
- Governing project skill `skill-prose-conformance-tests` (`.claude/skills/skill-prose-conformance-tests/SKILL.md`), quoted verbatim:
  - "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** — `assert.throws(() => assertBlock(mutated), { message }, …)` — preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control."
  - "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`."
  - "Before adding text to a file other suites pin, grep `tests/` for the file and each suite's slice anchors; keep the new text outside the slice, or re-prove that suite's go-red controls on the edited slice."
  - "The mutation lives in a string, so it leaves nothing in the tree."
- Scope and edit discipline (quoted, `build/SKILL.md` Common Step 2): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

## Review Focus

1. A phrase the new paragraph shares with the Claim permission paragraph next to it ("attempt no further group", "says the firing stopped"): a file-wide `replace` control would hit the other copy and pass vacuously. Covered: controls mutate inside their own paragraph (`mutateInParagraph`, Task 1).
2. A future fifth "Claim permission stop" exit list in `SKILL.md` that forgets the render-failure stop. Covered: Task 2's line sweep over every such line, not a fixed list.
3. A future "none after a Claim permission stop" clause in `two-call-gate.md` without the render-failure stop. Covered: Task 1's count-equality check.
4. The denied-twice path drifting into ending the firing. Covered: Task 1's `assertDeniedTwiceContinues` and its controls (AC6.1).
5. Sibling suites slicing the edited files (`tests/flow-claim-preflight.test.js` exact regexes, `tests/plan-review-dispatch-relay-conformance.test.js`'s `'headless plan-review needs-human block'`). Covered: Task 1-2 regex updates; the plan-review phrase is kept verbatim in Task 3's PushNotification edit; full `verify.js` at Common Step 5.

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 1 tests `AC1.1, AC5.1` and `AC1.1, AC6.1` |
| AC2.1 | Task 2 tests |
| AC3.1 | Task 3 tests |
| AC4.1 | Task 3 tests |
| AC5.1 | Task 1 go-red test |
| AC5.2 | Task 1 Step 5 (real-tree revert, failing line quoted) |
| AC6.1 | Task 1 tests |
| AC7.1 | `/build` Common Step 5 full verification (`verify.js`), not a task test |

---

### Task 1: `two-call-gate.md` ends the firing on a render failure

**Role:** transcription

**Files:**
- Modify: `plugin/skills/dispatch/two-call-gate.md` (section 2 render paragraph; section 5 "Prompt not dispatched" paragraph and the "Only once that cleanup call returns" line; end of section 6; section 7's last line)
- Modify: `plugin/skills/dispatch/task-prompt.md:3`
- Test: `tests/dispatch-prompt-cli-prose.test.js` (append)
- Test: `tests/flow-claim-preflight.test.js` (one regex at the `the other "move on" sites` test)

**Interfaces:**
- Produces (in `tests/dispatch-prompt-cli-prose.test.js`, used by Tasks 2-3): `mutateInParagraph(text: string, lead: string, needle: string, replacement: string): string` — replaces `needle` inside the one `\n\n`-paragraph starting with `lead`, asserting the paragraph exists and the text changed.

- [ ] **Step 1: Append the failing tests to `tests/dispatch-prompt-cli-prose.test.js`**

Append after the last test (`the CLI file named in prose exists`); `region`, `GATE`, `TASK_PROMPT`, `read`, `test`, `assert` already exist in the file:

```js

// #5255: a dispatch-prompt.js non-zero exit ends the firing, for any call; a denied-twice call does
// not. All of this prose is new in the same change, so each control mutates the live text in
// memory and matches the throw to its own assertion's message (skill-prose-conformance-tests).
const RENDER_PARA = '**A prompt that does not render, or is denied twice (#4589).**';
const SEC2_STOP_LEAD = '**A render failure ends the firing (#5255).**';
const SEC2_ANY_CALL = 'for any call (a first call, a second call, or a continuation of either)';
const SEC2_STOP = 'ends the firing once that group\'s section 5 or section 6 cleanup call returns';
const SEC2_DENIED = 'A denied-twice call does not end the firing: the fault is in that one call, so the firing goes on to the next group.';
const SEC5_STOP = 'On a render failure the firing then ends (section 2\'s render-failure stop)';
const SEC5_DENIED = 'on a denied-twice call it goes on to the next group.';
const SEC6_LEAD = '**Render-failure stop (#5255).**';
const SEC6_STOP = 'the firing ends once it returns (`SKILL.md`\'s Render-failure stop)';
const NONE_AFTER = 'none after a Claim permission stop';

// Replace `needle` inside the one paragraph starting with `lead`, so a phrase another paragraph
// shares (the Claim permission stop's own wording) cannot satisfy the control.
function mutateInParagraph(text, lead, needle, replacement) {
  const paras = text.split('\n\n');
  const i = paras.findIndex((p) => p.startsWith(lead));
  assert.notStrictEqual(i, -1, `paragraph not found: ${lead}`);
  paras[i] = paras[i].replace(needle, replacement);
  const out = paras.join('\n\n');
  assert.notStrictEqual(out, text, `control must change the text: ${needle}`);
  return out;
}
const NONE_AFTER_BOTH = 'none after a Claim permission stop or a render-failure stop';

function section2Para(gate) {
  const para = region(gate, '## 2.', '## 5.').split('\n\n').find((p) => p.startsWith(RENDER_PARA));
  assert.ok(para, 'section 2: render-failure paragraph missing');
  return para;
}
function section5Para(gate) {
  const para = region(gate, '## 5.', '## 6.').split('\n').find((l) => l.trim().startsWith('**Prompt not dispatched (#4589).**'));
  assert.ok(para, 'section 5: Prompt not dispatched paragraph missing');
  return para;
}

function assertRenderFailureStop(gate) {
  const para = section2Para(gate);
  assert.ok(para.includes(SEC2_STOP_LEAD), 'section 2: render-failure stop sentence missing');
  assert.ok(para.includes(SEC2_ANY_CALL), 'section 2: any-call scope missing');
  assert.ok(para.includes(SEC2_STOP), 'section 2: ends-the-firing clause missing');
  assert.ok(section5Para(gate).includes(SEC5_STOP), 'section 5: render-failure stop clause missing');
  const sec6 = region(gate, '## 6.', '## 7.').split('\n\n').find((p) => p.startsWith(SEC6_LEAD));
  assert.ok(sec6 && sec6.includes(SEC6_STOP), 'section 6: render-failure stop paragraph missing');
  // Every "none after a Claim permission stop" clause names the render-failure stop too.
  const clauses = gate.split(NONE_AFTER).length - 1;
  assert.ok(clauses >= 2, 'expected at least two none-after clauses');
  assert.strictEqual(gate.split(NONE_AFTER_BOTH).length - 1, clauses, 'a none-after clause does not name the render-failure stop');
}

function assertDeniedTwiceContinues(gate) {
  assert.ok(section2Para(gate).includes(SEC2_DENIED), 'section 2: denied-twice continuation missing');
  assert.ok(section5Para(gate).includes(SEC5_DENIED), 'section 5: denied-twice continuation missing');
}

test('AC1.1, AC5.1: a render failure for any call ends the firing after its section 5 or 6 cleanup (#5255)', () => {
  assertRenderFailureStop(GATE);
});

test('AC5.1 go-red: removing the ends-the-firing sentence, or any one clause, fails its own assertion (#5255)', () => {
  const para = section2Para(GATE);
  const start = para.indexOf(SEC2_STOP_LEAD);
  const end = para.indexOf(SEC2_DENIED);
  assert.ok(start !== -1 && end > start, 'the stop sentence must precede the denied-twice sentence');
  const reverted = GATE.replace(para.slice(start, end), '');
  assert.notStrictEqual(reverted, GATE);
  assert.throws(() => assertRenderFailureStop(reverted), { message: 'section 2: render-failure stop sentence missing' });
  for (const [needle, message] of [
    [SEC2_ANY_CALL, 'section 2: any-call scope missing'],
    [SEC2_STOP, 'section 2: ends-the-firing clause missing'],
    [SEC5_STOP, 'section 5: render-failure stop clause missing'],
    [SEC6_STOP, 'section 6: render-failure stop paragraph missing'],
  ]) {
    const mutated = GATE.replace(needle, 'x');
    assert.notStrictEqual(mutated, GATE);
    assert.throws(() => assertRenderFailureStop(mutated), { message });
  }
  const narrowed = GATE.replace(NONE_AFTER_BOTH, NONE_AFTER);
  assert.notStrictEqual(narrowed, GATE);
  assert.throws(() => assertRenderFailureStop(narrowed), { message: /a none-after clause does not name the render-failure stop/ });
});

test('AC1.1, AC6.1: a denied-twice call still ends only its own group (#5255)', () => {
  assertDeniedTwiceContinues(GATE);
});

test('AC6.1 go-red: making the denied-twice path end the firing fails the assertion (#5255)', () => {
  const sec2 = GATE.replace(SEC2_DENIED, 'A denied-twice call ends the firing too.');
  assert.notStrictEqual(sec2, GATE);
  assert.throws(() => assertDeniedTwiceContinues(sec2), { message: 'section 2: denied-twice continuation missing' });
  const sec5 = GATE.replace(SEC5_DENIED, 'on a denied-twice call it ends the firing too.');
  assert.notStrictEqual(sec5, GATE);
  assert.throws(() => assertDeniedTwiceContinues(sec5), { message: 'section 5: denied-twice continuation missing' });
});

test('task-prompt.md says a render failure ends the firing (#5255)', () => {
  const NEEDLE = 'a render failure blocks the group and ends the firing (`two-call-gate.md` §2)';
  const check = (text) => assert.ok(text.includes(NEEDLE), 'task-prompt.md: render failure must end the firing');
  check(TASK_PROMPT);
  assert.throws(() => check(TASK_PROMPT.replace(' and ends the firing', '')), { message: 'task-prompt.md: render failure must end the firing' });
});
```

In `tests/flow-claim-preflight.test.js`, in test `the other "move on" sites name the Claim permission stop (#4899)`, replace the regex
`/next group's worktree \(none after a Claim permission stop: the firing ends, `SKILL\.md`\)\.\n\n## 8\./`
with
`/next group's worktree \(none after a Claim permission stop or a render-failure stop: the firing ends, `SKILL\.md`\)\.\n\n## 8\./`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/dispatch-prompt-cli-prose.test.js tests/flow-claim-preflight.test.js`
Expected: FAIL — `section 2: render-failure paragraph missing`-family messages (`section 2: render-failure stop sentence missing`, `section 2: denied-twice continuation missing`, `task-prompt.md: render failure must end the firing`) and the updated `move on` regex not matching.

- [ ] **Step 3: Apply the prose edits**

`plugin/skills/dispatch/two-call-gate.md`, five replacements:

(a) Replace
```
appends section 5's `(prompt-not-dispatched: skip the claim release)` to that cleanup call.
```
with
```
appends section 5's `(prompt-not-dispatched: skip the claim release)` to that cleanup call. **A render failure ends the firing (#5255).** A `dispatch-prompt.js` non-zero exit, for any call (a first call, a second call, or a continuation of either), ends the firing once that group's section 5 or section 6 cleanup call returns (`SKILL.md`'s Render-failure stop): the CLI's inputs are nearly all firing-wide, so every later group would fail the same way. A denied-twice call does not end the firing: the fault is in that one call, so the firing goes on to the next group.
```

(b) Replace
```
because `release-claim.js` would post a false release comment on an absent blob or a tombstone. The firing goes on to the next group.
```
with
```
because `release-claim.js` would post a false release comment on an absent blob or a tombstone. On a render failure the firing then ends (section 2's render-failure stop); on a denied-twice call it goes on to the next group.
```

(c) Replace
```
Only once that cleanup call returns does this session enter the next group's worktree (none after a Claim permission stop: the firing ends).
```
with
```
Only once that cleanup call returns does this session enter the next group's worktree (none after a Claim permission stop or a render-failure stop: the firing ends).
```

(d) Insert a new paragraph between section 6's last paragraph (the `**Blocker-landing stop (#4792).**` one, ending `` (`bin/lib/release-claim/release.js`). ``) and the `## 7.` heading, separated by blank lines:
```
**Render-failure stop (#5255).** When this path was reached because `dispatch-prompt.js` exited non-zero for the second call or its continuation (section 2), make item 1's call unchanged; the firing ends once it returns (`SKILL.md`'s Render-failure stop).
```

(e) Replace (section 7's last sentence)
```
this session enter the next group's worktree (none after a Claim permission stop: the firing ends, `SKILL.md`).
```
with
```
this session enter the next group's worktree (none after a Claim permission stop or a render-failure stop: the firing ends, `SKILL.md`).
```

`plugin/skills/dispatch/task-prompt.md` line 3: replace
```
a render failure blocks the group (`two-call-gate.md` §2).
```
with
```
a render failure blocks the group and ends the firing (`two-call-gate.md` §2).
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/dispatch-prompt-cli-prose.test.js tests/flow-claim-preflight.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: AC5.2 — prove the pin on the real tree**

Write a scratch node script (in the session scratchpad, not the repo) that reads `plugin/skills/dispatch/two-call-gate.md`, removes the text from `**A render failure ends the firing (#5255).**` up to (not including) `A denied-twice call does not end the firing`, writes it back, runs `node --test tests/dispatch-prompt-cli-prose.test.js` via `spawnSync`, and restores the original bytes in a `finally` block in the same process. Run it.
Expected: the spawned run exits non-zero with `section 2: render-failure stop sentence missing`; afterwards `git -C "{worktree}" status --porcelain -- plugin/skills/dispatch/two-call-gate.md` shows the file still modified only by this task's edit (diff identical to Step 3's). Quote the failing line in the task report.

- [ ] **Step 6: Commit**

```bash
git -C "{worktree}" add plugin/skills/dispatch/two-call-gate.md plugin/skills/dispatch/task-prompt.md tests/dispatch-prompt-cli-prose.test.js tests/flow-claim-preflight.test.js
git -C "{worktree}" commit -F {message-file}
```
Message: `End the dispatch firing on a render failure in two-call-gate.md — any call, after its cleanup; denied-twice still ends only its group, refs #5255`

---

### Task 2: `SKILL.md` names the Render-failure stop

**Role:** transcription

**Files:**
- Modify: `plugin/skills/dispatch/SKILL.md` (Input: infra-outage paragraph, new paragraph after `**Claim permission stop (#4899).**`; Step 1 close-out list; Step 3 Loop line and loop-termination paragraph; Concurrency note; Step 6)
- Modify: `plugin/skills/dispatch/design-notes.md` (append two sections)
- Test: `tests/dispatch-prompt-cli-prose.test.js` (append)
- Test: `tests/flow-claim-preflight.test.js` (three regexes)

**Interfaces:**
- Consumes: `mutateInParagraph` (Task 1), `SKILL`, `assert`, `test`.

- [ ] **Step 1: Append the failing tests**

Append to `tests/dispatch-prompt-cli-prose.test.js`:

```js

// SKILL.md: the stop's own paragraph, and every other line naming the Claim permission stop
// (each is a list of firing-ending exits) names the render-failure stop too.
const SKILL_STOP_LEAD = '**Render-failure stop (#5255).**';
const SKILL_STOP_FACTS = [
  'stops the firing in every selection form once that group\'s cleanup call returns',
  'attempt no further group',
  'any named records after it as not attempted',
  'A headless firing also sends one `PushNotification` naming the record and the stderr line.',
  'A denied-twice call is not this stop.',
];
function assertSkillStop(skill) {
  const para = skill.split('\n\n').find((p) => p.startsWith(SKILL_STOP_LEAD));
  assert.ok(para, 'SKILL.md: Render-failure stop paragraph missing');
  for (const f of SKILL_STOP_FACTS) assert.ok(para.includes(f), `SKILL.md Render-failure stop: missing ${JSON.stringify(f)}`);
  const lists = skill.split('\n').filter((l) => l.includes('Claim permission stop') && !l.startsWith('**Claim permission stop (#4899).**'));
  assert.ok(lists.length >= 4, `expected at least four firing-ending exit lists, found ${lists.length}`);
  for (const l of lists) assert.ok(/render-failure stop/i.test(l), `SKILL.md exit list does not name the render-failure stop: ${l.slice(0, 80)}`);
}

test('AC2.1: SKILL.md carries the Render-failure stop paragraph and every exit list names it (#5255)', () => {
  assertSkillStop(SKILL);
});

test('AC2.1 go-red: a dropped fact or an exit list without the stop fails its own assertion (#5255)', () => {
  for (const f of SKILL_STOP_FACTS) {
    const mutated = mutateInParagraph(SKILL, SKILL_STOP_LEAD, f, 'x');
    assert.throws(() => assertSkillStop(mutated), { message: `SKILL.md Render-failure stop: missing ${JSON.stringify(f)}` });
  }
  const unlisted = SKILL.replace('or a Claim permission stop or Render-failure stop ends the firing', 'or a Claim permission stop ends the firing');
  assert.notStrictEqual(unlisted, SKILL);
  assert.throws(() => assertSkillStop(unlisted), { message: /SKILL\.md exit list does not name the render-failure stop/ });
});
```

In `tests/flow-claim-preflight.test.js` replace three regexes:
- `/the ranking returns `null`, or a Claim permission stop\), close/` → `/the ranking returns `null`, or a Claim permission stop or Render-failure stop\), close/`
- `/the ranking returns `null`, or a Claim permission stop ends the firing/` → `/the ranking returns `null`, or a Claim permission stop or Render-failure stop ends the firing/`
- `/move straight to the next group \(none after a Claim permission stop\)/` → `/move straight to the next group \(none after a Claim permission stop or a Render-failure stop\)/`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/dispatch-prompt-cli-prose.test.js tests/flow-claim-preflight.test.js`
Expected: FAIL — `SKILL.md: Render-failure stop paragraph missing` and the three updated regexes not matching.

- [ ] **Step 3: Apply the prose edits**

`plugin/skills/dispatch/SKILL.md`:

(a) Replace the whole `**Repo-wide infra outage stop (#2365).**` paragraph (one line, from `**Repo-wide infra outage stop (#2365).** Bare drain's no-` to `…after two groups have independently hit it.`) with:
```
**Repo-wide infra outage stop (#2365).** `settle-and-merge.md` Step 6 point 3 classifies each Settle failure as `correctness`/`ambiguous`/`transient` via `assess-agent-autonomy`'s `failure-check` mode, where `transient` means "infrastructure failure, not this record's fault." When **two or more groups in the same drain firing** land a `transient` classification — that repetition, not one transient failure, which that step already handles by preserving `auto:merge`/`auto:merge-pending` — stop the remaining drain immediately (attempt no further groups against `--budget`) and report the halt, never asking (Input table above), in this firing's own end-of-run output naming which groups hit it and each one's `assess-agent-autonomy` rationale. Why it reuses Settle's classification: `design-notes.md`.
```

(b) After the `**Claim permission stop (#4899).**` paragraph (ending `as not attempted and unclaimed.`), insert a blank line and:
```
**Render-failure stop (#5255).** A `dispatch-prompt.js` non-zero exit for any call (`two-call-gate.md` §2) stops the firing in every selection form once that group's cleanup call returns: attempt no further group, and report the record, the stop, and any named records after it as not attempted (`reporting.md`). A headless firing also sends one `PushNotification` naming the record and the stderr line. A denied-twice call is not this stop. Why: `design-notes.md`.
```

(c) Replace `the Claim permission stop, a queue-pull `exit 1`,` with `the Claim permission stop, a queue-pull `exit 1`, the Render-failure stop,`

(d) Replace `the ranking returns `null`, or a Claim permission stop ends the firing.` with `the ranking returns `null`, or a Claim permission stop or Render-failure stop ends the firing.`

(e) Replace `the ranking returns `null`, or a Claim permission stop), close` with `the ranking returns `null`, or a Claim permission stop or Render-failure stop), close`

(f) Replace the Concurrency note's body paragraph (from `Two firings running close together each do their own unsynchronized Preflight read` to `Read `design-notes.md` in this skill's directory.`) with:
```
Two firings' Preflight reads are unsynchronized, so one can see different `work-backend` content than another. Accepted: `/claude-tweaks:flow`'s Step 2.8 atomic claim write (inside the first Task call), not the Preflight read and not Step 4's mint, is the correctness boundary, so no double-build follows. Why: `design-notes.md` in this skill's directory.
```
Keep the `### Concurrency note (Preflight reads, not claim correctness)` heading unchanged (`tests/dispatch-flow-rundir-handoff.test.js` anchors on it).

(g) Replace `move straight to the next group (none after a Claim permission stop).` with `move straight to the next group (none after a Claim permission stop or a Render-failure stop).`

`plugin/skills/dispatch/design-notes.md`: append at the end of the file (after the last `- Tests that pin literal bytes …` bullet), separated by a blank line:
```
## Why the repo-wide infra outage stop reuses Settle's classification

`SKILL.md`'s Repo-wide infra outage stop (#2365) reads the `transient` classification Settle already makes instead of inventing a new detection heuristic. It follows the same "report and stop, never ask" shape the Detection Ladder uses for a real Preflight failure: a repo-wide outage is a real failure, just one only visible after two groups have independently hit it.

## Why a render failure ends the firing (#5255)

A first call whose prompt never rendered is never dispatched, so Settle, which runs inside the call, never counts a retry, posts a failure comment or changes a label. Before #5255 the group was excluded for the rest of that firing only, and every later firing re-selected the same record and failed the same way, with one more `REFUSED` line in `decisions.md` as the only evidence.

`dispatch-prompt.js`'s inputs are nearly all firing-wide: `task-prompt.md`'s template, the resolved policy values, the model profile, the `--run` guard and the session temp path. When one breaks, every later group in the firing fails the same way, so the stop takes the Claim permission stop's shape (#4899): end the firing, relay it, and notify when headless. A denied-twice call is different: the model resent a prompt that differs from the file the CLI wrote, a fault in that one call, so it still ends only its own group.

Rejected alternative: count per-record retries for never-dispatched calls. It would need Settle logic in dispatch's main thread for a cause that is almost never the record's.

Accepted gap: a render failure that really is per-record (a malformed resume PR URL, say) stops every firing at that record until a human acts, because the ranking picks it first each time. The relay and the headless notification make it visible at once, unlike the silent re-selection this replaced.
```

- [ ] **Step 4: Run the tests and the size check**

Run: `node --test tests/dispatch-prompt-cli-prose.test.js tests/flow-claim-preflight.test.js`
Expected: PASS, 0 failures.
Run: `wc -c plugin/skills/dispatch/SKILL.md`
Expected: `52328` (must be ≤ 52500).

- [ ] **Step 5: Commit**

```bash
git -C "{worktree}" add plugin/skills/dispatch/SKILL.md plugin/skills/dispatch/design-notes.md tests/dispatch-prompt-cli-prose.test.js tests/flow-claim-preflight.test.js
git -C "{worktree}" commit -F {message-file}
```
Message: `Name the Render-failure stop in dispatch SKILL.md — every firing-ending exit list; rationale and infra-outage why moved to design-notes.md, refs #5255`

---

### Task 3: sibling files name the stop; `reporting.md` relays it

**Role:** transcription

**Files:**
- Modify: `plugin/skills/dispatch/firing-exclusion.md:16`
- Modify: `plugin/skills/dispatch/sequential-execution.md:58`
- Modify: `plugin/skills/dispatch/next-ranking.md:26-27`
- Modify: `plugin/skills/dispatch/reporting.md` (PushNotification sentence; new paragraph after the Claim permission relay)
- Test: `tests/dispatch-prompt-cli-prose.test.js` (append)

**Interfaces:**
- Consumes: `mutateInParagraph` (Task 1), `read`, `assert`, `test`.

- [ ] **Step 1: Append the failing tests to `tests/dispatch-prompt-cli-prose.test.js`**

```js

// firing-exclusion.md, sequential-execution.md, next-ranking.md: each names the stop where it
// names the Claim permission stop as ending the firing.
const FIRING_EXCLUSION_STOP = 'A render-failure stop ends the firing too (`SKILL.md`\'s Render-failure stop, #5255), so no next iteration runs after it either.';
const SEQUENTIAL_STOP = '(none after a Claim permission stop or a render-failure stop: the firing ends, `SKILL.md`)';
const NEXT_RANKING_STOP = 'or a render-failure stop never reaches this filter: each ends the firing';
function assertSiblingStops(files) {
  assert.ok(files.exclusion.includes(FIRING_EXCLUSION_STOP), 'firing-exclusion.md: render-failure stop missing');
  assert.ok(files.sequential.includes(SEQUENTIAL_STOP), 'sequential-execution.md: render-failure stop missing');
  assert.ok(files.ranking.includes(NEXT_RANKING_STOP), 'next-ranking.md: render-failure stop missing');
}
const SIBLINGS = { exclusion: read('firing-exclusion.md'), sequential: read('sequential-execution.md'), ranking: read('next-ranking.md') };

test('AC3.1: firing-exclusion.md, sequential-execution.md and next-ranking.md name the render-failure stop (#5255)', () => {
  assertSiblingStops(SIBLINGS);
});

test('AC3.1 go-red: each file without its sentence fails its own assertion (#5255)', () => {
  for (const [key, needle, message] of [
    ['exclusion', FIRING_EXCLUSION_STOP, 'firing-exclusion.md: render-failure stop missing'],
    ['sequential', SEQUENTIAL_STOP, 'sequential-execution.md: render-failure stop missing'],
    ['ranking', NEXT_RANKING_STOP, 'next-ranking.md: render-failure stop missing'],
  ]) {
    const mutated = { ...SIBLINGS, [key]: SIBLINGS[key].replace(needle, 'x') };
    assert.notStrictEqual(mutated[key], SIBLINGS[key]);
    assert.throws(() => assertSiblingStops(mutated), { message });
  }
});

// reporting.md: the relay paragraph, and the PushNotification sentence's headless case.
const RELAY_LEAD = '**Render-failure stops are relayed (#5255).**';
const RELAY_FACTS = [
  'names the record and the call (first, second, or a continuation)',
  'quotes the exit code and the first stderr line from that call\'s `Prompt render failed:` `REFUSED` line',
  'says the firing stopped',
  'lists any named records after it as not attempted',
  'It closes with the remedy on its own line: fix the named cause (the template, a policy value or the environment), then re-run `/claude-tweaks:dispatch #{n}`.',
];
const PUSH_CASE = 'for a headless render-failure stop (one notification naming the record and the stderr line';
function assertRelay(reporting) {
  const paras = reporting.split('\n\n');
  const para = paras.find((p) => p.startsWith(RELAY_LEAD));
  assert.ok(para, 'reporting.md: relay paragraph missing');
  for (const f of RELAY_FACTS) assert.ok(para.includes(f), `reporting.md relay: missing ${JSON.stringify(f)}`);
  const push = paras.find((p) => p.startsWith('`PushNotification` fires only'));
  assert.ok(push && push.includes(PUSH_CASE), 'reporting.md: PushNotification sentence must name a headless render-failure stop');
}
const REPORTING = read('reporting.md');

test('AC4.1: reporting.md relays the render-failure stop and notifies when headless (#5255)', () => {
  assertRelay(REPORTING);
});

test('AC4.1 go-red: a dropped relay fact or the missing headless case fails its own assertion (#5255)', () => {
  for (const f of RELAY_FACTS) {
    const mutated = mutateInParagraph(REPORTING, RELAY_LEAD, f, 'x');
    assert.throws(() => assertRelay(mutated), { message: `reporting.md relay: missing ${JSON.stringify(f)}` });
  }
  const noPush = REPORTING.replace(PUSH_CASE, 'x');
  assert.notStrictEqual(noPush, REPORTING);
  assert.throws(() => assertRelay(noPush), { message: 'reporting.md: PushNotification sentence must name a headless render-failure stop' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/dispatch-prompt-cli-prose.test.js`
Expected: FAIL — `firing-exclusion.md: render-failure stop missing` and `reporting.md: relay paragraph missing`.

- [ ] **Step 3: Apply the prose edits**

`firing-exclusion.md`: replace
```
A claim-permission-denied stop also ends the firing (`SKILL.md`'s Claim permission stop), so no next iteration runs.
```
with
```
A claim-permission-denied stop also ends the firing (`SKILL.md`'s Claim permission stop), so no next iteration runs. A render-failure stop ends the firing too (`SKILL.md`'s Render-failure stop, #5255), so no next iteration runs after it either.
```

`sequential-execution.md`: replace `(none after a Claim permission stop: the firing ends, `SKILL.md`)` with `(none after a Claim permission stop or a render-failure stop: the firing ends, `SKILL.md`)`.

`next-ranking.md`: replace the two lines
```
re-selects the identical group and reproduces the identical stop. A claim-permission-denied stop
never reaches this filter: it ends the firing (`SKILL.md`'s Claim permission stop). All three reasons are checked
```
with
```
re-selects the identical group and reproduces the identical stop. A claim-permission-denied stop
or a render-failure stop never reaches this filter: each ends the firing (`SKILL.md`'s Claim
permission stop and Render-failure stop, #5255). All three reasons are checked
```

`reporting.md`, two edits:

(a) In the `` `PushNotification` fires only `` sentence, replace
```
and for a headless plan-review needs-human block (sent by the blocked build itself, `build/plan-review.md`) — never per-firing
```
with
```
for a headless plan-review needs-human block (sent by the blocked build itself, `build/plan-review.md`), and for a headless render-failure stop (one notification naming the record and the stderr line, sent by the dispatching session, `SKILL.md`'s Render-failure stop) — never per-firing
```
(`headless plan-review needs-human block` must stay verbatim: `tests/plan-review-dispatch-relay-conformance.test.js` pins it.)

(b) After the `**Claim permission stops are relayed (#4899).**` paragraph (ending `` and the `claims-registry` branch. ``), insert a blank line and:
```
**Render-failure stops are relayed (#5255).** When `dispatch-prompt.js` exited non-zero for one of a group's calls (`SKILL.md`'s Render-failure stop), its report block names the record and the call (first, second, or a continuation), quotes the exit code and the first stderr line from that call's `Prompt render failed:` `REFUSED` line, says the firing stopped, and lists any named records after it as not attempted. It closes with the remedy on its own line: fix the named cause (the template, a policy value or the environment), then re-run `/claude-tweaks:dispatch #{n}`.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/dispatch-prompt-cli-prose.test.js tests/flow-claim-preflight.test.js tests/plan-review-dispatch-relay-conformance.test.js tests/dispatch-firing-exclusion.test.js tests/dispatch-sequential-execution-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git -C "{worktree}" add plugin/skills/dispatch/firing-exclusion.md plugin/skills/dispatch/sequential-execution.md plugin/skills/dispatch/next-ranking.md plugin/skills/dispatch/reporting.md tests/dispatch-prompt-cli-prose.test.js
git -C "{worktree}" commit -F {message-file}
```
Message: `Relay the dispatch render-failure stop — sibling files name it, reporting.md relays it and notifies when headless, refs #5255`
