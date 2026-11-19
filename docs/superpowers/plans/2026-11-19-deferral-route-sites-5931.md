# Deferral Routing Sites Onto the Route Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every run-time site that chooses between filing a deferred item and digesting it runs `plugin/bin/deferral-route.js` and follows its verdict, instead of applying `_shared/materiality-floor.md`'s floor from prose.

**Architecture:** `_shared/materiality-floor.md` gains an `## Applying the floor` section naming `bin/deferral-route.js` as the floor's code home and giving the one command form. Each routing site swaps its prose restatement of the floor and overrides for that command plus its own `file` / `digest` / `refused`-or-other handling. A live-corpus conformance test pins the command form and the absence of override restatements at each site. No code changes: the CLI landed in #5930 on this branch.

**Tech Stack:** Markdown skill prose, `node --test` conformance suites, Node 18+ CommonJS.

**Spec:** `.claude-tweaks/pipelines/2026-11-19T070031-spec-5930-5931-5932-5933/spec-5931/work/5931-spec.md`

Scope keywords: deferral-route, materiality-floor, belowFloor, routeDeferral, floor test

Check B classification (plan-audit's keyword walk, 84 unplanned hits at authoring): each hit was read or grepped for a run-time floor application. The ones that apply the floor are in Tasks 1-6. The rest are no-change: the five health sweeps (spec Non-Goal); `tidy/*`, `specify/*`, `review/step3-tiebreak.md`, `_shared/{deferral-gate,autonomy-ceiling,work-record,label-bootstrap,health-filing-digest,github-pr-scan-acceptance}.md` and `init/claude-md-template.md` cite the digest container, the autonomy floor (`clearsFloor`) or `belowFloorClose`, not the materiality verdict; `release/disposition.md` and `reflect/hindsight-mode.md` point at a site this plan moves; `intake/SKILL.md` is human input; `plugin/bin/**` and their tests are the CLI and its consumers (no code change); `docs/journeys/*`, `docs/plans/*`, `docs/superpowers/*`, `CHANGELOG.md`, `CLAUDE.md`, `docs/skill-graph.md` (its edges say the sites "consult this floor", still true) and `docs/plugin-structure.md` (its `deferral-route.js` entry is unchanged) are history or descriptions that stay accurate.

## Global Constraints

- The CLI's real interface, read from `plugin/bin/deferral-route.js` and `plugin/bin/lib/deferral-route/route.js` (not the spec's summary): flags `--defer-reason <reason> (--agent-raised | --human) [--severity <critical|high|medium|low|info>] [--size <v>] [--priority <v>] [--risk <v>]`. All three axis flags are optional to the parser: an absent axis, or any value other than the exact string `low`, counts as not low and files (rule `not-low`). One JSON line on stdout: `{verdict: file|digest|refused, rule, reason (refused only), input}`. Exit 0 for `file`/`digest`, 2 for `refused` (reason also on stderr). There is no exit 1. `digest` is only ever rule `floor`.
- Severity is case-sensitive: `--severity High` exits 2 (probed: `{"verdict":"refused","rule":"refused","reason":"--severity \"High\" is not one of: critical, high, medium, low, info",...}`). Every site passes the lowercase word.
- One command form, cited by every site with the plugin-root placeholder (docs/skill-authoring.md, "Plugin-root references"): `node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason} [--severity {severity}] --size {size} --priority {priority} --risk {risk} --agent-raised`. Never `node plugin/bin/…`, never `process.env.CLAUDE_PLUGIN_ROOT`. docs/skill-authoring.md, verbatim: "Skill prose that shells out to a plugin file writes `node "${CLAUDE_PLUGIN_ROOT}/bin/{cli}.js" …`".
- Every site passes `--agent-raised`. No site passes `--human`.
- Verdict handling at every site: `file` → the site's existing filing path; `digest` → the site's existing digest path; `refused` or any other outcome (file missing, another non-zero exit, unparseable stdout) → the item stays open in the site's own sense, the site reports what the command printed, and it never falls back to judging the floor from prose. Per site, "open" is: review — the finding's ledger row stays `open`; reflect — the insight stays unactioned in the batch table; residue sweep — the drill offers neither route nor digest; leftover routing — the section becomes an `open` ledger item for Phase 2's drill; control mode — `belowFloor: false`, so the item files or carries.
- No site restates the three-axis rule (`size:low` … `priority:low` … `risk:low`, the pattern at `tests/materiality-floor-conformance.test.js` line 198) or any override (`tangential`, severity). The command form uses `--size {size}`, never a `size:low` token.
- `## The floor` and `## Overrides` in `_shared/materiality-floor.md` are pinned byte-equal by `tests/bin-lib/deferral-route/route.test.js` (lines 135-162). Never edit inside those two sections; the new section is inserted after `## Overrides`, at the position `## Entry format` holds today, so `sectionOf`'s slice of `## Overrides` is unchanged.
- `/claude-tweaks:capture` (`plugin/skills/capture/SKILL.md`) is not edited. The five health sweeps' floor paragraphs are not edited. `plugin/bin/**` is not edited.
- A skill reference inside instruction text uses `/claude-tweaks:{skill}`; bare `/{skill}` only in descriptive prose.
- Byte rail: `RAIL_BYTES` = 52,500 (`plugin/bin/lib/skill-audit/budgets.js`). Starting sizes measured with `wc -c` at plan time: `plugin/skills/_shared/materiality-floor.md` 15413; `plugin/skills/review/step3-routing.md` 39186; `plugin/skills/reflect/full-mode.md` 39771; `plugin/skills/visual-review/browser-review.md` 27796; `plugin/skills/wrap-up/residue-sweep.md` 17222; `plugin/skills/wrap-up/leftover-routing.md` 16717; `plugin/skills/_shared/ledger-format.md` 44944; `plugin/skills/wrap-up/review-console.md` 44011. Expected end sizes with this plan's text (scratch-applied): 16736 (+1323), 38774 (-412), 39683 (-88), 27532 (-264), 17205 (-17), 16715 (-2), 45196 (+252), 43997 (-14). Every file stays under the rail; the largest end size, ledger-format.md, leaves 7304 bytes of headroom.
- AC5 conflict, stated rather than hidden: `_shared/materiality-floor.md` (+1323) and `_shared/ledger-format.md` (+252) grow, because Deliverable 1 and AC1 require the command form and its handling to be written there. AC5's "or the pull request lists the removed text" does not cover growth. The PR body's AC5 section lists every edited skill file's start and end bytes, names these two as growth required by Deliverable 1 / AC1, and gives the net across the eight files (+778). The six routing-site files the spec's size list names, plus `review-console.md`, all end at or below their start size, except ledger-format.md.
- Commit messages: `{Verb} {what} — {detail} (#5931)`, then a blank line, then `Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T` (a second `-m`). Stage specific files by path only (never `git add -A` / `.`). Never `git reset`, never `git stash`, never force push.
- Tests: run targeted files with `node --test <file>`. Never run the full `npm test` suite.
- Governing skill `.claude/skills/skill-prose-conformance-tests/SKILL.md`, quoted verbatim:
  - Decision Framework row: "A documented convention this project wants enforced against every future addition — no fixed code structure to pin against, no bytes a migration will rewrite | Read the live corpus and pin the convention itself (a regex over `plugin/skills/**/*.md`, or wherever the convention applies); never freeze it — freezing would stop the suite from catching a new violation, which is the whole point".
  - "When the assertion and the prose it pins are authored in the same change — a plan that inserts both, a build that writes the test before the edit lands — copy the pinned literal out of the edit's own replacement text, never from memory of what that edit says."
  - "Apply the whitespace-collapsed control scan to **both** directions of a migration suite — absence assertions need it more than presence ones."
  - "Prove the assertion can go red before trusting its green: negate the prose and assert the regex *fails*, one claim per test."
  - "**Retargeting existing pins: diff the assertion inventory, not the plan's prose anchor list.** … give each one an explicit verdict — moved, retargeted (naming the new literal), or retired (with its own stated reason)."
  - Anti-pattern row: "Pinning a templated CLI invocation in skill prose up to a value-taking flag's name, not its value | … Pin the placeholder with the flag (`--require-verify \{base\}`)".
  - Anti-pattern row: "Scoping a command-form pin to the sites the spec enumerated, without first grepping the form repo-wide | … grep the old form over `plugin/`, `docs/` and `README.md`, then widen the haystack or name each restatement left unpinned".
- Governing skill `.claude/skills/shared-contract-extraction/SKILL.md`, quoted verbatim: "Re-measure `wc -c` on every near-rail file this migration touches immediately after each upstream merge, not only before planning the additions."
- No other `.claude/skills/` rule names these files: `health-sweep-addition` concerns adding a sweep to `ADOPTERS`; `prose-code-twin-pin` concerns templates a `plugin/bin` detector parses (the audit line has no parser — see Task 1's grep); `review-console-section-addition` concerns adding a console section.

## Fact-check of the spec's Current State

Checked against the files at plan time:

- Line claims hold: `review/step3-routing.md` 69, 71, 110 (and also **111**, the Capture bullet, which applies the floor too — the spec omits it); `reflect/full-mode.md` 397 (and **398**, Capture); `wrap-up/residue-sweep.md` 165-173; `wrap-up/leftover-routing.md` 27-32; `visual-review/browser-review.md` 247-253 (and **254**, Ideas Capture); `_shared/ledger-format.md` 211; `plugin/bin/lib/console/residue-convergence.js` 77; `tests/materiality-floor-conformance.test.js` `ADOPTERS` 172, no-restatement test 192 (its regex on 198). All byte sizes in the spec match `wc -c`.
- **Missed site:** `plugin/skills/wrap-up/review-console.md` line 123 (On approval step 10) builds control-mode insight items with "`belowFloor` judged per `_shared/materiality-floor.md`". It is a seventh place that judges the floor from prose; Task 6 points it at the command. `tests/control-mode-console-prose.test.js` line 103 pins that literal and is re-pointed.
- **Missed severity vocabulary:** visual-review's Issues carry `Critical`/`Major`/`Minor`/`Cosmetic` (`browser-review.md` line 210's table), not the CLI's severities. Today's prose applies the severity override to them by judgment; to keep a Critical or Major visual Issue from digesting, Task 4 maps Critical → `critical`, Major → `high`, Minor → `medium`, Cosmetic → `low`, and passes no `--severity` for an Idea (its Impact column is not a severity).
- **Stale prose found by the behavior-change sweep:** `residue-sweep.md` lines 181-183 say `_shared/ledger-format.md` "is deliberately not an adopter of the floor … tracked on #1279". Control mode has consulted it since #4620, and after this change runs the command; Task 5 corrects the sentence.
- `plugin/skills/release/disposition.md` lines 58 and 65 apply "that bullet's materiality-floor test" by pointing at review's Defer bullet, which this plan moves onto the command; they need no edit (pointer). `plugin/skills/reflect/hindsight-mode.md` line 53 points at `full-mode.md`'s Defer and Capture bullets, which stay where they are; no edit. `plugin/skills/intake/SKILL.md` line 71 is human input; not a site.
- Spec Data/API surface says "axis values `low`, `medium`, `high`": the CLI accepts any string for an axis (only `low` is low). Sites are told to pass `low`/`medium`/`high`; nothing breaks on other values.

## Review Focus

1. A findings table renders severity capitalized (`High`, `Critical`); passed through as-is, the CLI refuses with exit 2. Expected: the site passes the lowercase word. Pinned by Task 1's contract test (the section lists the five lowercase values) and Task 4's visual-review mapping test.
2. An axis the site cannot judge (an unstamped `priority`, an unscored item). Expected: passed as `medium`/`high`, never `low`, so the item files. Pinned by Task 1's contract test literal "never `low` for one it cannot judge".
3. The command is not runnable (plugin root not substituted: `Cannot find module '/bin/deferral-route.js'`), or prints nothing parseable. Expected: the item stays open, never a prose fallback. Pinned at every site by Task 1's `any other outcome` assertion.
4. A control-mode ledger item with no mapped `deferReason`. Expected: no command call, `belowFloor: false`. Pinned by Task 6's added `LEDGER_CLAIMS` row.
5. A Critical or Major visual-review Issue whose three axes are all low. Expected: files, because it maps to `--severity critical`/`high` (rule `severity`). Pinned by Task 4's mapping test.

---

### Task 1: The floor contract names the command, and the conformance suite pins every site

**Role:** judgment
**Review risk:** medium

**Files:**
- Modify: `plugin/skills/_shared/materiality-floor.md` (insert after line 32, the last line of `## Overrides`; line 191 Audit line; lines 204-212 `## Consumers`)
- Test: `tests/materiality-floor-conformance.test.js` (insert after line 202, the end of the no-restatement test; add one import)

**Interfaces:**
- Produces: the constants and helpers later tasks' tests call by name — `ROUTE_COMMAND`, `DEFERRAL_SITES`, `deferralSiteProblems(text) -> string[]`, `assertDeferralSite(text, rel)`; one test per site named `#5931 deferral site {rel} runs the deferral-route.js command and follows its verdict` (Tasks 2-6 turn each green).
- Produces: the section heading `## Applying the floor` in `materiality-floor.md`, which every site cites as "the floor test".

- [ ] **Step 1: Write the failing tests.** In `tests/materiality-floor-conformance.test.js`, add `const { sectionOf } = require('./helpers/conformance-asserts');` beside the `readText` import, and insert after line 202:

```js
// --- #5931: every deferral routing site applies the floor through bin/deferral-route.js ---
// Live corpus on purpose (skill-prose-conformance-tests' "documented convention ... against every future
// addition" row): the claim is that each site's own prose carries the command, which no fixture can stand in for.
const ROUTE_COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason}';
const ROUTE_FORM = `${ROUTE_COMMAND} [--severity {severity}] --size {size} --priority {priority} --risk {risk} --agent-raised`;
const DEFERRAL_SITES = [
  'plugin/skills/review/step3-routing.md',
  'plugin/skills/reflect/full-mode.md',
  'plugin/skills/wrap-up/residue-sweep.md',
  'plugin/skills/wrap-up/leftover-routing.md',
  'plugin/skills/visual-review/browser-review.md',
  'plugin/skills/_shared/ledger-format.md',
];
const OVERRIDE_RESTATEMENT = /always clears|override clears|other than `tangential`|non-`tangential`|is not `tangential`/;

// The paragraph(s) holding the command must carry its value placeholders, the origin flag, the three
// verdicts and the any-other-outcome branch; the whole file must not restate an override.
function deferralSiteProblems(text) {
  const problems = [];
  const paragraphs = text.split(/\n[ \t]*\n/).map((p) => p.replace(/\s+/g, ' '));
  const holding = paragraphs.filter((p) => p.includes(ROUTE_COMMAND));
  if (holding.length === 0) problems.push('no paragraph holds the deferral-route.js command form');
  else {
    for (const flag of ['--size {size}', '--priority {priority}', '--risk {risk}', '--agent-raised']) {
      if (!holding.some((p) => p.includes(flag))) problems.push(`the command paragraph lacks ${flag}`);
    }
    if (!holding.some((p) => p.includes('any other outcome'))) problems.push('the command paragraph does not handle any other outcome');
    for (const word of ['`file`', '`digest`', '`refused`']) {
      if (!holding.some((p) => p.includes(word))) problems.push(`the command paragraph does not name the ${word} verdict`);
    }
  }
  if (OVERRIDE_RESTATEMENT.test(text.replace(/\s+/g, ' '))) problems.push('restates a floor override');
  return problems;
}
function assertDeferralSite(text, rel) {
  assert.deepStrictEqual(deferralSiteProblems(text), [], `${rel} must apply the floor through bin/deferral-route.js`);
}

for (const rel of DEFERRAL_SITES) {
  test(`#5931 deferral site ${rel} runs the deferral-route.js command and follows its verdict`, () => {
    assertDeferralSite(read(rel), rel);
  });
}

const SAMPLE_SITE = `Apply the floor with \`${ROUTE_COMMAND} --size {size} --priority {priority} --risk {risk} --agent-raised\`: \`digest\` digests, \`file\` files, \`refused\` or any other outcome stays open.`;
const SITE_MUTATIONS = [
  [ROUTE_COMMAND, 'no paragraph holds the deferral-route.js command form'],
  ['--size {size}', 'the command paragraph lacks --size {size}'],
  ['{priority}', 'the command paragraph lacks --priority {priority}'],
  ['--agent-raised', 'the command paragraph lacks --agent-raised'],
  ['any other outcome', 'the command paragraph does not handle any other outcome'],
  ['`file`', 'the command paragraph does not name the `file` verdict'],
  ['`digest`', 'the command paragraph does not name the `digest` verdict'],
  ['`refused`', 'the command paragraph does not name the `refused` verdict'],
];
test('#5931 go-red: the sample site passes the deferral-site check', () => assertDeferralSite(SAMPLE_SITE, 'sample'));
for (const [cut, expected] of SITE_MUTATIONS) {
  test(`#5931 go-red: removing ${cut} fails the deferral-site check`, () => {
    const mutated = SAMPLE_SITE.split(cut).join('');
    assert.notEqual(mutated, SAMPLE_SITE, `anchor ${cut} not in the sample`);
    assert.deepStrictEqual(deferralSiteProblems(mutated), [expected]);
    assert.throws(() => assertDeferralSite(mutated, 'sample'));
  });
}
test('#5931 go-red: an override restated across a line wrap fails the deferral-site check', () => {
  const restated = `${SAMPLE_SITE}\nA \`tangential\` reason always\nclears the floor.`;
  assert.deepStrictEqual(deferralSiteProblems(restated), ['restates a floor override']);
  assert.throws(() => assertDeferralSite(restated, 'sample'));
});

function floorCommandProblems(text) {
  const problems = [];
  const section = sectionOf(text, '## Applying the floor').replace(/\s+/g, ' ');
  for (const needle of [
    ROUTE_FORM,
    '`bin/lib/deferral-route/route.js`',
    '(`critical`, `high`, `medium`, `low`, `info`)',
    'never `low` for one it cannot judge',
    '`--agent-raised` always',
    '`file` takes the site\'s filing path, `digest` its digest path',
    '`refused` (exit 2) or any other outcome',
  ]) if (!section.includes(needle)) problems.push(`Applying the floor lacks ${needle}`);
  if (!/^AUTO \{time\} — materiality-floor: \{item\} routed below floor \(\{defer-reason\}, rule=\{rule\}\) → digest\./m.test(text)) {
    problems.push('the Audit line does not carry rule={rule}');
  }
  return problems;
}
test('#5931 materiality-floor.md names deferral-route.js as the code home and gives the one command form', () => {
  assert.deepStrictEqual(floorCommandProblems(FLOOR), []);
});
test('#5931 go-red: dropping the axis placeholders from the command form fails the floor check', () => {
  const mutated = FLOOR.split('--size {size} --priority {priority}').join('--size --priority');
  assert.notEqual(mutated, FLOOR);
  assert.deepStrictEqual(floorCommandProblems(mutated), [`Applying the floor lacks ${ROUTE_FORM}`]);
});
test('#5931 go-red: dropping rule={rule} from the Audit line fails the floor check', () => {
  const mutated = FLOOR.split(', rule={rule}').join('');
  assert.notEqual(mutated, FLOOR);
  assert.deepStrictEqual(floorCommandProblems(mutated), ['the Audit line does not carry rule={rule}']);
});
```

- [ ] **Step 2: Run against the pre-change tree and see it fail (AC2.2 evidence)**

Run: `node --test tests/materiality-floor-conformance.test.js`
Expected: FAIL — the six `#5931 deferral site …` tests fail (five with `["no paragraph holds the deferral-route.js command form","restates a floor override"]`, ledger-format.md with the first only — the scratch run of this exact helper printed those arrays), and `#5931 materiality-floor.md names …` plus both floor go-red tests fail with `heading not found: ## Applying the floor`. The eleven sample go-red tests pass. Every pre-existing test passes.
Write the full output to `$PIPELINE_RUN_DIR/evidence/5931-ac2-base-red.txt` (`mkdir -p "$PIPELINE_RUN_DIR/evidence"` first, the run dir's absolute path substituted, a plain Bash redirect) and log one entry: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}"`, the text file (written with the Write tool) holding one line: `AC2.2: node --test tests/materiality-floor-conformance.test.js before any site edit — 6 deferral-site tests fail, contract test fails; log at evidence/5931-ac2-base-red.txt`.

- [ ] **Step 3: Edit `plugin/skills/_shared/materiality-floor.md`** — three replacements:

(a) Insert after the `## Overrides` section's last line (`  never exhaust, and never routes to the digest.`) and its blank line, before `## Entry format`:

````text
## Applying the floor

`bin/deferral-route.js` is the floor's code home (`routeDeferral` in
`bin/lib/deferral-route/route.js`, whose test pins the two sections above byte-equal); this file is
its explanation. A routing site runs it and never judges the floor from this prose:

`node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason} [--severity {severity}] --size {size} --priority {priority} --risk {risk} --agent-raised`

`{reason}` is the item's `Defer-reason:`; `--severity` only for an item with a finding severity
(`critical`, `high`, `medium`, `low`, `info`); each axis `low`, `medium` or `high` as the site
would score the filing, never `low` for one it cannot judge; `--agent-raised` always, since only
agent-raised items reach a site. Its one JSON line carries `verdict` and `rule` (the Audit line's
`rule`): `file` takes the site's filing path, `digest` its digest path. `refused` (exit 2) or any
other outcome (no such file, another non-zero exit, unparseable output) files and digests nothing:
the item stays open where the site keeps open items, and the site reports what it saw.

````

(b) Audit line (line 191): `({defer-reason}) → digest.` becomes `({defer-reason}, rule={rule}) → digest.` — the rest of the line unchanged. `rule` is always `floor` for a `digest` verdict.

(c) Replace the `## Consumers` body (lines 206-212, heading kept) with:

````text
These adopter files route below-floor findings here through the command in Applying the floor:
`review/step3-routing.md`, `reflect/full-mode.md` (`reflect/hindsight-mode.md` through it),
`visual-review/browser-review.md`, `wrap-up/residue-sweep.md`, `wrap-up/leftover-routing.md`, and
`_shared/ledger-format.md`'s control mode (`wrap-up/review-console.md` step 10 through it). The five
health sweeps (`ci-health`, `code-health`, `docs-health`, `harness-health`, `journey-health`) carry
no `Defer-reason:`, which the command refuses, so they apply the prose. See `docs/skill-graph.md`
for the per-skill relationships. `/tidy`'s digest sweep (`tidy/digest-sweep.md`) manages the
container's lifecycle (cluster promotion + expiry) whatever adopters are routing to it.
````

Checked before planning: no test pins the old Consumers text or the old Audit line's tail (`git grep -n -F "routed below floor" -- tests plugin tools docs` matches only `materiality-floor.md` itself), and no `plugin/bin` code parses the line (`git grep -n -E "materiality-floor[:]|below floor" -- plugin/bin` has no reader of it).

- [ ] **Step 4: Run and see the contract half pass**

Run: `node --test tests/materiality-floor-conformance.test.js tests/bin-lib/deferral-route/route.test.js`
Expected: `route.test.js` PASS (both prose pins unchanged). In the conformance file every test passes except the six `#5931 deferral site …` tests, which still fail until Tasks 2-6.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/materiality-floor.md tests/materiality-floor-conformance.test.js
git commit -m "Name the deferral-route command in the materiality floor contract — one command form, sites pinned (#5931)" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"
```

### Task 2: Review Step 3 routing runs the command

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/review/step3-routing.md:69` (staging paragraph), `:71` (digest paragraph), `:110` (Defer bullet), `:111` (Capture bullet)
- Test: `tests/review-routing-line-prose-conformance.test.js` (`RECORD_PROPOSAL_CLAUSES`, lines 124 and 135)

**Interfaces:**
- Consumes: Task 1's test `#5931 deferral site plugin/skills/review/step3-routing.md …`.

Pin inventory for `RECORD_PROPOSAL_CLAUSES` (every literal the paragraph edit touches): `Before composing, apply \`_shared/materiality-floor.md\`'s floor test` — kept; `other than \`tangential\` goes to the digest container` — retargeted to ``'`digest` goes to the digest container', 'routes a digest verdict to the digest container'``; `A \`tangential\` finding, a \`high\` one, or one that clears the floor, is staged` — retargeted to ``'A finding the command routes `file` is staged', 'stages a finding the command files'``; `A \`high\` finding never takes the digest branch` — kept (still true, now via the command's severity rule); every other row untouched.

- [ ] **Step 1: Retarget the two rows** in `tests/review-routing-line-prose-conformance.test.js` as listed above (row 124 → `` ['`digest` goes to the digest container', 'routes a digest verdict to the digest container'] ``, row 135 → `` ['A finding the command routes `file` is staged', 'stages a finding the command files'] ``).

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F 'bin/deferral-route.js' -- plugin/skills/review/step3-routing.md`
Expected: FAIL — exit 1, no match (the site does not cite the command yet).
Run: `node --test --test-name-pattern "deferral site plugin/skills/review/step3-routing.md" tests/materiality-floor-conformance.test.js`
Expected: FAIL — `["no paragraph holds the deferral-route.js command form","restates a floor override"]` (the test exists once Task 1 is committed).
Run: `node --test tests/review-routing-line-prose-conformance.test.js`
Expected: FAIL — `the record-proposal paragraph is missing clauses` naming the two retargeted facts; the two retargeted go-red tests fail with `anchor: … not found`.

- [ ] **Step 3: Edit `step3-routing.md`.** Each paragraph stays one physical line.

Line 69, replace `Before composing, apply \`_shared/materiality-floor.md\`'s floor test to a low or medium finding: … A \`tangential\` finding, a \`high\` one, or one that clears the floor, is staged as follows.` (the four sentences from "Before composing" through "is staged as follows.") with:

````text
Before composing, apply `_shared/materiality-floor.md`'s floor test with `node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason} --severity {severity} --size {size} --priority {priority} --risk {risk} --agent-raised`, the axes scored as the Defer bullet scores them: `digest` goes to the digest container instead, per the next paragraph; `refused` or any other outcome stages nothing and leaves the finding's ledger row `open`, its Resolution quoting what the command printed. A `high` finding never takes the digest branch: the command files it, so its composer line carries the `high-severity finding` token release Step 3 blocks on. A finding the command routes `file` is staged as follows.
````

Line 71, replace `A low or medium finding the floor test above routes here goes to the digest container` with `A finding the floor test above routes \`digest\` goes to the digest container`.

Line 110, replace the span from `Before composing, apply \`_shared/materiality-floor.md\`'s floor test to this item (judged` through `instead of \`"Defer — {reason}"\` —` with:

````text
Before composing, run the staging paragraph's `deferral-route.js` command for this item (`risk`/`size` as this bullet scores them for `recordPayload`, plus the unstamped `priority`, judged the same way): on `digest` the batch table's Recommended column shows `"Digest — below floor"` instead of `"Defer — {reason}"`, and on `refused` or any other outcome the finding stays `open` like one with no valid reason below, quoting what the command printed —
````

(the text after it, `the digest entry is written only once the human approves that row …`, is unchanged).

Line 111, replace the span from `This branch's items usually carry \`Defer-reason: tangential\`` to the end of the line with:

````text
Before invoking capture, run the Defer bullet's `deferral-route.js` command and follow its verdict the same way. That is `_shared/materiality-floor.md`'s floor, not `_shared/deferral-gate.md`'s own "Floor mapping" section, a different, autonomy-ceiling floor with the opposite verdict for `tangential`.
````

- [ ] **Step 4: Run and see it pass**

Run: `node --test tests/materiality-floor-conformance.test.js tests/review-routing-line-prose-conformance.test.js tests/deferral-gate-conformance.test.js`
Expected: the step3-routing deferral-site test PASS; `review-routing-line-prose-conformance` PASS in full; `deferral-gate-conformance` PASS unmodified; the four other deferral-site tests still FAIL. `wc -c plugin/skills/review/step3-routing.md` prints 38774 (≤ 39186).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/step3-routing.md tests/review-routing-line-prose-conformance.test.js
git commit -m "Route review Step 3 deferrals through deferral-route.js — staging, Defer and Capture follow its verdict (#5931)" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"
```

### Task 3: Reflect's Defer and Capture run the command

**Role:** transcription
**Review risk:** low

**Files:**
- Modify: `plugin/skills/reflect/full-mode.md:397` (Defer), `:398` (Capture)
- Test: `tests/materiality-floor-conformance.test.js` (Task 1's test, no change)
- Waived `plugin/skills/reflect/hindsight-mode.md`: line 53 points at `full-mode.md`'s Defer and Capture bullets, which stay in place; Step 4 re-runs the hindsight pointer test that reads it.

- [ ] **Step 1: No new test** — Task 1's `#5931 deferral site plugin/skills/reflect/full-mode.md …` covers this task.

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F 'bin/deferral-route.js' -- plugin/skills/reflect/full-mode.md`
Expected: FAIL — exit 1, no match.
Run: `node --test --test-name-pattern "deferral site plugin/skills/reflect/full-mode.md" tests/materiality-floor-conformance.test.js`
Expected: FAIL — `["no paragraph holds the deferral-route.js command form","restates a floor override"]`.

- [ ] **Step 3: Edit `full-mode.md`.**

Line 397, replace `Before this recommendation is rendered, apply … per the contract's recommend-only-path rule.` (from "Before this recommendation is rendered" through "recommend-only-path rule.") with:

````text
Before this recommendation is rendered, apply `_shared/materiality-floor.md`'s floor test with `node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason} --size {size} --priority {priority} --risk {risk} --agent-raised` (no `--severity`: an insight has none; axes as `recordPayload` scores it): on `digest` the batch table's Recommended column shows "Digest — below floor" instead of "Defer — {reason}", and the digest entry is written only when the human approves that row (or an auto path applies it); `file` keeps "Defer — {reason}"; on `refused` or any other outcome the insight stays unactioned in the batch table, its row quoting what the command printed.
````

Line 398, replace `A Capture recommendation's \`Defer-reason:\` is usually \`tangential\`, … and may render "Digest — below floor" instead.` (the last two sentences) with:

````text
Before it is rendered, run the Defer bullet's `deferral-route.js` command and follow its verdict the same way, `digest` rendering "Digest — below floor" in place of "Capture — {reason}".
````

- [ ] **Step 4: Run and see it pass**

Run: `node --test tests/materiality-floor-conformance.test.js tests/deferral-gate-conformance.test.js tests/reflect-wrap-up-insights-staging-conformance.test.js`
Expected: the full-mode deferral-site test PASS; the recommend-only test (`digest entry is written only when the human approves that row`), the multi-branch citation count (2), the summary-surfacing tests and the hindsight pointer test PASS; `deferral-gate-conformance` PASS unmodified. `wc -c plugin/skills/reflect/full-mode.md` prints 39683 (≤ 39771).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/reflect/full-mode.md
git commit -m "Route reflect Defer and Capture through deferral-route.js — no severity, insight stays unactioned on refusal (#5931)" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"
```

### Task 4: Visual-review's record branches run the command

**Role:** integration
**Review risk:** medium

**Files:**
- Modify: `plugin/skills/visual-review/browser-review.md:247` (Issues Defer), `:248` (Issues Capture), `:253` (Ideas Defer), `:254` (Ideas Capture)
- Test: `tests/materiality-floor-conformance.test.js` (add the severity-mapping test after Task 1's block)

**Interfaces:**
- Consumes: Task 1's `read`, test file scaffolding.

- [ ] **Step 1: Write the failing test** (Review Focus 5):

```js
const VISUAL_SEVERITY_MAP = ['Critical `critical`', 'Major `high`', 'Minor `medium`', 'Cosmetic `low`', 'none for an Idea'];
function visualSeverityProblems(text) {
  const defer = text.split('\n').find((l) => l.startsWith('- **Defer** (new work record — born-ready'));
  if (!defer) return ['the Issues Defer bullet is missing'];
  return VISUAL_SEVERITY_MAP.filter((m) => !defer.includes(m)).map((m) => `the Issues Defer bullet does not map ${m}`);
}
test('#5931 visual-review maps its Issue severities onto the route command\'s', () => {
  assert.deepStrictEqual(visualSeverityProblems(read('plugin/skills/visual-review/browser-review.md')), []);
});
for (const m of VISUAL_SEVERITY_MAP) {
  test(`#5931 go-red: dropping ${m} fails the visual-review severity map`, () => {
    const text = read('plugin/skills/visual-review/browser-review.md');
    const mutated = text.split(m).join('');
    assert.notEqual(mutated, text, `anchor ${m} not in browser-review.md`);
    assert.deepStrictEqual(visualSeverityProblems(mutated), [`the Issues Defer bullet does not map ${m}`]);
  });
}
```

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F 'none for an Idea' -- plugin/skills/visual-review/browser-review.md`
Expected: FAIL — exit 1, no match (no severity mapping yet).
Run: `node --test --test-name-pattern "visual-review|deferral site plugin/skills/visual-review" tests/materiality-floor-conformance.test.js`
Expected: FAIL — the mapping test reports all five literals missing, each go-red test fails on `anchor … not in browser-review.md`, and the deferral-site test reports `["no paragraph holds the deferral-route.js command form","restates a floor override"]`.

- [ ] **Step 3: Edit `browser-review.md`.**

Line 247, replace `Before creating the record, apply \`_shared/materiality-floor.md\`'s floor test: … (or an auto path applies it).` with:

````text
Before creating the record, apply `_shared/materiality-floor.md`'s floor test with `node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason} [--severity {severity}] --size {size} --priority {priority} --risk {risk} --agent-raised` (`--severity` for an Issue: Critical `critical`, Major `high`, Minor `medium`, Cosmetic `low`; none for an Idea): an item it routes `digest` shows "Digest — below floor" in the Recommended column instead, and only writes the digest entry once the human approves that row (or an auto path applies it); `file` keeps the Defer; on `refused` or any other outcome the row recommends neither and stays open, quoting what the command printed.
````

Line 248, replace `This branch is subject to \`_shared/materiality-floor.md\`'s floor test like any other filing branch: … same as the Issues Defer bullet above.` with `Before invoking capture, run the Issues Defer bullet's \`deferral-route.js\` command and follow its verdict the same way.`

Line 253, replace `Since an Ideas-Defer item is \`tangential\` by default, … following the same before-render check as the Issues Defer bullet above.` with `Before render, run the Issues Defer bullet's \`deferral-route.js\` command (no \`--severity\`) and follow its verdict the same way.`

Line 254, replace ` (an idea's usual reason is \`tangential\`, … same as the Ideas Defer bullet above).` (leading space through the closing `).`) with `; before invoking capture, run the Ideas Defer bullet's \`deferral-route.js\` command and follow its verdict the same way.`

- [ ] **Step 4: Run and see it pass**

Run: `node --test tests/materiality-floor-conformance.test.js tests/deferral-gate-conformance.test.js tests/visual-decision-contract-conformance.test.js tests/demo-visual-decision-adoption.test.js`
Expected: the visual-review deferral-site test, the mapping test and its five go-red tests PASS; the recommend-only test (`writes the digest entry once the human approves that row`) and multi-branch count (2) PASS; the other three files PASS unmodified. `wc -c plugin/skills/visual-review/browser-review.md` prints 27532 (≤ 27796).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/visual-review/browser-review.md tests/materiality-floor-conformance.test.js
git commit -m "Route visual-review record branches through deferral-route.js — Issue severities mapped, Ideas pass none (#5931)" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"
```

### Task 5: The wrap-up residue sweep and leftover routing run the command

**Role:** transcription
**Review risk:** low

**Files:**
- Modify: `plugin/skills/wrap-up/residue-sweep.md:164-173` (`remedy: record` routing), `:179-183` (Not on the ledger-narrowing path)
- Modify: `plugin/skills/wrap-up/leftover-routing.md:27-32` (Materiality floor, before composing)
- Test: `tests/materiality-floor-conformance.test.js` (Task 1's tests, no change)

Both files are hard-wrapped near 100 columns; keep the command's inline code span on one line (it may exceed the wrap width) so no span breaks.

- [ ] **Step 1: No new test** — Task 1's two deferral-site tests cover both files.

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F 'bin/deferral-route.js' -- plugin/skills/wrap-up/residue-sweep.md plugin/skills/wrap-up/leftover-routing.md`
Expected: FAIL — exit 1, no match.
Run: `node --test --test-name-pattern "deferral site plugin/skills/wrap-up" tests/materiality-floor-conformance.test.js`
Expected: FAIL — both tests report `["no paragraph holds the deferral-route.js command form","restates a floor override"]`.

- [ ] **Step 3: Edit both files.**

`residue-sweep.md`, replace lines 165-173 (from `reaches Phase 2's per-item drill first applies` through `test once that value is chosen, before the record is composed.`; line 173's trailing `Otherwise it composes exactly as ledger Phase` stays) with:

````text
reaches Phase 2's per-item drill first applies `_shared/materiality-floor.md`'s floor test with
`node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason} --size {size} --priority {priority} --risk {risk} --agent-raised`:
on `digest` its Step 1 option is relabeled `"Digest — below floor"` in place of `"Route to a
record"`, so the human sees the actual destination before choosing it; choosing it appends a
digest entry instead of a record, skipping the composition below. On `file` the option stays; on
`refused` or any other outcome the drill offers neither and names what the command printed. This
sweep's own end-of-run summary states the digest comment URL and the count routed this run, per
`_shared/materiality-floor.md`'s "Digest URL and count surfacing" section. For an item whose
reason the drill itself picks (the "anything else" case above), run the command once that value is
chosen, before the record is composed.
````

`residue-sweep.md`, replace `floor is not consulted on that path. \`_shared/ledger-format.md\` is deliberately not an adopter of` + the next two lines (through `alongside the digest's other coverage items.`) with `floor is not consulted on that path; only \`_shared/ledger-format.md\`'s control mode runs the command.`

`leftover-routing.md`, replace lines 27-32 (from `**Materiality floor, before composing.**` through `proceeds to the ordinary staging steps below unchanged.`; line 33's `This is not an exception …` stays) with:

````text
**Materiality floor, before composing.** Run `_shared/materiality-floor.md`'s floor test on each
section reaching here, `{reason}` from the fix-exhaust gate above:
`node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason} --size {size} --priority {priority} --risk {risk} --agent-raised`.
`digest` routes it to the digest container instead (log the contract's `AUTO` line when a run
directory resolves; skip the steps below); `file` stages it as below; `refused` or any other
outcome makes it an `open` ledger item for Phase 2's drill, naming the command's output.
````

- [ ] **Step 4: Run and see it pass**

Run: `node --test tests/materiality-floor-conformance.test.js tests/deferral-gate-conformance.test.js tests/ledger-row-writer-conformance.test.js tests/wrap-up-flaky-escalation-row.test.js tests/bin-lib/wrap-up/ledger-write.test.js tests/absence-grep-control-check-prose.test.js`
Expected: both wrap-up deferral-site tests PASS; summary-surfacing tests (whitespace-collapsed `digest comment URL and the count routed`) PASS; all other files PASS unmodified. `wc -c` prints 17205 for residue-sweep.md (≤ 17222) and 16715 for leftover-routing.md (≤ 16717).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/residue-sweep.md plugin/skills/wrap-up/leftover-routing.md
git commit -m "Route wrap-up residue and leftover deferrals through deferral-route.js — refusal leaves the item for the drill (#5931)" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"
```

### Task 6: Control mode's `belowFloor` comes from the verdict

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/ledger-format.md:211` (control-mode paragraph); `plugin/skills/wrap-up/review-console.md:123` (On approval step 10)
- Test: `tests/control-mode-console-prose.test.js` (`LEDGER_CLAIMS` lines 60-69, `STEP_10_CLAIMS` line 103)
- Read only: `plugin/bin/lib/console/residue-convergence.js` — line 77's `item.belowFloor === true` is the consumer; its tests run unmodified in Step 4.

Pin inventory: `STEP_10_CLAIMS` row 103 `` '`belowFloor` judged per `_shared/materiality-floor.md`' `` — retargeted to `` ['`belowFloor` per `bin/deferral-route.js`', 'step 10 does not set an insight item belowFloor from bin/deferral-route.js'] ``. `LEDGER_CLAIMS` gains two rows (the narrowing slice runs from `#### Ledger narrowing` to `\nAfter Phase 1 (and, when the capability`, so it holds line 211): `` ['prints `digest`', 'the control-mode paragraph does not set belowFloor from a digest verdict'] `` and `` ['no call and `false` with no `deferReason`', 'the control-mode paragraph does not skip the command for an item with no deferReason'] ``. The existing go-red loops cover all three rows.

- [ ] **Step 1: Edit the three rows** in `tests/control-mode-console-prose.test.js` as listed.

- [ ] **Step 2: Run and see it fail**

Run: `node --test tests/control-mode-console-prose.test.js`
Expected: FAIL — `AC2.1: ledger-format.md routes every open item …` reports the two new messages; `AC2.1: review-console.md step 10 …` reports `step 10 does not set an insight item belowFloor from bin/deferral-route.js`; the three matching go-red tests fail on the missing needle.
Run: `node --test --test-name-pattern "deferral site plugin/skills/_shared/ledger-format.md" tests/materiality-floor-conformance.test.js`
Expected: FAIL — `["no paragraph holds the deferral-route.js command form"]`.

- [ ] **Step 3: Edit the two files.**

`ledger-format.md` line 211, replace `` `belowFloor` judged per `_shared/materiality-floor.md`, `deferReason` per `wrap-up/residue-sweep.md`'s `remedy: record` mapping (omitted when no mapping applies) — `` with:

````text
`deferReason` per `wrap-up/residue-sweep.md`'s `remedy: record` mapping (omitted when no mapping applies), `belowFloor` `true` only when `node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason} [--severity {severity}] --size {size} --priority {priority} --risk {risk} --agent-raised` prints `digest` (`false` on `file`, `refused` or any other outcome; no call and `false` with no `deferReason`) —
````

(`{reason}` is the item's mapped `deferReason`; `--severity` only when the item records a finding severity, per `_shared/materiality-floor.md`'s Applying the floor.) The item JSON shape `{ "id", "source", "text", "status", "deferReason", "belowFloor" }` is unchanged.

`review-console.md` line 123, replace `` `belowFloor` judged per `_shared/materiality-floor.md`; `` with `` `belowFloor` per `bin/deferral-route.js`; `` — the sentence already names `_shared/ledger-format.md`'s control-mode paragraph as the call it follows.

- [ ] **Step 4: Run and see it pass (AC4.1)**

Run: `node --test tests/control-mode-console-prose.test.js tests/materiality-floor-conformance.test.js tests/bin-lib/console/residue-convergence.test.js tests/deferral-gate-conformance.test.js tests/ledger-reader-ownership-conformance.test.js tests/staged-patch-contract.test.js`
Expected: PASS, every file — all six deferral-site tests now green; `residue-convergence.test.js` and `deferral-gate-conformance.test.js` unmodified. `wc -c` prints 45196 for ledger-format.md (+252, under the 52,500 rail) and 43997 for review-console.md (≤ 44011).
Then the AC4.1 real-writer probe (plan-time run, recorded): spawn the CLI for `blocked-external` all axes low → `digest`; `blocked-external` priority medium → `file`; `not-a-reason` → exit 2 `refused`; map each to `belowFloor = verdict === 'digest'` and pass the items to the real `convergeResidue` (`plugin/bin/lib/console/residue-convergence.js`) with `compose: () => null`. Observed at plan time: `ledger-1: exit 0 verdict digest` → `digested`; `ledger-2: exit 0 verdict file` → `carried`; `ledger-3: exit 2 verdict refused` → `carried`. Re-run it from a scratch script (uncommitted), write its output to `$PIPELINE_RUN_DIR/evidence/5931-ac4-converge.txt`, and log an `AC evidence` entry as in Task 1 Step 2 naming `AC4.1`.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/ledger-format.md plugin/skills/wrap-up/review-console.md tests/control-mode-console-prose.test.js
git commit -m "Set control-mode belowFloor from the deferral-route verdict — ledger items and console insights alike (#5931)" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"
```

### Task 7: Verify the acceptance criteria and the corpus suites

**Role:** transcription
**Review risk:** low

**Files:**
- Test: `tests/materiality-floor-conformance.test.js`, `tests/deferral-gate-conformance.test.js`, `tests/bin-lib/deferral-route/route.test.js`, `tests/deferral-route-cli.test.js`, and the corpus suites in Step 3 (no edits)
- Waived `bin/deferral-route.js`: landed in #5930 and read only; Step 1 runs it for AC3.
- Waived `docs/skill-authoring.md`: read for the plugin-root placeholder rule, quoted in Global Constraints; no edit.

- [ ] **Step 1: AC3 — run the review routing's documented command with the fixture values** (the staging paragraph's form, placeholders filled):

Run: `node plugin/bin/deferral-route.js --defer-reason pre-existing-outside-diff --severity low --size low --priority low --risk low --agent-raised`
Expected (observed at plan time): `{"verdict":"digest","rule":"floor","input":{"deferReason":"pre-existing-outside-diff","severity":"low","size":"low","priority":"low","risk":"low","agentRaised":true}}`, exit 0 — AC3.1.
Run: `node plugin/bin/deferral-route.js --defer-reason pre-existing-outside-diff --severity high --size low --priority low --risk low --agent-raised`
Expected (observed at plan time): `{"verdict":"file","rule":"severity","input":{"deferReason":"pre-existing-outside-diff","severity":"high","size":"low","priority":"low","risk":"low","agentRaised":true}}`, exit 0 — AC3.2.
Write both outputs to `$PIPELINE_RUN_DIR/evidence/5931-ac3-verdicts.txt` and log an `AC evidence` entry naming `AC3.1` and `AC3.2`.

- [ ] **Step 2: AC2.3, AC6.1 and the CLI's own suites**

Run: `node --test tests/materiality-floor-conformance.test.js tests/deferral-gate-conformance.test.js tests/bin-lib/deferral-route/route.test.js tests/deferral-route-cli.test.js`
Expected: PASS, every file. `git diff --stat {base}..HEAD -- tests/deferral-gate-conformance.test.js tests/bin-lib/console/residue-convergence.test.js` prints nothing, `{base}` being the commit before Task 1 (`9820223283` at plan time) — AC6.1 and AC4.1's "unmodified". In `tests/materiality-floor-conformance.test.js`, `git diff {base}..HEAD` shows the no-restatement test (lines 192-202 at base) unchanged — AC2.3.

- [ ] **Step 3: Corpus suites every skill edit can trip**

Run: `node --test tests/skill-prose-plugin-root-invocations.test.js tests/skill-fence-guard-shapes.test.js tests/session-tmp-placeholder-quoting-conformance.test.js tests/skill-size-single-source.test.js tests/skill-graph-dangling-pointer.test.js tests/release-run-dir-lifecycle-conformance.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/bin-lib/skill-audit/anti-patterns.test.js tests/bin-lib/skill-audit/house-structure.test.js`
Expected: PASS, every file.

- [ ] **Step 4: AC1.1 and the repo-wide command-form sweep**

Run: `git grep -c -F 'node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason}' -- plugin/skills`
Expected: one count each for `_shared/ledger-format.md`, `_shared/materiality-floor.md`, `reflect/full-mode.md`, `review/step3-routing.md`, `visual-review/browser-review.md`, `wrap-up/leftover-routing.md`, `wrap-up/residue-sweep.md` — seven files.
Run: `git grep -n -E "always clears|override clears" -- plugin/skills/review/step3-routing.md plugin/skills/reflect/full-mode.md plugin/skills/wrap-up/residue-sweep.md plugin/skills/wrap-up/leftover-routing.md plugin/skills/visual-review/browser-review.md plugin/skills/_shared/ledger-format.md`
Expected: no output. Control, run first against base: `git grep -n -E "always clears|override clears" 9820223283 -- plugin/skills/review/step3-routing.md` matches lines 110 and 111 (seen at plan time), so the search can find its target.

- [ ] **Step 5: AC5.1 sizes.** Run `wc -c` on the eight edited skill files and compare with the Global Constraints table. The PR body's AC5 section lists each file's start → end bytes, names `_shared/materiality-floor.md` (+1323) and `_shared/ledger-format.md` (+252) as growth Deliverable 1 / AC1 require, and states the net (+778). If an upstream merge landed in any of these files after planning, re-measure before reporting (shared-contract-extraction's merge-time rule).

- [ ] **Step 6: Public-contract proof**

Proof(public-contract): The contracts an in-flight run on the previous release reads stay compatible: `tests/bin-lib/deferral-route/route.test.js` (exhaustive oracle plus the byte-pin of `## The floor`/`## Overrides`) and `tests/bin-lib/console/residue-convergence.test.js` pass unmodified, so the prose an older run applies and the verdict the command gives agree, and the control-mode item shape `{id, source, text, status, deferReason, belowFloor}` is unchanged; the Audit line keeps its `AUTO {time} — materiality-floor:` prefix and only its free-text tail gains `rule={rule}`, and `git grep -n -F "routed below floor" -- plugin/bin tests` returns no reader; `bin/deferral-route.js` already sits on this branch, so a skill citing it ships with it in one release.

No commit in this task unless a step above forced a fix; any fix is committed by path with the message style above.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (floor names the code twin and command form) | Task 1 |
| Deliverable 2 (six sites run the command, no restatement) | Tasks 2-6 (plus review-console step 10) |
| Deliverable 3 (`/claude-tweaks:capture` unchanged) | Global Constraints; no task edits it |
| Deliverable 4 (`refused` and any other outcome leave the item open, per site) | Tasks 2-6 text; Task 1 `any other outcome` assertion |
| Deliverable 5 (`--agent-raised` everywhere; control mode `belowFloor` from verdict, no call without `deferReason`) | Task 1 assertion; Task 6 |
| Deliverable 6 (`rule={rule}` in the digest audit line) | Task 1 (Audit line template every site cites) |
| Deliverable 7 (conformance assertion; line-192 test kept) | Task 1 |
| Deliverable 8 / AC5.1 (sizes) | Global Constraints table; Task 7 Step 5 |
| AC1.1 | Task 7 Step 4; Task 1 deferral-site tests |
| AC2.1 | Task 1 deferral-site tests and go-red controls |
| AC2.2 | Task 1 Step 2 (base-tree red, logged) |
| AC2.3 | Task 7 Step 2 |
| AC3.1, AC3.2 | Task 7 Step 1 |
| AC4.1 | Task 6 Step 4 |
| AC6.1 | Tasks 2-6 Step 4; Task 7 Step 2 |
