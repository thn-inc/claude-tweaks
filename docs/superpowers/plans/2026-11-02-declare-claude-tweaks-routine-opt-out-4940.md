# declare-claude-tweaks Routine Opt-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the routine kernel's self-heal, `/init` Step 15's Setup-script offer and `/routine create`'s preview respect `declare-claude-tweaks: false`.

**Architecture:** Three prose edits to shipped skill markdown, each pinned by a conformance assertion in `tests/declare-claude-tweaks-opt-out.test.js`. The kernel runs in a cloud sandbox with no plugin installed, so it reads `.claude-tweaks/policy.yml` directly. The two interactive surfaces resolve the key through `resolve-policy.js`.

**Tech Stack:** Markdown skill files, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T105404-record-4940/work/4940-spec.md`

## Global Constraints

- Any edit to the kernel block text requires `kernel_version` += 1 (`plugin/skills/_shared/routine-template-schema.md`, the paragraph after `kernel_version:`). It goes from `1` to `2`. Do not pin the number in a test: the schema test asserts only a positive integer, on purpose.
- With the key unset or `true`, behavior stays the same: the existing default-path sentences keep their wording, apart from the `Read` → `Otherwise, read` lead-in on the kernel's log-read sentence.
- Size rail: `RAIL_BYTES` = 52,500 B. Current sizes: `routine-template-schema.md` 24,483 B, `step-15-routine-installation.md` 11,451 B, `create-and-update.md` 41,154 B (78% of the rail, with about 11 KB headroom). Each edit adds under 700 B.
- Governing project skill `.claude/skills/skill-prose-conformance-tests/SKILL.md`, quoted verbatim:
  - "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`."
  - "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** — `assert.throws(() => assertBlock(mutated), { message }, …)` — preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control."
  - "**When one region must state many facts, use a missing-facts predicate and prove each fact returns exactly itself.**"
  - "Before adding text to a file other suites pin, grep `tests/` for the file and each suite's slice anchors; keep the new text outside the slice, or re-prove that suite's go-red controls on the edited slice."
- Existing pins on the edited prose must stay green. They are `tests/routine-template-schema.test.js` "the kernel block carries its four parts in order" (anchors `git merge --ff-only`, `cache-scan-highest-of-N`, `bash scripts/claude-cloud-setup.sh`, `follow its instructions directly as written` and `Then: /claude-tweaks:routine-kickoff {kickoff}`, in that order) and `tests/routine-notifications.test.js`'s `/Render one further line stating the routine will send an email notification on every firing/`.
- Commit subjects use `{Verb} {what} — {detail}` and end with `refs #4940`. Never `closes`.

## Review Focus

1. A policy.yml value other than the literal `false` (for example `off`): `resolve-policy.js` resolves it to `true`, so the kernel text keys on the literal `declare-claude-tweaks: false` and nothing looser (Task 1 pins the literal).
2. The opt-out branch of the kernel must not tell the firing to run `scripts/claude-cloud-setup.sh` (Task 1 asserts the opt-out sentence carries no `claude-cloud-setup`).
3. `/init` Step 15 calls `/claude-tweaks:routine create … --source init` once per selected candidate, so without a skip rule the notice prints N+1 times instead of once (Task 2 pins the `--source init` skip).
4. A zero-candidate `/init` run creates no routine, so it must not print the notice (Task 2 scopes it to "at least one candidate was selected").
5. Opt-out text inserted inside `routine-notifications.test.js`'s pinned Step 7 sentence would break that regex. It goes after the sentence instead (covered by the full suite).

---

### Task 1: Kernel self-heal names the opt-out

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/routine-template-schema.md:31` (`kernel_version: 1` → `kernel_version: 2`) and `:61-68` (the self-heal paragraph inside the kernel fence)
- Test: `tests/declare-claude-tweaks-opt-out.test.js` (append)

**Interfaces:**
- Produces: the test helpers `kernelSelfHeal(text) -> string` (the whitespace-collapsed paragraph starting `If all four rungs came up empty` inside the `## Standard prompt kernel` fence) and `assertKernelOptOut(paragraph)`. Task 2 does not consume them.

- [ ] **Step 1: Write the failing tests** (append to `tests/declare-claude-tweaks-opt-out.test.js`, reading the schema via `readText`):

```js
const SCHEMA = readText(path.join(ROOT, 'plugin', 'skills', '_shared', 'routine-template-schema.md'));
const KERNEL_OPT_OUT_IF = "If this checkout's `.claude-tweaks/policy.yml` sets `declare-claude-tweaks: false`";
const KERNEL_OPT_OUT_LINE = '`claude-tweaks not installed: this project sets declare-claude-tweaks: false, so its Setup script does not install claude-tweaks — supply claude-tweaks to this environment another way, or set the key back to true`';
const KERNEL_DEFAULT_READ = 'Otherwise, read `$HOME/claude-cloud-setup.log`';
const KERNEL_DEFAULT_HEAL = 'run `bash scripts/claude-cloud-setup.sh` to self-heal, and re-run the resolved-build line once before proceeding to the kickoff.';
```

`kernelSelfHeal(text)`: split on `## Standard prompt kernel`, take the first fenced block (` ``` ` split index 1), split on `/\n\n/`, keep the one paragraph that starts with `If all four rungs came up empty`, assert exactly one, return it collapsed (`collapse`).

`assertKernelOptOut(p)` asserts, each with its own message:
- `p.includes(KERNEL_OPT_OUT_IF)`, message `kernel opt-out condition missing`
- `p.includes(KERNEL_OPT_OUT_LINE)`, message `kernel opt-out print line missing`
- the opt-out segment `p.slice(p.indexOf(KERNEL_OPT_OUT_IF), p.indexOf(KERNEL_DEFAULT_READ))` (assert both indices are found and in that order first, message `kernel opt-out segment anchors missing`) contains `and stop.` (message `kernel opt-out does not stop`) and does not contain `claude-cloud-setup` (message `kernel opt-out still names the setup script`)

`assertKernelDefault(p)` asserts that `p.includes(KERNEL_DEFAULT_READ)`, `p.includes(KERNEL_DEFAULT_HEAL)` and both existing print lines (`claude-cloud-setup.log: absent — the environment Setup script left no trace in this container (not executed, or its write failed)` and `claude-cloud-setup.log: present — tail: {last 5 lines}`) all hold, and that `p.indexOf(KERNEL_DEFAULT_READ) < p.indexOf('bash scripts/claude-cloud-setup.sh')`. The message is `kernel default path lost: {needle}`.

Tests:
- `AC (kernel, false): the self-heal names the opt-out and never runs the setup script on it`: `assertKernelOptOut(kernelSelfHeal(SCHEMA))`.
- `AC (kernel, default): the unset/true path still reads the log and self-heals`: `assertKernelDefault(kernelSelfHeal(SCHEMA))`.
- `kernel opt-out go-red controls`, one `assert.notEqual(mutated, original)` plus a message-matched `assert.throws` per case:
  - strip `KERNEL_OPT_OUT_LINE` → `/kernel opt-out print line missing/`
  - strip `KERNEL_OPT_OUT_IF` → `/kernel opt-out condition missing/`
  - replace `, and stop.` with `.` inside the segment → `/kernel opt-out does not stop/`
  - insert ` run \`bash scripts/claude-cloud-setup.sh\`` just before `, and stop.` → `/kernel opt-out still names the setup script/`
  - strip `KERNEL_DEFAULT_HEAL` from the default helper's input → `/kernel default path lost/`

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test tests/declare-claude-tweaks-opt-out.test.js`
Expected: FAIL on the two AC tests and the go-red test, with `kernel opt-out condition missing` and `kernel default path lost: Otherwise, read`.

- [ ] **Step 3: Edit the kernel paragraph** in `plugin/skills/_shared/routine-template-schema.md`. Keep the hard wrap near 80 columns and change nothing else in the fence. Replace:

```
empty — do not attempt the kickoff yet. Read `$HOME/claude-cloud-setup.log` (via
```

with:

```
empty — do not attempt the kickoff yet. If this checkout's
`.claude-tweaks/policy.yml` sets `declare-claude-tweaks: false`, this project
opted out of declaring claude-tweaks, so its Setup script cannot install it
here: skip the log read and the self-heal, print exactly one line,
`claude-tweaks not installed: this project sets declare-claude-tweaks: false,
so its Setup script does not install claude-tweaks — supply claude-tweaks to
this environment another way, or set the key back to true`, and stop.
Otherwise, read `$HOME/claude-cloud-setup.log` (via
```

Then change `kernel_version: 1` to `kernel_version: 2`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test tests/declare-claude-tweaks-opt-out.test.js tests/routine-template-schema.test.js tests/routine-template-parser.test.js tests/routine-kickoff.test.js tests/integration-branch-conformance.test.js tests/routine-fleet-security-hardening.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/routine-template-schema.md tests/declare-claude-tweaks-opt-out.test.js
git commit -m "Make the routine kernel self-heal opt-out aware — skip the setup script and name declare-claude-tweaks: false; refs #4940"
```

### Task 2: /init Step 15 and /routine create state the opt-out once

**Role:** integration

**Files:**
- Modify: `plugin/skills/init/bootstrap/step-15-routine-installation.md`. Add a new paragraph right after the "**Zero candidates were selected**" bullet (line 43), before the "**For each selected candidate:**" paragraph.
- Modify: `plugin/skills/routine/create-and-update.md:111`. Insert after the sentence ending `per \`notifications\` above.` and before `This creates live, billed infrastructure`.
- Test: `tests/declare-claude-tweaks-opt-out.test.js` (append)

**Interfaces:**
- Consumes: the existing `collapse` and `missingFacts(facts)` helpers in the same test file.

- [ ] **Step 1: Write the failing tests.** Read both files via `readText`. Slice Step 15 from `**Apply the Setup script to a dedicated environment (deferred from Step 14).**` to `**For each selected candidate:**`. Slice create-and-update from `**Step 7 — Preview and confirm.**` to `**Step 8 — Create.**`. Each slice assertion reports `{label} anchors missing` when an anchor is absent. Add a `ROUTINE_NOTICE_FACTS` list in the `COPY_FACTS` shape (`[name, sliceText, literal]`):

| name | slice | literal |
|---|---|---|
| `step15 resolves the key once` | Step 15 slice | `**Opt-out notice.** When at least one candidate was selected, resolve \`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values declare-claude-tweaks\` once, before the offer above.` |
| `step15 notice line` | Step 15 slice | `` `Routines: this project sets declare-claude-tweaks: false, so its Setup script does not install claude-tweaks — a routine fired here needs claude-tweaks supplied to its environment another way, or the key set back to true.` `` |
| `step15 create calls skip their copy` | Step 15 slice | `The \`/claude-tweaks:routine create … --source init\` calls below then skip their own copy of it.` |
| `step15 default unchanged` | Step 15 slice | `At \`true\` (the default) nothing prints and the offer is unchanged.` |
| `create resolves the key` | Step 7 slice | `When \`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values declare-claude-tweaks\` prints \`false\`, render one more line, once:` |
| `create notice line` | Step 7 slice | `` `claude-tweaks: not declared — this project sets declare-claude-tweaks: false, so its Setup script does not install claude-tweaks, and this routine will fire without it unless claude-tweaks is supplied to its environment another way, or the key is set back to true.` `` |
| `create skips under --source init` | Step 7 slice | `Skip that line under \`--source init\`: \`/claude-tweaks:init\` Step 15 already printed the notice once for its run.` |
| `create default unchanged` | Step 7 slice | `At \`true\` (the default) the preview is unchanged.` |

Tests:
- `AC (Step 15 + /routine create): each carries the opt-out notice, once`: `assert.deepStrictEqual(missingFacts(ROUTINE_NOTICE_FACTS), [])`. For each fact, also assert that the literal occurs exactly once in its slice (`slice.split(literal).length === 2`).
- The same test runs the per-fact go-red control in the existing `COPY_FACTS` style: strip one literal from its slice, `assert.notEqual`, then `assert.deepStrictEqual(missingFacts(…doctored…), [name])`.
- `the Step 15 notice sits outside the zero-candidates bullet`: the index of the `**Opt-out notice.**` marker in the Step 15 slice is greater than the index of `**Zero candidates were selected**`. The control swaps the two paragraphs in memory and expects `assert.throws` with `/must come after/`, using the file's existing `requireOrder` helper.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test tests/declare-claude-tweaks-opt-out.test.js`
Expected: FAIL. `missingFacts` returns all eight names.

- [ ] **Step 3: Add the Step 15 paragraph.** Insert it as its own paragraph (blank lines around it) after the Zero-candidates bullet. It is exactly the first, third and fourth Step 15 literals above, in table order, with the second literal inside a sentence: `**Opt-out notice.** When at least one candidate was selected, resolve … once, before the offer above. At \`false\`, print this line once, ahead of the offer: {step15 notice line} The … calls below then skip their own copy of it. At \`true\` (the default) nothing prints and the offer is unchanged.`

- [ ] **Step 4: Add the create-and-update Step 7 sentences.** Insert them after `per \`notifications\` above.` as `{create resolves the key} {create notice line} {create skips under --source init} {create default unchanged}`, single-spaced and inline in the same paragraph.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `node --test tests/declare-claude-tweaks-opt-out.test.js tests/routine-notifications.test.js tests/routine-pause-resume.test.js tests/worktree-adopt-merged-branch-precondition.test.js tests/worktree-adopt-or-create-consolidation.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/init/bootstrap/step-15-routine-installation.md plugin/skills/routine/create-and-update.md tests/declare-claude-tweaks-opt-out.test.js
git commit -m "State the declare-claude-tweaks opt-out once in /init Step 15 and /routine create — refs #4940"
```
