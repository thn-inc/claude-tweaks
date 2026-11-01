# Opt Out of /init Declaring claude-tweaks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `declare-claude-tweaks` policy key (boolean, default `true`). At `false`, `/init` Step 14 stops declaring claude-tweaks at project scope, and `/routine`'s fleet check reports the missing declaration as an informational line instead of a failure.

**Architecture:** There is one new `POLICY_KEYS` row plus its doc row. The two skill files read the key through `bin/resolve-policy.js --values declare-claude-tweaks`, which prints `true`/`false`, and branch in prose on the result. Step 14's fenced setup-script template gets two `# (…)` template annotations that bracket the claude-tweaks marketplace lines, so the opted-out render is a mechanical omission that a test can apply to the template text.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T204904-record-4847/work/4847-spec.md`

## Global Constraints

- Key name: `declare-claude-tweaks`. Type `boolean`, `default: true`, `category: 'housekeeping'`, `tier: 'advanced'`. The core tier is at its cap of 12. No `policyOnly`/`policySourceExcluded`.
- Quoted from the `policy-key-addition` project skill: "A boolean's value is the literal `true`/`false`, never `on`/`off`: `resolveValue` falls back to the default on any other spelling". "`tests/policy-schema.test.js` pins `POLICY_KEYS.length`. Bump it in the same commit." "Every key needs a table row there that starts `` | `{key}` | `` … and its summary must not be copied verbatim from the row's `summary`". "State the value the resolver returns for unset, set and malformed input, from the code, not from intent."
- `superpowers@claude-plugins-official` stays a hard requirement in both Step 14 and the fleet check, whatever the key says (AC4.1).
- Default (unset key) behavior of Step 14 and the fleet check is unchanged (AC1.1).
- **Rail:** `plugin/skills/_shared/policy-schema.md` is 52,198 B against `RAIL_BYTES` 52,500 (`plugin/bin/lib/skill-audit/budgets.js`). The new row (~450 B) would breach the rail. Remedy, in Task 1: move the lazy `## \`resolveValue\` — canonical coercion contract` section body (~1,270 B, read only by `bin/lib` authors) to `_shared/policy-schema-coverage.md` (37,231 B), leaving a one-line stub under the same heading. The expected result is about 51,560 B (about 940 B headroom). Other files: `step-14-cloud-routine-parity.md` is 29,966 B and `routine/fleet.md` is 33,501 B, both far from the rail.
- Prose tests (quoted from `skill-prose-conformance-tests`): read markdown via `tests/helpers/read-skill.js`'s `readText()`. A mutated-text control asserts `assert.notEqual(mutated, original)` and `assert.throws(() => helper(mutated), { message: … })` matched to that assertion's own message. Fence extraction uses `\r?\n`. Select a branch's own paragraph before matching inside it. Never compare a skill's bytes against a literal. Import `RAIL_BYTES` if needed.
- Every edit is in place. Don't reformat adjacent prose. Commit messages are `{Verb} {what} — {detail}` with `refs #4847`, ending with the `Claude-Session:` trailer.

## Review Focus

1. The user-level `~/.claude/settings.json#enabledPlugins` almost always lists `claude-tweaks@claude-tweaks-marketplace`. Step 14's mirror-candidate rule would then re-add it as a mirror at `false`. The opt-out must exclude it from mirror candidates explicitly (Task 2, pinned).
2. A malformed value (`off`, `no`, `False`) resolves `true` (declared) with `invalid: true`. The doc row states it and a CLI test pins it (Task 1).
3. At `false`, a project that already carries a claude-tweaks entry keeps it: the non-destructive merge never removes it. Pinned sentence (Task 2).
4. At `false` with `superpowers` undeclared or the setup script missing, the fleet check still takes its gap prompt (Task 3, pinned).
5. An idempotent re-run at `false` with only superpowers declared reports "already configured" and doesn't prompt (Task 2, pinned).

---

### Task 1: Register `declare-claude-tweaks` and document it

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (new row directly after the `creative-survey` row, line ~167)
- Modify: `tests/policy-schema.test.js:147-148` (count 98 → 99, plus a `// 98 -> 99, #4847: …` comment line above it)
- Modify: `plugin/skills/_shared/policy-schema.md` (new `Additional levers` row after `creative-survey`; the `resolveValue` section body is replaced by a stub)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md` (append the moved section verbatim; extend the line-1 comment to name it)
- Modify: `plugin/skills/init/policy-review.md:20` (repoint the citation to `_shared/policy-schema-coverage.md`)
- Modify: `.claude-tweaks/policy.yml` (append `declare-claude-tweaks: false`; this repo removed its declaration on purpose in PR #4841)
- Create: `tests/declare-claude-tweaks-opt-out.test.js`

**Interfaces:**
- Produces: the `POLICY_KEYS` row `{ key: 'declare-claude-tweaks', type: 'boolean', default: true, summary: "When false, /init stops declaring claude-tweaks in committed project settings and the cloud setup script; superpowers stays.", category: 'housekeeping', tier: 'advanced' }`, read as `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values declare-claude-tweaks`. It produces the test file the next tasks append to, with its `ROOT` and `readText` imports at the top.

- [ ] **Step 1: Write the failing tests** in `tests/declare-claude-tweaks-opt-out.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');
const { POLICY_KEYS, resolveValue } = require('../plugin/bin/lib/policy-schema');

const ROOT = path.join(__dirname, '..');
const RESOLVER = path.join(ROOT, 'plugin', 'bin', 'resolve-policy.js');

function resolveIn(policyText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'declare-ct-'));
  if (policyText !== null) {
    fs.mkdirSync(path.join(dir, '.claude-tweaks'));
    fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), policyText);
  }
  return execFileSync(process.execPath, [RESOLVER, '--values', 'declare-claude-tweaks'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

test('AC1.2: declare-claude-tweaks is a boolean row defaulting true', () => {
  const row = POLICY_KEYS.find((r) => r.key === 'declare-claude-tweaks');
  assert.ok(row, 'declare-claude-tweaks missing from POLICY_KEYS');
  assert.strictEqual(row.type, 'boolean');
  assert.strictEqual(row.default, true);
  assert.strictEqual(row.tier, 'advanced');
  assert.strictEqual(resolveValue('declare-claude-tweaks', undefined), true);
});

test('AC1.2: unset resolves true, false resolves false, malformed resolves true', () => {
  assert.strictEqual(resolveIn(null), 'true');
  assert.strictEqual(resolveIn('declare-claude-tweaks: false\n'), 'false');
  assert.strictEqual(resolveIn('declare-claude-tweaks: off\n'), 'true');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/declare-claude-tweaks-opt-out.test.js`
Expected: FAIL with "declare-claude-tweaks missing from POLICY_KEYS"

- [ ] **Step 3: Implement.** Add the row, using the exact `summary` from Interfaces. Bump both `98` literals in `tests/policy-schema.test.js` to `99`, with the comment `// 98 -> 99, #4847: declare-claude-tweaks — boolean, default true — false stops /init Step 14 declaring claude-tweaks at project scope`. Add this exact doc row after `creative-survey` in `policy-schema.md`'s Additional levers table:

  `` | `declare-claude-tweaks` | `policy.yml` | `/claude-tweaks:init` (Step 14), `/claude-tweaks:routine` (`fleet on` Step 2) | `true` | `false` keeps claude-tweaks out of the committed `.claude/settings.json` (`enabledPlugins` and the `claude-tweaks-marketplace` entry) and out of `scripts/claude-cloud-setup.sh`, for a project that relies on a user-scope install. `superpowers@claude-plugins-official` stays required, and the fleet check reports the missing declaration as information rather than a gap. Unset, and any value other than `true`/`false`, resolve `true` |``

  Move the `resolveValue` section body (from the paragraph starting `` `bin/lib/policy-schema.js` also exports `resolveValue(key, rawValue)` `` through `…rather than re-deriving its own\nparsing.`) verbatim under a new `` ## `resolveValue` — canonical coercion contract `` heading at the end of `policy-schema-coverage.md`. Leave this under the original heading in `policy-schema.md`: `` Moved to `_shared/policy-schema-coverage.md`'s section of the same name (#4847, rail headroom). Cite that file, not this stub. `` Repoint `policy-review.md:20` to `` see `_shared/policy-schema-coverage.md` ``. Append `declare-claude-tweaks: false` to `.claude-tweaks/policy.yml`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/declare-claude-tweaks-opt-out.test.js tests/policy-schema.test.js tests/policy-schema-metadata.test.js tests/policy-key-naming.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS (all). Then `wc -c plugin/skills/_shared/policy-schema.md` prints less than 52500.

- [ ] **Step 5: Commit** `Add declare-claude-tweaks policy key — opt out of project-scope claude-tweaks declaration, refs #4847`

### Task 2: `/init` Step 14 honors the key

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/init/bootstrap/step-14-cloud-routine-parity.md` (Detect line 17, the Present follow-up paragraph line 26, Apply line 28, template lines 46-47, 74-76, 84 and 95-96, the post-template paragraph line 227, Idempotency line 282)
- Modify: `plugin/skills/init/SKILL.md:417` (the "Hand-editing `scripts/claude-cloud-setup.sh`" Anti-Patterns row)
- Test: `tests/declare-claude-tweaks-opt-out.test.js` (append)

**Interfaces:**
- Consumes: the key and read command from Task 1.
- Produces: the `# (authoring:` note prefix and the markers `# (authoring: begin claude-tweaks declaration` and `# (authoring: end claude-tweaks declaration)`, which the test's `renderTemplate` relies on. Plain `# (` comments are real script comments (`# (claude-tweaks #129: …` at line 106 and `# (/stories, …` at line 217 both ship in the generated script), so only the `# (authoring:` prefix marks a note.

Exact copy to insert (tests pin these literals; copy them from here):

- A new paragraph immediately before `**Detect.**`: `` **Opt-out.** Resolve `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values declare-claude-tweaks` once, before reading either settings file. `true` (the default, and what an unset or malformed value resolves to) keeps everything below as written. `false` means this project relies on a user-scope install of claude-tweaks: `superpowers@claude-plugins-official` is then this step's only hard requirement, and `claude-tweaks@claude-tweaks-marketplace` is no candidate of any kind — exclude it from the mirror candidates too, since the user-level file almost always lists it. ``
- In Detect, after "are this step's two hard requirements", insert ` (one — superpowers — under the Opt-out above)`.
- Appended to the paragraph after the Present option list (the one starting "When there are zero mirror candidates"): `` Under `declare-claude-tweaks: false`, every "claude-tweaks + superpowers" and "claude-tweaks and superpowers" phrase in the options above, and "the two hard deps" and "the two candidates that are always-included" in this paragraph, read as superpowers alone. ``
- At the end of the Apply paragraph's first sentence group, before the JSON fence's lead-in, insert: `` Under `declare-claude-tweaks: false`, add only `superpowers@claude-plugins-official: true` (plus the selected mirrors) and skip the `claude-tweaks-marketplace` entry below — never add or re-add either claude-tweaks entry. An entry the project already carries stays as it is, per the non-destructive merge; removing it is the maintainer's edit, not this step's. ``
- In the template: (a) restyle the two existing authoring notes in place, `# (one additional \`claude plugin marketplace add …` (line 84) → `# (authoring: one additional \`claude plugin marketplace add …` and `# (one additional spec appended …` (line 96) → `# (authoring: one additional spec appended …`. Rewrap their continuation lines only if a line exceeds the neighbors' width. (b) Add these lines: directly above `claude plugin marketplace add thn-inc/claude-tweaks-marketplace …`, `# (authoring: begin claude-tweaks declaration — omit through the matching end note when declare-claude-tweaks resolves false)`; directly below the `|| echo … claude-tweaks-marketplace …` continuation line, `# (authoring: end claude-tweaks declaration)`; directly below `PLUGIN_SPECS=…`, before the restyled line-96 note, `# (authoring: when declare-claude-tweaks resolves false, drop claude-tweaks@claude-tweaks-marketplace from PLUGIN_SPECS)`. (c) After the header's `# customize by changing enabledPlugins/extraKnownMarketplaces instead, then re-run /init.` line (line 47), add the emitted comment line `# declare-claude-tweaks: false in .claude-tweaks/policy.yml leaves claude-tweaks out of this script.`
- Appended to the paragraph starting "Write this to `scripts/claude-cloud-setup.sh`": `` Every `# (authoring: …)` note in the template is an authoring note, never written into the generated script; every other comment, `# (claude-tweaks #129: …` included, is written as it stands. Under `declare-claude-tweaks: false`, also omit the lines between the begin and end claude-tweaks declaration notes, and drop `claude-tweaks@claude-tweaks-marketplace` from `PLUGIN_SPECS`, so the generated script carries no `claude-tweaks-marketplace` line. That holds even when the project's `.claude/settings.json` still carries a kept claude-tweaks entry: the key, not the entry, decides what the script installs. ``
- In `init/SKILL.md:417`, replace `` Regenerated on every `/init` run from `.claude/settings.json` `` with `` Regenerated on every `/init` run from `.claude/settings.json` (and `declare-claude-tweaks`) ``.
- In Idempotency, replace "already declares both hard deps" with `` already declares every hard requirement (both, or superpowers alone under `declare-claude-tweaks: false`) ``.

- [ ] **Step 1: Write the failing tests** (append). The helper and the assertions:

```js
const STEP14 = readText(path.join(ROOT, 'plugin', 'skills', 'init', 'bootstrap', 'step-14-cloud-routine-parity.md'));
const collapse = (s) => s.replace(/\s+/g, ' ');

function extractTemplate(md) {
  const m = md.match(/```bash\r?\n(#!\/usr\/bin\/env bash[\s\S]*?)\r?\n```/);
  assert.ok(m, 'setup-script template fence not found');
  return m[1];
}

// Renders the template the way Step 14's prose says to: optedOut drops the bracketed
// declaration region and the PLUGIN_SPECS entry; both modes drop every `# (authoring: …)`
// note (a note may wrap: it runs through the first line ending in `)`). Plain `# (` comments
// are real script comments and stay.
function renderTemplate(template, { optedOut }) {
  let lines = template.split(/\r?\n/);
  if (optedOut) {
    const begin = lines.findIndex((l) => l.startsWith('# (authoring: begin claude-tweaks declaration'));
    const end = lines.findIndex((l) => l === '# (authoring: end claude-tweaks declaration)');
    assert.ok(begin !== -1 && end > begin, 'claude-tweaks declaration markers missing');
    lines = [...lines.slice(0, begin), ...lines.slice(end + 1)];
  }
  const out = [];
  let inNote = false;
  for (const l of lines) {
    if (!inNote && l.startsWith('# (authoring:')) inNote = !l.trimEnd().endsWith(')');
    else if (inNote) inNote = !l.trimEnd().endsWith(')');
    else out.push(optedOut && l.startsWith('PLUGIN_SPECS=') ? l.replace('claude-tweaks@claude-tweaks-marketplace ', '') : l);
  }
  return out.join('\n');
}
```

Tests, named with their AC ids:
- `AC1.1: default render keeps both claude-tweaks marketplace lines, both specs and the real script`: the render with `optedOut: false` includes `claude plugin marketplace add thn-inc/claude-tweaks-marketplace`, `claude plugin marketplace update claude-tweaks-marketplace`, the line `PLUGIN_SPECS="claude-tweaks@claude-tweaks-marketplace superpowers@claude-plugins-official"`, `VERDICT=$(node -e`, `npm install -g @playwright/cli`, `# (claude-tweaks #129:` and `# (/stories, /visual-review,`. No line starts with `# (authoring:`, and no line starts with `# a matching` or `# enabledPlugins lists them` (the wrapped note continuations, which must go with their note).
- `Review Focus (render keeps real comments) go-red`: the same render assertions as a shared helper `assertDefaultRender(render)`. On a copy of the template where `# (claude-tweaks #129:` is rewritten to `# (authoring: claude-tweaks #129:`, assert `notEqual` and assert `assertDefaultRender(renderTemplate(copy, { optedOut: false }))` throws with its own message `default render lost a real script line`.
- `AC2.1/AC2.2: opted-out render has no claude-tweaks-marketplace line`: `assertOptedOut(render)` asserts `!render.includes('claude-tweaks-marketplace')` (message `opted-out render still names claude-tweaks-marketplace`), that `PLUGIN_SPECS="superpowers@claude-plugins-official"` is a line, that the `claude-plugins-official` add/update lines remain, and that no line ending in `\` is followed by a line that doesn't start with whitespace. Run it on `renderTemplate(extractTemplate(STEP14), { optedOut: true })`.
- `AC2.2 go-red: the render keeps the region without its end marker`: drop the `# (authoring: end claude-tweaks declaration)` line from the template string, assert `notEqual`, and assert `renderTemplate(…, { optedOut: true })` throws `{ message: /claude-tweaks declaration markers missing/ }`.
- `AC2.1: Apply never adds or re-adds claude-tweaks under the opt-out`: `collapse(STEP14)` includes the Apply sentence and the "stays as it is" sentence verbatim from the copy above. Also the script paragraph's "so the generated script carries no `claude-tweaks-marketplace` line" and "the key, not the entry, decides what the script installs".
- `Present follow-up reads superpowers alone under the opt-out`: `collapse(STEP14)` includes `"the two candidates that are always-included" in this paragraph, read as superpowers alone`.
- `AC4.1 / Review Focus 1: Opt-out keeps superpowers and excludes claude-tweaks from mirrors`: select the paragraph starting `**Opt-out.**` (blank-line split), then assert it contains `` is then this step's only hard requirement `` and `exclude it from the mirror candidates too`.
- `Review Focus 5: idempotent re-run counts superpowers alone as complete`: `collapse(STEP14)` includes `` already declares every hard requirement (both, or superpowers alone under `declare-claude-tweaks: false`) ``.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/declare-claude-tweaks-opt-out.test.js`
Expected: FAIL with "claude-tweaks declaration markers missing"

- [ ] **Step 3: Apply the exact copy above to `step-14-cloud-routine-parity.md`.**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/declare-claude-tweaks-opt-out.test.js tests/cloud-setup-drift-check.test.js tests/agent-browser-retirement-conformance.test.js tests/session-tmp-root-migration.test.js tests/skill-fence-guard-shapes.test.js tests/guard-refusals/shapes.test.js`
Expected: PASS (all)

- [ ] **Step 5: Commit** `Honor declare-claude-tweaks in /init Step 14 — skip the claude-tweaks declaration and setup-script lines when false, refs #4847`

### Task 3: `/routine` fleet check honors the key

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/routine/fleet.md` (Step 2 item 1, line 73; item 4, line 80; Step 5's `### Cloud parity` line, line 131)
- Test: `tests/declare-claude-tweaks-opt-out.test.js` (append)

**Interfaces:**
- Consumes: the key and read command from Task 1.

Exact copy:
- Appended to Step 2 item 1: `` First resolve `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values declare-claude-tweaks`. At `true` (the default) the check is as written. At `false`, only `superpowers@claude-plugins-official` must be declared — a missing claude-tweaks declaration is no gap and never reaches item 3's prompt. When claude-tweaks is in fact undeclared, print this line instead (it prints whatever items 2-3 find), and on a gap append it to the summary's "Gap acknowledged" line: `Cloud parity: claude-tweaks is not declared at project scope (declare-claude-tweaks: false), so cloud firings in this project will not have claude-tweaks installed by the project declaration.` ``
- In item 4, replace `Both checks passing is a silent pass-through — no prompt, proceed to Step 3.` with `` Both checks passing is a silent pass-through — no prompt, proceed to Step 3; only item 1's opt-out line prints, when it applies. ``
- In Step 5's `### Cloud parity` alternatives, add a new quoted alternative after the first: `"OK — superpowers declared, setup script present; claude-tweaks not declared (declare-claude-tweaks: false), so cloud firings will not have claude-tweaks installed by the project declaration."`

- [ ] **Step 1: Write the failing tests** (append):
- `AC3.1/AC3.2: opted-out fleet check prints the informational line naming the cloud consequence`: slice `fleet.md` from `## Step 2 — Cloud-parity honesty check` to `## Step 3 —`, assert both anchors resolve (`!== -1`), and assert the slice, whitespace-collapsed, includes the exact backticked print line above. A missing anchor is asserted with message `fleet Step 2 anchors missing`.
- `AC3.1: a missing claude-tweaks declaration is no gap under the opt-out`: the slice includes `a missing claude-tweaks declaration is no gap and never reaches item 3's prompt`, `When claude-tweaks is in fact undeclared, print this line instead` and `` only item 1's opt-out line prints, when it applies ``. Step 5's block includes `"OK — superpowers declared, setup script present; claude-tweaks not declared (declare-claude-tweaks: false)`.
- `AC4.1 / Review Focus 4: superpowers stays required and gaps still prompt`: the slice includes `` only `superpowers@claude-plugins-official` must be declared `` and still includes `If either check fails, report the specific gap`.
- `AC3.2 go-red`: strip the print line from the live text, assert `notEqual`, and assert the shared helper `assertFleetOptOut(text)` throws with its own message `fleet opt-out print line missing`. Factor the first test's assertions into `assertFleetOptOut`.
- `AC1.1: default fleet path unchanged`: the slice still includes `` confirm `claude-tweaks@claude-tweaks-marketplace` and `superpowers@claude-plugins-official` are both declared `` and `Both checks passing is a silent pass-through`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/declare-claude-tweaks-opt-out.test.js`
Expected: FAIL with "fleet opt-out print line missing"

- [ ] **Step 3: Apply the exact copy above to `fleet.md`.**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/declare-claude-tweaks-opt-out.test.js tests/routine-fleet-status-off.test.js tests/routine-fleet-security-hardening.test.js tests/routine-webhook-trigger.test.js tests/routine-pause-resume.test.js tests/backlog-refine-headless.test.js`
Expected: PASS (all)

- [ ] **Step 5: Commit** `Honor declare-claude-tweaks in the fleet parity check — report, not fail, when opted out, refs #4847`

## Spec coverage

| Clause | Task |
|---|---|
| AC1.1 | Task 2 (default render), Task 3 (default fleet path) |
| AC1.2 | Task 1 (row default, CLI unset) |
| AC2.1 | Task 2 (Apply sentences, opted-out render) |
| AC2.2 | Task 2 (render against the template text, plus go-red) |
| AC3.1 | Task 3 |
| AC3.2 | Task 3 (wording pin, plus go-red) |
| AC4.1 | Task 2 (opted-out PLUGIN_SPECS, Opt-out paragraph), Task 3 |
| AC5.1 | Common Step 5 full verification (`verify.js`) |
