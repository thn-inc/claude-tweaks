# Design-Ceremony Brainstorming Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/claude-tweaks:specify`'s three `/superpowers:brainstorming` invocation sites a way to ask brainstorming's Architectural path to consolidate its per-section approvals into one block once the decision-carrying questions are answered, gated by a new static policy key, and document the existing ad-hoc "just go" override as a sanctioned convention.

**Architecture:** A new enum policy key (`design-ceremony`) resolves once per invocation via the existing `bin/resolve-policy.js`. A new pure-function module (`bin/lib/specify/brainstorming-ceremony.js`) plus a thin CLI wrapper (`bin/compose-brainstorm-args.js`) composes the `/superpowers:brainstorming` Skill-tool `args` string — prepending a fixed consolidation sentence when the resolved value is `fast-lane`, passing the input through byte-identical otherwise. `specify/SKILL.md`'s three call sites (and a new small sub-file, `specify/brainstorming-ceremony.md`, holding the full procedure) cite this composition instead of restating it three times — `specify/SKILL.md` is already at 37522 bytes against a 40960-byte ceiling (`plugin/bin/lib/skill-audit/context-cost.js`'s `CEILING_BYTES`), 658 bytes past the file's own 90% warn threshold, so new prose there is kept to short citations and the bulk goes in the new sub-file.

**Tech Stack:** Node.js (`node --test`), no new runtime dependencies.

**Spec:** `.claude-tweaks/pipelines/archive/2026-09-12T165655-record-1886/work/1886-spec.md` (archived; materialized from GitHub issue #1886)

## Global Constraints

- Do not name the new key `ceremony-profile` or anything that reads as an alias of the existing diff-derived per-run concept (`plugin/skills/_shared/ceremony-profile.md`) — they are genuinely different mechanisms (spec's Gotchas section).
- The consolidation instruction must never claim to skip brainstorming's own final approval gate — it only reduces *how many times* mid-design approval is asked, never *whether* (spec's Overview).
- Every policy key is flat kebab-case, `^[a-z0-9]+(-[a-z0-9]+)*$` (`tests/policy-key-naming.test.js`).
- `specify/SKILL.md` is close to `context-cost.js`'s 40960-byte per-file ceiling (37522 bytes on the merge base = 91.6%, already past the file's own 90% warn threshold) — new prose there must be short citations (Task 3 budgets ≤ 600 bytes total across both edited sites), with the full procedure living in the new `specify/brainstorming-ceremony.md` sub-file instead.
- `plugin/skills/_shared/policy-schema.md` is even tighter: 39494 bytes on the merge base, 1466 bytes of headroom against the same 40960 ceiling (confirmed via `plan-audit.js`). Task 1's new table row measures 802 bytes — it fits (leaving ~664 bytes headroom afterward), but do not pad or restate its Meaning column; a future addition to this file has very little room left and may need to split it first.
- Commit tests only where this plan asks for them, sized like the neighboring test files in each touched directory; scratch checks stay scratch. Touch only what each task requires.

---

### Task 1: Add the `design-ceremony` policy key

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (add one `POLICY_KEYS` entry, near the other `pipeline-behavior`/`advanced` enum entries — e.g. immediately after the `merge-authorization` entry at line 54)
- Modify: `plugin/skills/_shared/policy-schema.md` (add one row under `## Auto-mode levers`, after the `specify-auto-continue` row at line 191)
- Test: none new — `tests/policy-schema-metadata.test.js`, `tests/policy-key-naming.test.js`, `tests/resolve-policy-cli.test.js`, and `tests/resolve-policy-lib.test.js` already iterate every `POLICY_KEYS` entry generically (confirmed: `tests/resolve-policy-cli.test.js`'s `'--all': emits every schema key...'` test derives `expectedKeys` from `POLICY_KEYS.map((row) => row.key)` and asserts every field on every row) — this is Acceptance Criterion 1's own verification mechanism, not a gap to fill.

**Interfaces:**
- Produces: the policy key `design-ceremony` (values `fast-lane` | `standard`, default `standard`), resolvable via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" design-ceremony` — Task 2 and Task 3 both read this value.

- [ ] **Step 1: Add the schema entry and its documentation row together**

This task has no new test of its own — it is verified entirely by the existing generic suites named below — so, unlike Task 2/3, its schema edit and doc edit land in one step rather than a separate red/green pair (a standalone "run the naming test, expect FAIL" checkpoint between them would only hold once this step's own edit has already landed, which a pre-dispatch, read-only audit of the *unedited* tree cannot reflect).

In `plugin/bin/lib/policy-schema.js`, immediately after the `merge-authorization` entry (currently ending `category: 'merge-safety', tier: 'advanced' },` around line 54), insert:

```js
  { key: 'design-ceremony', type: 'enum', values: ['fast-lane', 'standard'], default: 'standard', summary: "Trims /specify's brainstorming handoff to fewer per-section approval stops once the design approach is chosen.", category: 'pipeline-behavior', tier: 'advanced' },
```

(The summary is 106 characters, under the 140-char test ceiling, and does not contain the string `design-ceremony`.)

In `plugin/skills/_shared/policy-schema.md`, under `## Auto-mode levers`, immediately after the `specify-auto-continue` row (line 191), insert:

```markdown
| `design-ceremony` | `policy.yml` — no run dir exists at the check point (brainstorming completes before any pipeline run starts, same timing as `specify-auto-continue` above) | `/claude-tweaks:specify` (its three `/superpowers:brainstorming` invocation sites) | `standard` | `fast-lane`/`standard` — on `fast-lane`, `/specify` prepends one consolidation sentence to the `/superpowers:brainstorming` Skill-tool call's `args`, asking the Architectural path to present its remaining design sections as one consolidated block once the decision-carrying questions are answered and the approach is chosen, instead of gating each section — brainstorming's own final approval gate is never removed. Composed via `bin/compose-brainstorm-args.js`; full procedure in `specify/brainstorming-ceremony.md` |
```

- [ ] **Step 2: Run the schema/doc tests**

Run: `node --test tests/policy-schema-metadata.test.js tests/policy-key-naming.test.js tests/resolve-policy-cli.test.js tests/resolve-policy-lib.test.js`
Expected: PASS — all four suites green, `design-ceremony` now appears in `--all` output with `value: 'standard', source: 'default'` on a fixture with no policy override.

- [ ] **Step 3: Commit**

```bash
git add plugin/bin/lib/policy-schema.js plugin/skills/_shared/policy-schema.md
git commit -m "Add design-ceremony policy key for the brainstorming handoff

refs #1886"
```

---

### Task 2: Composition module + CLI + tests (Acceptance Criteria 2 and 3)

**Files:**
- Create: `plugin/bin/lib/specify/brainstorming-ceremony.js`
- Create: `plugin/bin/compose-brainstorm-args.js`
- Test: `tests/bin-lib/specify/brainstorming-ceremony.test.js`
- Test: `tests/compose-brainstorm-args-cli.test.js`

**Interfaces:**
- Consumes: nothing from Task 1 at the code level (the CLI takes `--design-ceremony <value>` as a plain string argument — the *resolution* of that value from policy happens in prose at Task 3's call sites, not inside this module).
- Produces:
  - `composeBrainstormingArgs(input: string, designCeremony: string): string` — exported from `plugin/bin/lib/specify/brainstorming-ceremony.js`. Returns `input` unchanged unless `designCeremony === 'fast-lane'`, in which case it returns `` `${CONSOLIDATION_SENTENCE}\n\n${input}` ``.
  - `CONSOLIDATION_SENTENCE: string` — exported from the same module; the fixed instruction text.
  - `run(argv: string[], deps): number` — exported from `plugin/bin/compose-brainstorm-args.js`, the CLI's argv-to-exit-code function, mirroring `plugin/bin/resolve-blockers.js`'s `run(argv, deps)` shape. `deps` has `{ readFile, stdout, stderr }`.
  - CLI usage: `compose-brainstorm-args.js --design-ceremony <value> --input-file <path> [--help]` — prints the composed string to stdout, exit 0. Exit 2 on a malformed invocation (missing/unknown flag, unreadable `--input-file`).

- [ ] **Step 1: Write the failing tests for `composeBrainstormingArgs`**

Create `tests/bin-lib/specify/brainstorming-ceremony.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { composeBrainstormingArgs, CONSOLIDATION_SENTENCE } = require('../../../plugin/bin/lib/specify/brainstorming-ceremony');

test('fast-lane prepends the consolidation sentence, separated by a blank line', () => {
  const result = composeBrainstormingArgs('Record #142: some title\n\nSome body text.', 'fast-lane');
  assert.equal(result, `${CONSOLIDATION_SENTENCE}\n\nRecord #142: some title\n\nSome body text.`);
});

test('standard leaves the input byte-identical', () => {
  const input = 'Record #142: some title\n\nSome body text.';
  assert.equal(composeBrainstormingArgs(input, 'standard'), input);
});

test('an unset/unknown value also leaves the input byte-identical (fail-safe: only the literal fast-lane triggers the prefix)', () => {
  const input = 'a bare topic string';
  assert.equal(composeBrainstormingArgs(input, undefined), input);
  assert.equal(composeBrainstormingArgs(input, ''), input);
  assert.equal(composeBrainstormingArgs(input, 'not-a-real-value'), input);
});

test('CONSOLIDATION_SENTENCE never claims to skip the final approval gate', () => {
  assert.ok(!/skip|remove|bypass/i.test(CONSOLIDATION_SENTENCE), 'consolidation sentence must not claim to skip/remove/bypass any approval gate');
  assert.match(CONSOLIDATION_SENTENCE, /approval/i);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/specify/brainstorming-ceremony.test.js`
Expected: FAIL with "Cannot find module '../../../plugin/bin/lib/specify/brainstorming-ceremony'"

- [ ] **Step 3: Write the module**

Create `plugin/bin/lib/specify/brainstorming-ceremony.js`:

```js
'use strict';
// bin/lib/specify/brainstorming-ceremony.js — pure composition logic behind
// bin/compose-brainstorm-args.js. Prepends a fixed consolidation-instruction
// sentence to /specify's `/superpowers:brainstorming` Skill-tool `args` text
// when the `design-ceremony` policy key (skills/_shared/policy-schema.md)
// resolves `fast-lane`; any other value (including `standard`, unset, or
// unrecognized) returns the input unchanged, byte-for-byte — record #1886's
// Acceptance Criterion 3. Full call-site procedure lives in
// skills/specify/brainstorming-ceremony.md; this module owns only the
// string composition, not the policy resolution.

const CONSOLIDATION_SENTENCE = 'Ceremony: fast-lane for this session — once the decision-carrying clarifying questions are answered and the approach is chosen, present the remaining design sections as one consolidated block rather than gating each section individually; the single approval point is the post-write spec review.';

// composeBrainstormingArgs(input, designCeremony) -> string
// `input` is exactly what would otherwise be passed as the
// `/superpowers:brainstorming` Skill tool call's `args` (a record's
// title+body, or a bare topic string). `designCeremony` is the resolved
// `design-ceremony` policy value. Only the literal string 'fast-lane'
// triggers the prefix — everything else (including 'standard', undefined,
// or a typo) passes `input` through unchanged.
function composeBrainstormingArgs(input, designCeremony) {
  if (designCeremony !== 'fast-lane') return input;
  return `${CONSOLIDATION_SENTENCE}\n\n${input}`;
}

module.exports = { composeBrainstormingArgs, CONSOLIDATION_SENTENCE };
```

- [ ] **Step 4: Run the module test to verify it passes**

Run: `node --test tests/bin-lib/specify/brainstorming-ceremony.test.js`
Expected: PASS (4/4)

- [ ] **Step 5: Write the failing CLI tests**

Create `tests/compose-brainstorm-args-cli.test.js`:

```js
'use strict';
// tests/compose-brainstorm-args-cli.test.js — in-process tests for
// bin/compose-brainstorm-args.js's run(argv, deps), mirroring
// tests/resolve-blockers-cli.test.js's deps-injection style (no real
// filesystem I/O; a fake readFile stands in for --input-file).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../plugin/bin/compose-brainstorm-args');
const { CONSOLIDATION_SENTENCE } = require('../plugin/bin/lib/specify/brainstorming-ceremony');

function fakeDeps(overrides = {}) {
  const calls = { stdout: [], stderr: [] };
  return {
    calls,
    readFile: () => 'a bare topic string',
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
    ...overrides,
  };
}

test('--help prints usage, exit 0', () => {
  const deps = fakeDeps();
  const code = run(['--help'], deps);
  assert.equal(code, 0);
  assert.match(deps.calls.stdout.join(''), /usage: compose-brainstorm-args\.js/);
});

test('missing --design-ceremony is malformed — exit 2', () => {
  const deps = fakeDeps();
  const code = run(['--input-file', 'x.txt'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /missing --design-ceremony/);
});

test('missing --input-file is malformed — exit 2', () => {
  const deps = fakeDeps();
  const code = run(['--design-ceremony', 'standard'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /missing --input-file/);
});

test('unknown flag is malformed — exit 2', () => {
  const deps = fakeDeps();
  const code = run(['--bogus'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /unknown argument/);
});

test('an unreadable --input-file is malformed — exit 2', () => {
  const deps = fakeDeps({ readFile: () => { throw new Error('ENOENT: no such file'); } });
  const code = run(['--design-ceremony', 'standard', '--input-file', 'missing.txt'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /could not read --input-file/);
});

test('fast-lane composes the consolidation sentence onto stdout, exit 0', () => {
  const deps = fakeDeps({ readFile: () => 'Record #142: some title\n\nSome body.' });
  const code = run(['--design-ceremony', 'fast-lane', '--input-file', 'spec.txt'], deps);
  assert.equal(code, 0);
  assert.equal(deps.calls.stdout.join(''), `${CONSOLIDATION_SENTENCE}\n\nRecord #142: some title\n\nSome body.`);
});

test('standard passes the input through byte-identical on stdout, exit 0', () => {
  const deps = fakeDeps({ readFile: () => 'a bare topic string' });
  const code = run(['--design-ceremony', 'standard', '--input-file', 'topic.txt'], deps);
  assert.equal(code, 0);
  assert.equal(deps.calls.stdout.join(''), 'a bare topic string');
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `node --test tests/compose-brainstorm-args-cli.test.js`
Expected: FAIL with "Cannot find module '../plugin/bin/compose-brainstorm-args'"

- [ ] **Step 7: Write the CLI**

Create `plugin/bin/compose-brainstorm-args.js`:

```js
#!/usr/bin/env node
// bin/compose-brainstorm-args.js — thin CLI wrapper over
// bin/lib/specify/brainstorming-ceremony.js's composeBrainstormingArgs,
// mirroring bin/resolve-blockers.js's argument-parsing/deps-injection
// shape. /claude-tweaks:specify's three `/superpowers:brainstorming`
// invocation sites (skills/specify/brainstorming-ceremony.md) run this
// once, after resolving `design-ceremony` via bin/resolve-policy.js, to
// compose the exact `args` text for the Skill tool call, so the
// composition itself is mechanized rather than re-derived by prose at
// each site (#1886). Zero runtime npm deps, shells out to nothing.
//
// Usage: compose-brainstorm-args.js --design-ceremony <value> --input-file <path> [--help]
// Reads the file at --input-file (the record's title+body, or the bare
// topic string, exactly as it would otherwise be passed to the Skill
// tool's `args`) and prints the composed string to stdout, unchanged
// unless --design-ceremony is literally 'fast-lane'. Exit 0 on success;
// 2 on a malformed invocation (missing/unknown flag, or an unreadable
// --input-file). Any --design-ceremony value other than 'fast-lane'
// (including 'standard', a typo, or an empty string) is accepted and
// passes the input through unchanged — composeBrainstormingArgs's own
// fail-safe, not a validation error, so this CLI never rejects on the
// enum value itself.
'use strict';

const fs = require('fs');
const { composeBrainstormingArgs } = require('./lib/specify/brainstorming-ceremony');

const USAGE = 'usage: compose-brainstorm-args.js --design-ceremony <value> --input-file <path> [--help]\n';

function parseArgs(argv) {
  const opts = { designCeremony: null, inputFile: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { opts.help = true; }
    else if (a === '--design-ceremony') {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) return { error: 'missing value for --design-ceremony' };
      opts.designCeremony = v;
      i++;
    } else if (a === '--input-file') {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) return { error: 'missing value for --input-file' };
      opts.inputFile = v;
      i++;
    } else {
      return { error: `unknown argument: ${a}` };
    }
  }
  return opts;
}

const realDeps = {
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// argv -> exit code. All I/O through deps so tests never touch the real
// filesystem — same seam as bin/resolve-blockers.js's run(argv, deps).
function run(argv, deps = realDeps) {
  const opts = parseArgs(argv);
  if (opts.error) { deps.stderr(opts.error + '\n' + USAGE); return 2; }
  if (opts.help) { deps.stdout(USAGE); return 0; }
  if (!opts.designCeremony) { deps.stderr('missing --design-ceremony\n' + USAGE); return 2; }
  if (!opts.inputFile) { deps.stderr('missing --input-file\n' + USAGE); return 2; }

  let input;
  try {
    input = deps.readFile(opts.inputFile);
  } catch (err) {
    deps.stderr(`compose-brainstorm-args: could not read --input-file: ${err && err.message ? err.message : String(err)}\n`);
    return 2;
  }

  deps.stdout(composeBrainstormingArgs(input, opts.designCeremony));
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
```

- [ ] **Step 8: Run the CLI tests to verify they pass**

Run: `node --test tests/compose-brainstorm-args-cli.test.js`
Expected: PASS (7/7)

- [ ] **Step 9: Run the exit-code conformance test**

Run: `node --test tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS — the new CLI's `require.main === module` guard uses `process.exitCode`, never `process.exit`, so it needs no `ALLOWLIST` entry.

- [ ] **Step 10: Commit**

```bash
git add plugin/bin/lib/specify/brainstorming-ceremony.js plugin/bin/compose-brainstorm-args.js tests/bin-lib/specify/brainstorming-ceremony.test.js tests/compose-brainstorm-args-cli.test.js
git commit -m "Add composeBrainstormingArgs + compose-brainstorm-args.js CLI

refs #1886"
```

---

### Task 3: Wire /specify's three call sites and document the "just go" convention (Acceptance Criterion 4)

**Files:**
- Create: `plugin/skills/specify/brainstorming-ceremony.md`
- Modify: `plugin/skills/specify/SKILL.md` (case 1 at line 81, case 4 at line 89 — case 5 at line 90 already reads "see case 1 for the full procedure, not restated here" and needs no separate edit)

**Interfaces:**
- Consumes: `composeBrainstormingArgs`/`compose-brainstorm-args.js` from Task 2; `design-ceremony` from Task 1.
- Produces: nothing new for later tasks — this is the plan's last task.

- [ ] **Step 1: Write the sub-file**

Create `plugin/skills/specify/brainstorming-ceremony.md`:

```markdown
# Brainstorming Ceremony — design-ceremony handoff

Cited by `SKILL.md`'s cases 1, 4, and 5 (case 5 reads "see case 1 for the
full procedure" and inherits this by that existing pointer, so it carries
no separate citation of its own). Before invoking `/superpowers:brainstorming`
at any of those three sites:

1. Resolve the policy value — no `--run` flag, the same timing
   `specify-auto-continue` (`_shared/policy-schema.md`) already uses,
   since brainstorming completes before any pipeline run directory exists:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" design-ceremony
   ```

2. Write the exact text that would otherwise be passed as the Skill
   tool's `args` (case 1/5: the record's title + body; case 4: the bare
   topic string) to a temp file, then compose the actual `args` value:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/compose-brainstorm-args.js" \
     --design-ceremony "{resolved value}" --input-file "{temp file path}"
   ```

3. Pass that command's stdout, verbatim, as the `/superpowers:brainstorming`
   Skill tool call's `args`.

On `fast-lane`, the composed `args` gains one prepended sentence asking
brainstorming's Architectural path to present its remaining design
sections as one consolidated block once the decision-carrying clarifying
questions are answered and the approach is chosen — brainstorming's own
final approval gate (its `Do NOT invoke any implementation skill... until
approved` HARD-GATE) is never removed by this instruction; it only
reduces how many times mid-design approval is asked, never whether. On
`standard` (the default) or any other value, the composed `args` is
byte-identical to the record's title+body or topic string alone.

## The "just go" ad-hoc convention

Independent of the `design-ceremony` policy default, a user may say "just
go" (or similar) mid-brainstorm to ask for the same section-consolidation
for that single session only — this already works today as ordinary
LLM-instruction-following inside `/superpowers:brainstorming` itself, and
needs no code change; it is documented here so it is discoverable rather
than something a user finds only by trial. It applies equally to a
`/superpowers:brainstorming` session started standalone, outside any of
`/specify`'s three call sites above — this file's Step 1-3 procedure is
`/specify`'s own way of reaching the same effect by policy default, not
the only way to reach it.
```

- [ ] **Step 2: Edit case 1 (line 81) in `plugin/skills/specify/SKILL.md`**

Find the sentence (currently reading, in full, as one clause of the `needs:definition redirect` paragraph):

`invoke /superpowers:brainstorming (Skill tool) with the record's title + body as input, wait for the resulting design doc, then enter decomposition mode on that design doc`

Replace with:

`invoke /superpowers:brainstorming (Skill tool) with the record's title + body as input — composed per brainstorming-ceremony.md in this skill's directory (resolves design-ceremony and, on fast-lane, prepends a consolidation sentence; case 5 below cites this same procedure) — wait for the resulting design doc, then enter decomposition mode on that design doc`

(Use the Edit tool with the literal backtick-quoted Markdown text, including the `/superpowers:brainstorming` and `**decomposition mode**` inline-code/bold markers exactly as they appear in the current file — the snippets above are shown unescaped for readability only.)

- [ ] **Step 3: Edit case 4 (line 89) in `plugin/skills/specify/SKILL.md`**

Find the sentence:

`invoke superpowers /superpowers:brainstorming via the Skill tool with the topic as input (this is the polymorphic-input branch defined above).`

Replace with:

`invoke superpowers /superpowers:brainstorming via the Skill tool with the topic as input — composed per brainstorming-ceremony.md in this skill's directory (this is the polymorphic-input branch defined above).`

Then find the sentence immediately after (same paragraph, case 4's closing line):

`Do not prompt the user to "run brainstorm first" — that defeats the contract.`

Replace with:

`Do not prompt the user to "run brainstorm first" — that defeats the contract. A user may also say "just go" (or similar) mid-brainstorm to request the same section-consolidation for that session only, regardless of the design-ceremony default — see brainstorming-ceremony.md.`

- [ ] **Step 4: Verify byte headroom**

Run: `wc -c plugin/skills/specify/SKILL.md`
Expected: output under 40960 (the file grew by roughly 460 bytes from Steps 2-3, from 37522 to approximately 37982 — still comfortably under the ceiling and its own 90% warn line is already crossed pre-existing, unaffected by this small addition).

- [ ] **Step 5: Run the full suite**

Run: `npm test 2>&1 | tee /tmp/npm-test-1886.log; tail -40 /tmp/npm-test-1886.log`
Expected: PASS — all suites green, including the four Task-1 schema/doc tests, the two new Task-2 test files, and every pre-existing `tests/specify-*.test.js` suite (no prose-conformance test in that family pins the exact substrings edited in Step 2/3 above — confirmed by `grep -rln "with the record's title + body as input\|with the topic as input" tests/` returning no exact-substring match during plan authoring). A failure limited to `tests/impeccable-cli-contract.test.js` alone is the pre-existing, already-tracked #2314 environment issue (globally-installed `impeccable` CLI version drift) — unrelated to this diff; do not fix it inline, per the dispatch context's own note.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/specify/brainstorming-ceremony.md plugin/skills/specify/SKILL.md
git commit -m "Wire design-ceremony into /specify's brainstorming handoff, document 'just go'

refs #1886"
```

---

## Self-Review Notes (for the plan author to check before dispatch — not a task)

- **Spec coverage:** Task 1 → Deliverable 1 + Acceptance Criterion 1. Task 2 → Deliverable 3 (composition logic) + Acceptance Criteria 2/3. Task 3 → Deliverables 3 (call-site wiring)/4 (the "just go" doc) + Acceptance Criterion 4. Acceptance Criterion 5 (`npm test` passes) is Task 3 Step 5, the plan's final verification gate.
- **Placeholder scan:** no "TBD"/"add error handling"/"similar to Task N" language above; every step shows the actual file content or command.
- **Type consistency:** `composeBrainstormingArgs(input, designCeremony)` — same two-argument order and names in Task 2's Step 1 test, Step 3 module, and Task 2's Step 5 CLI test's expectations. `run(argv, deps)` — same shape as Task 2's Step 7 CLI and Step 5/6 tests.
