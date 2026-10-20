# Merge-Authorization vs. the Unattended Ceiling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle #2734 — the `autonomy` ceiling does **not** extend to `merge-authorization` (documented, with a code pin), and the gap the record names (default-`auto` `/flow` cannot pre-authorize its own merge without reopening the whole Manifesto gate) is closed by a new human-typed `/flow` token, `pre-authorize-merge`, that sets lever 13 for that one run.

**Architecture:** Deliverable 1 resolves to "keep merge out of the ceiling": the ceiling is a standing `policy.yml` value and `merge-authorization` is `policySourceExcluded` precisely so no standing default authorizes a merge; at `unattended`, `consoleAutoResolve` already merges every record a human granted `auto:merge`, and deriving `pre-authorized` from the ceiling would overturn `review-console.md`'s ungranted-member carve-out (#1802/#1966). Deliverable 3's middle ground is implemented: `pre-authorize-merge` is a `/flow` argument the Manifesto reads (precedence rung 1, source `arg`) and writes as `merge-authorization: pre-authorized`; wrap-up's existing Auto-merge short-circuit (`manifesto-authorized-merge.md`) then merges with no click, `merge-check` still applying. Deliverable 2 ("if extending") is therefore not built — `bookkeepingPermissions()` gains no key, only a comment and a test pinning that.

**Tech Stack:** Markdown skill prose, Node 18 `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T075412-record-2734/work/2734-spec.md`

## Global Constraints

- The token never comes from `policy.yml` and never from the `autonomy` ceiling — only a human typing it on the `/flow` invocation (or the existing `confirm`/`hybrid` override, unchanged).
- On a dispatch-bound run (`flow/SKILL.md` Step 1 rung 2: `run-state.json` `dispatched: true`) the token is ignored: lever 13 is written `ask` and one `SKIP` decision is logged. A dispatched record's merge authority stays its `auto:merge` label.
- Under `interactive` (no Manifesto) and on a multi-record run (its consolidated console never short-circuits — `auto-merge-short-circuit.md`'s `MULTISPEC_REVIEW_DEFER=1` exclusion) the token is a no-op, noted in the output the way `keep-going`'s single-target no-op is.
- `merge-check` (`assess-agent-autonomy`) still gates every merge the token authorizes — the token clears Authorization (Layer 1) only.
- `bookkeepingPermissions()`'s returned key set is unchanged (the existing exact-`deepEqual` tests in `tests/bin-lib/issues/autonomy.test.js` stay green as written).
- `plugin/skills/flow/SKILL.md` is 47102 bytes against `RAIL_BYTES` 52500 (89.7%); Task 2 adds roughly 750 bytes, crossing the 90% `nearCeiling` soft flag — acceptable (not a breach); keep the Arguments row to one sentence-group and put the rules in `manifesto.md`.
- Commit messages: `{Verb} {what} — {detail}`, body `refs #2734`, never `closes`/`fixes`.

## Review Focus

- A dispatch-originated `/flow` whose prompt somehow carries `pre-authorize-merge` — must resolve `ask` with a `SKIP` line, never `pre-authorized` (pinned by Task 2's manifesto-row assertion and the no-compose scan).
- An `unattended` project with no token and an `auto:build`-only record — must still park at `pending-review`, not merge (pinned by Task 1's resolver test: ceiling alone resolves `ask`).
- A skill or routine template that starts composing `/claude-tweaks:flow … pre-authorize-merge` itself — an agent originating its own merge authorization (pinned by Task 2's no-compose scan over all of `plugin/`).
- `confirm`/`hybrid` with the token — the Manifesto must pre-fill lever 13's Recommended value as `pre-authorized` yet still accept `13=ask` (stated in Task 2's manifesto row; the override machinery itself is unchanged, so no new test).
- A restatement of "only a live `confirm`/`hybrid` override sets it" left un-swept somewhere — would contradict the new token (Task 3's sweep with its grep).

---

### Task 1: Record the decision — no ceiling sets `merge-authorization`

**Files:**
- Modify: `plugin/skills/_shared/autonomy-ceiling.md` (the `### Orthogonal to the ceiling: the Manifesto's \`merge-authorization\` lever` section, currently lines 180-192)
- Modify: `plugin/bin/lib/issues/autonomy.js` (comment above `function bookkeepingPermissions(ceiling)`)
- Create: `tests/flow-pre-authorize-merge-token.test.js`
- Test: `tests/bin-lib/issues/autonomy.test.js` (append after the existing bookkeepingPermissions tests)
- Test: `tests/resolve-policy-lib.test.js` (append after the `merge-authorization: an invalid run-config value…` test)

**Interfaces:**
- Produces: `tests/flow-pre-authorize-merge-token.test.js` with helpers `ROOT`, `read(rel)`, `TOKEN = 'pre-authorize-merge'` that Task 2 appends to.

- [ ] **Step 1: Write the failing tests**

Create `tests/flow-pre-authorize-merge-token.test.js`:

```js
// tests/flow-pre-authorize-merge-token.test.js — #2734. Pins the decision that
// no autonomy ceiling sets merge-authorization, and the /flow
// `pre-authorize-merge` token that answers lever 13 for one run instead. Reads
// live skill prose deliberately (skill-prose-conformance-tests): these
// sentences ARE the contract the record asked to have documented.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const TOKEN = 'pre-authorize-merge';

function ceilingSection() {
  const text = read('plugin/skills/_shared/autonomy-ceiling.md');
  const start = text.indexOf("### Orthogonal to the ceiling: the Manifesto's `merge-authorization` lever");
  assert.ok(start !== -1, 'autonomy-ceiling.md: Orthogonal-to-the-ceiling heading not found');
  const end = text.indexOf('\n### ', start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

test('AC1.1: autonomy-ceiling.md records the #2734 decision that no ceiling sets merge-authorization', () => {
  const section = ceilingSection();
  assert.match(section, /no ceiling sets it/);
  assert.match(section, /#2734/);
  assert.match(section, /#1802/, 'the rationale must name the ungranted-member carve-out it protects');
  assert.ok(section.includes('`' + TOKEN + '`'), 'the section must name the per-run route that replaces the extension');
});
```

Append to `tests/bin-lib/issues/autonomy.test.js`:

```js
test('AC1.1: bookkeepingPermissions grants no merge capability at any ceiling (#2734)', () => {
  for (const ceiling of CEILINGS) {
    assert.deepStrictEqual(Object.keys(bookkeepingPermissions(ceiling)).filter((k) => /merge/i.test(k)), [], ceiling);
  }
});
```

Append to `tests/resolve-policy-lib.test.js`:

```js
test('AC2.1: merge-authorization: an unattended autonomy ceiling alone never pre-authorizes (#2734)', () => {
  const result = resolvePolicyKeys(['merge-authorization'], { policyRaw: 'autonomy: unattended\n', runConfigRaw: null });
  assert.deepStrictEqual(result['merge-authorization'], { value: 'ask', source: 'default' });
});

test('AC2.1: merge-authorization: the pre-authorize-merge token\'s run-config write wins at unattended (#2734)', () => {
  const result = resolvePolicyKeys(['merge-authorization'], {
    policyRaw: 'autonomy: unattended\n',
    runConfigRaw: 'merge-authorization: pre-authorized\n',
  });
  assert.deepStrictEqual(result['merge-authorization'], { value: 'pre-authorized', source: 'run-config' });
});
```

- [ ] **Step 2: Run the new conformance test to verify it fails**

Run: `node --test tests/flow-pre-authorize-merge-token.test.js`
Expected: FAIL — `AC1.1: autonomy-ceiling.md records the #2734 decision` fails on `/no ceiling sets it/`.

The autonomy and resolver tests pin decisions that already hold at base, so they pass immediately; their go-red is by revert, in Step 4.

- [ ] **Step 3: Rewrite the `### Orthogonal to the ceiling` section of `plugin/skills/_shared/autonomy-ceiling.md` and comment `bookkeepingPermissions`**

Replace the section body (keep the heading) with this text:

```markdown
`flow/manifesto.md`'s `merge-authorization` lever (#715) is **not** one of the bookkeeping
capabilities above, is **not** gated by the `autonomy` ceiling, and **no ceiling sets it** —
decided at #2734, so the absence is not re-discovered as a gap. It is available at every tier,
`supervised` included, and only a live, per-run human answer sets it: the `/flow`
`pre-authorize-merge` token typed on the invocation, or a Manifesto `confirm`/`hybrid` override —
never `policy.yml` (`flow/manifesto.md`'s Recommendation defaults row).

Why merge stops short of the ceiling when every `unattended` capability above does not:

- **The ceiling is a standing `policy.yml` value; this lever is `policySourceExcluded`.** Every
  capability above resolves reversible bookkeeping — a ledger row, a record filing, an ack. A merge
  is the run's one irreversible terminal action, and a standing default authorizing it is the
  non-interactive auto-grant `_shared/auto-mode-contract.md`'s `auto:*` invariant forbids: an agent
  never originates its own merge authorization.
- **`unattended` already merges what a human authorized.** `consoleAutoResolve` resolves the merge
  half to merge for a record carrying `auto:merge` or a matured `auto:merge-pending`. Deriving
  `pre-authorized` from the ceiling would merge every `auto:build`-only record as well, erasing the
  build/merge grant split and overturning `wrap-up/review-console.md`'s ungranted-member carve-out
  (#1802, #1966), whose premise is that a withheld grant is itself a human decision.
- **The real gap was per-run.** A human running `/flow` in default `auto` who wanted this one run to
  merge had to reopen the whole Manifesto gate with `confirm`; `pre-authorize-merge` answers lever
  13 alone, live, without reopening the rest. A dispatch-bound run ignores the token.

So at `unattended` with `consoleAutoResolve` granted, a run ends with zero clicks either way:
merged when its record carries `auto:merge` (or a matured `auto:merge-pending`) or its `/flow` was
invoked with `pre-authorize-merge`, and otherwise parked at `pending-review` — never an
`AskUserQuestion` stall. Both merge routes still pass `assess-agent-autonomy` `merge-check`.
```

In `plugin/bin/lib/issues/autonomy.js`, extend the comment block directly above `function bookkeepingPermissions(ceiling)` with one sentence: `merge-authorization` is deliberately not a key here and no ceiling sets it (#2734) — see `skills/_shared/autonomy-ceiling.md`'s "Orthogonal to the ceiling" section for why. No code change.

- [ ] **Step 4: Run the tests to verify they pass, and prove the two pin tests can go red**

Run: `node --test tests/flow-pre-authorize-merge-token.test.js tests/bin-lib/issues/autonomy.test.js tests/resolve-policy-lib.test.js`
Expected: PASS, 0 failures.

Go-red (scratch only, revert before commit): add `mergeAuthorization: atLeast(tier, 'unattended'),` to `bookkeepingPermissions`'s returned object and re-run `node --test tests/bin-lib/issues/autonomy.test.js` — expected FAIL in `AC1.1: bookkeepingPermissions grants no merge capability` (and the existing exact-`deepEqual` tests). Revert, re-run, PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/autonomy-ceiling.md plugin/bin/lib/issues/autonomy.js tests/flow-pre-authorize-merge-token.test.js tests/bin-lib/issues/autonomy.test.js tests/resolve-policy-lib.test.js
git commit -m "Record that no autonomy ceiling sets merge-authorization — #2734's Deliverable 1 decision, pinned in prose and code"
```

---

### Task 2: Add the `/flow` `pre-authorize-merge` token

**Files:**
- Modify: `plugin/skills/flow/SKILL.md` — four grammar mirrors (frontmatter `argument-hint:` line 4, the `## Input` parse line, the `## Syntax` code block line, plus the Examples block), and one new `### Arguments` table row after the `parallel` row
- Modify: `plugin/skills/help/reference-card.md:43` — the `/claude-tweaks:flow` row's Takes cell
- Modify: `plugin/skills/flow/manifesto.md` — precedence-chain item 1 (line 26) and the Recommendation defaults `Merge authorization` row (line 154)
- Test: `tests/flow-pre-authorize-merge-token.test.js` (append)

Mirror surfaces come from `docs/skill-authoring.md`'s Argument-hint mirror surfaces table (walked by `tests/argument-hint-mirrors.test.js`): `frontmatter`, `input-parse-line`, `syntax-block`, `reference-card-takes` (flow has no `usage-line`). Prose-describing surfaces found by `git grep -n "keep-going" -- plugin/skills/help README.md docs/`: only the reference card — no other file restates flow's flag list.

**Interfaces:**
- Consumes: Task 1's `ROOT`, `read`, `TOKEN` in the test file.
- Produces: the grammar string every mirror carries — `#N[,#M...] [worktree|current-branch] [no-stories] [no-polish] [no-deepen] [no-creative] [auto|interactive|hybrid|confirm] [keep-going] [parallel] [pre-authorize-merge] [cleanup-only] [step1,step2,step3]`.

- [ ] **Step 1: Append the failing tests**

Append to `tests/flow-pre-authorize-merge-token.test.js`:

```js
test('flow SKILL.md documents the token, its dispatch-bound refusal, and that no skill composes it', () => {
  const row = read('plugin/skills/flow/SKILL.md').split('\n').find((l) => l.startsWith('| `' + TOKEN + '` |'));
  assert.ok(row, 'flow/SKILL.md: no Arguments row for the token');
  assert.match(row, /dispatch-bound/);
  assert.match(row, /no skill composes it/);
});

test('manifesto.md sets lever 13 from the token (source arg) and refuses it on a dispatch-bound run', () => {
  const row = read('plugin/skills/flow/manifesto.md').split('\n').find((l) => l.startsWith('| Merge authorization | `ask` |'));
  assert.ok(row, 'manifesto.md: Recommendation defaults Merge authorization row not found');
  assert.ok(row.includes('`' + TOKEN + '`'));
  assert.match(row, /source `arg`/);
  assert.match(row, /dispatch-bound/);
  assert.match(row, /`SKIP`/);
});

// An agent never originates its own merge authorization: no plugin file other
// than flow's own grammar/examples may compose a /claude-tweaks:flow invocation
// carrying the token. `[^`|\n]*` keeps the match inside one invocation string,
// so prose naming both in separate code spans does not count.
test('no plugin file composes a /claude-tweaks:flow invocation carrying the token', () => {
  const ALLOWED = new Set(['plugin/skills/flow/SKILL.md']);
  const INVOCATION = new RegExp('/claude-tweaks:flow[^`|\\n]*' + TOKEN);
  const offenders = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir + '/' + ent.name;
      if (ent.isDirectory()) { walk(rel); continue; }
      if (!/\.(md|js|ya?ml|json)$/.test(ent.name) || ALLOWED.has(rel)) continue;
      if (INVOCATION.test(read(rel))) offenders.push(rel);
    }
  };
  walk('plugin');
  assert.deepStrictEqual(offenders, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/flow-pre-authorize-merge-token.test.js`
Expected: FAIL — `flow SKILL.md documents the token` (no row) and `manifesto.md sets lever 13 from the token` (row lacks the token); the no-compose scan passes.

- [ ] **Step 3: Edit the three files**

1. In all four grammar mirrors (SKILL.md frontmatter, `## Input` line, `## Syntax` block, reference-card Takes cell — the card escapes `|` as `\|`) insert `[pre-authorize-merge] ` immediately before `[cleanup-only]`.
2. SKILL.md Examples block — add after the `parallel` example, aligned with the arrows:
   `/claude-tweaks:flow 42 pre-authorize-merge                            → full pipeline; this run merges itself once every gate is green — no confirm gate, no final click`
3. SKILL.md `### Arguments` — new row after `parallel`:

   ```markdown
   | `pre-authorize-merge` | No | Pre-authorizes this run's own merge (#2734): the Manifesto writes lever 13 `merge-authorization: pre-authorized` (source `arg`), so wrap-up's Auto-merge short-circuit merges once every HARD-GATE is green and `merge-check` returns `auto-merge` — no `confirm` gate, no final click. A human types it; no skill composes it. Ignored on a dispatch-bound run (Step 1 rung 2 — a dispatched record's merge authority is its `auto:merge` label), and a no-op under `interactive` or on a multi-record run. Rules: `manifesto.md`'s Merge authorization default. |
   ```
4. `manifesto.md` precedence item 1 becomes: ``1. Explicit CLI args from `$ARGUMENTS` (e.g., `no-polish` sets `polish: skip`; `pre-authorize-merge` sets `merge-authorization: pre-authorized`)``
5. `manifesto.md` Recommendation defaults row becomes:

   ```markdown
   | Merge authorization | `ask` | Never a `policy.yml` default, and no `autonomy` ceiling sets it (`_shared/autonomy-ceiling.md`, #2734). Only a live answer does: the `pre-authorize-merge` invocation token (`pre-authorized`, source `arg` — under `confirm`/`hybrid` it pre-fills lever 13's Recommended value, still overridable) or a `confirm`/`hybrid` override (`wrap-up/manifesto-authorized-merge.md`'s "Why policy.yml is excluded"). On a dispatch-bound run (`SKILL.md` Step 1 rung 2) or a multi-record run, write `ask` despite the token and log one `SKIP` naming which (`log-decision.js --status SKIP --step "Manifesto merge-authorization" --text "condition: pre-authorize-merge on a {dispatch-bound|multi-record} run → fallback: merge-authorization written as ask"`) |
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/flow-pre-authorize-merge-token.test.js tests/argument-hint-mirrors.test.js tests/argument-hint-input.test.js tests/manifesto-lever-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/SKILL.md plugin/skills/help/reference-card.md plugin/skills/flow/manifesto.md tests/flow-pre-authorize-merge-token.test.js
git commit -m "Add /flow pre-authorize-merge token — answers merge-authorization for one run without reopening the Manifesto gate"
```

---

### Task 3: Sweep every "only a `confirm`/`hybrid` override sets it" restatement

**Files:**
- Modify: `plugin/skills/wrap-up/manifesto-authorized-merge.md` — "Why policy.yml is excluded" section's last sentence (lines 43-46) and the Applicability paragraph's "always a live Manifesto `confirm`/`hybrid` override answer" (line 18)
- Modify: `plugin/skills/_shared/auto-mode-contract.md:188` — Merge authorization lever row
- Modify: `plugin/skills/_shared/policy-schema.md:100` — `merge-authorization` row's source cell
- Modify: `plugin/skills/help/policy.md:67` — `sourceExcludedKeys` bullet
- Modify: `plugin/skills/_shared/github-pr-scan.md:392-393` — `[manifesto-authorized]` never-headless clause
- Modify: `plugin/bin/lib/policy-schema.js:54` — `merge-authorization` row `summary`
- Test: `tests/flow-pre-authorize-merge-token.test.js` (append)

Derivation: `git grep -n -i "confirm\`/\`hybrid\` override\|Manifesto override\|at Manifesto time" -- plugin/` — every hit that describes how lever 13 gets set. Before finalizing, also run `git grep -n -F "only a live" -- plugin/ tests/` (Task 2 already rewrote manifesto.md's) and the moved-prose pin check: `git grep -n -F "the only way to set it is a live answer" -- tests plugin` returned no test pin at plan time; `tests/policy-schema-metadata.test.js` checks `summary` length/shape, not text — re-run it.

**Interfaces:**
- Consumes: the token name and the dispatch-bound refusal from Task 2.

- [ ] **Step 1: Append the failing test**

```js
test('every restatement of how lever 13 is set names the token alongside confirm/hybrid', () => {
  const SITES = [
    'plugin/skills/wrap-up/manifesto-authorized-merge.md',
    'plugin/skills/_shared/auto-mode-contract.md',
    'plugin/skills/_shared/policy-schema.md',
    'plugin/skills/help/policy.md',
    'plugin/skills/_shared/github-pr-scan.md',
  ];
  for (const rel of SITES) assert.ok(read(rel).includes('`' + TOKEN + '`'), rel + ' does not name the token');
  const { POLICY_KEYS } = require('../plugin/bin/lib/policy-schema');
  const row = POLICY_KEYS.find((k) => k.key === 'merge-authorization');
  assert.doesNotMatch(row.summary, /at Manifesto time/, 'summary still says only the Manifesto sets it');
});
```

(Confirm `POLICY_KEYS` is the exported name before running: `node -e "console.log(Object.keys(require('./plugin/bin/lib/policy-schema')))"` — use the actual export name if it differs.)

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/flow-pre-authorize-merge-token.test.js`
Expected: FAIL — `every restatement … names the token` on `plugin/skills/wrap-up/manifesto-authorized-merge.md does not name the token`.

- [ ] **Step 3: Edit each site**

Each replaces "a live (Manifesto) `confirm`/`hybrid` override" with "a live per-run answer — the human-typed `/flow` `pre-authorize-merge` token or a Manifesto `confirm`/`hybrid` override" in its own sentence shape; keep each line free of `/claude-tweaks:flow` directly followed by the token (Task 2's no-compose scan). Specifics:
- `manifesto-authorized-merge.md` "Why policy.yml is excluded" final sentence: the only ways to set it are the token (`flow/SKILL.md`'s Arguments row — a dispatch-bound run ignores it) and an explicit override reply (`13=pre-authorized`); under plain `auto` without the token the lever resolves `ask` unless a prior step in this same run already wrote `pre-authorized`. Add one sentence: the `autonomy` ceiling never sets it either (`_shared/autonomy-ceiling.md`, #2734).
- `auto-mode-contract.md:188`: "(Manifesto lever 13 — always a live answer: the human-typed `/flow` `pre-authorize-merge` token or an explicit Manifesto `confirm`/`hybrid` override, never a `policy.yml` default or the `autonomy` ceiling, …)" and the closing "per-run (this lever, via the token or a live Manifesto override)".
- `policy-schema.md:100` source cell: "`config.yml` only — the `/flow` `pre-authorize-merge` token or a live Manifesto `confirm`/`hybrid` override answer (lever 13); **never** `.claude-tweaks/policy.yml` …".
- `help/policy.md:67`: "for `merge-authorization`, a live per-run answer — `/flow`'s `pre-authorize-merge` token or a `confirm`/`hybrid` Manifesto override — never a standing project default." (drop the `/claude-tweaks:flow confirm` spelling on this line).
- `github-pr-scan.md:392-393`: "…is likewise never headless — it requires a live human answer (a Manifesto `confirm`/`hybrid` override, or the human-typed `/flow` `pre-authorize-merge` token, which a dispatch-bound run ignores), the same interactive precondition as `[fast-lane]`."
- `policy-schema.js:54` summary: `"Lets a human pre-authorize, for one run, that it merges itself once every HARD-GATE is green — never a standing default."`

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/flow-pre-authorize-merge-token.test.js tests/policy-schema.test.js tests/policy-schema-metadata.test.js tests/manifesto-lever-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/manifesto-authorized-merge.md plugin/skills/_shared/auto-mode-contract.md plugin/skills/_shared/policy-schema.md plugin/skills/help/policy.md plugin/skills/_shared/github-pr-scan.md plugin/bin/lib/policy-schema.js tests/flow-pre-authorize-merge-token.test.js
git commit -m "Name the pre-authorize-merge token wherever lever 13's setters are restated — no stale confirm/hybrid-only claims"
```

---

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 — decide; if not extending, document why merge is excluded | Task 1 (decision: not extending) |
| Deliverable 2 — implement the capability path if extending | Not built — Deliverable 1 decides against extension; Task 1 pins `bookkeepingPermissions()` key set |
| Deliverable 3 — one-time `/flow` opt-in flag, distinct from `confirm`/`hybrid` | Task 2 (+ Task 3 sweep) |
| AC1.1 documented decision | Task 1 conformance + autonomy tests |
| AC2.1 zero-click merge at `unattended` | Task 1 resolver tests (ceiling alone → `ask`; token's run-config write → `pre-authorized`) |
| AC3.1 `npm test` passes | `/build` Common Step 5 |

Waived AC2.1 (end-to-end half): a full `/flow` run through wrap-up's merge cannot run under `node --test`; the resolver tests pin the lever value the existing, already-tested Auto-merge short-circuit keys on (`manifesto-authorized-merge.md`'s Applicability).
Waived AC3.1: verified by `/build` Common Step 5's full-suite run, not by a test step.
