# Filed-Record Evidence and Run Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two policy frictions on the records an agent files from a run, both off by default. `filed-record-evidence: required` sends an agent-raised item with reason `pre-existing-outside-diff`, `genuinely-larger` or `tangential` to the digest unless the call passes valid `--evidence test:{path}` or `--evidence ref:{id}`. `run-filed-record-cap: {n}` sends an item to the digest once the run's tally holds `{n}` `file` verdicts. The routing sites pass both flags, every digest label comes from one table, `specShapedBody` writes an `Evidence:` line, and this repository sets `required` and a cap of `1`.

**Architecture:** `routeDeferral` (pure) gains two clauses after the floor, fed by four plain inputs (`evidenceRequired`, `evidenceValid`, `cap`, `filedCount`). Two new sibling modules hold the impure parts: `lib/deferral-route/evidence.js` checks an evidence string's form and, for `test:`, its real path under the git top level; `lib/deferral-route/tally.js` counts and appends the run's tally lines. `bin/deferral-route.js` parses `--evidence`, anchors `--run` strictly under the main checkout's pipelines directory (stage-item's `resolveTarget`), resolves the three policy keys, reads the tally, routes, appends, then prints. Prose follows: `_shared/materiality-floor.md` gets the flags, the frictions paragraph and the digest-label table; the seven routing sites pass the flags and cite the table.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose. No dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-19T070031-spec-5930-5931-5932-5933/spec-5933/work/5933-spec.md`

Scope keywords: filed-record-evidence, run-filed-record-cap, deferral-route-tally, checkEvidence, provenance.evidence, digest-label table

## Fact-check of the spec (checked at plan time on base 2f7da5969a; re-checked on the merged tree 4fb37dacc)

- **Revision 2 (after plan review round 1, the merge of origin/main through 3ff22a37e0, and the record's two `**Decision**` paragraphs).** Between 2f7da5969a and 4fb37dacc only `plugin/bin/lib/policy-schema.js`, `plugin/skills/_shared/policy-schema.md`, `policy-schema-coverage.md`, `policy-schema-model-profiles.md`, `docs/journeys/resolve-a-policy-key.md`, `tests/policy-schema.test.js` and one `init/bootstrap` file changed among the files this plan reads (`git diff --stat 2f7da5969a HEAD`); `route.js`, `route.test.js`, `deferral-route.js`, its CLI test, `materiality-floor-conformance.test.js`, `record-payload.js` and `record.test.js` are byte-unchanged, so 2f7da5969a stays a valid baseline for every `git diff 2f7da5969a` check below. Line numbers below are from 2f7da5969a: in the policy-schema files locate each edit by its quoted content (the `deferral-digest-reasons` row is now line 324, `POLICY_KEYS` is at 114). The round-1 amendments folded in: Task 4 carries `Review risk: high`; Task 5 states how an `--evidence` value that is neither `ref:` nor `test:` is handled, and adds `deferral-route.js` to `_shared/pipeline-run-dir.md`'s CLI list; Task 8's `--run` at the sites is settled by the Deliverable, no longer a flagged gap.
- **#5932's `--run` has not shipped.** `git log --oneline -3 origin/main -- plugin/bin/deferral-route.js` printed nothing: the CLI exists only on this run's branch. Narrowing the `--run` values it accepts (AC11) breaks no released contract, so no expand-contract step is owed.
- **The resolver's existing `--run` refusal does not cover AC11 (settled fact 3, probed).** `resolvePolicy` calls `anchoredOrOutsideMessage` → `worktree-detect.js`'s `checkRunDirAnchoredOrOutside` (lines 297-309). That accepts any path outside every checkout (`scan === 'none'`) and any path anchored anywhere in the main checkout. Only stage-item's `resolveTarget` (`plugin/bin/lib/stage-item/write.js` lines 50-66) adds `isUnderPipelines`. So the CLI adds the strict guard itself (Task 5). Task 5's AC11 test includes the outside-every-checkout fixture and asserts that `resolvePolicy` alone returns `code: 0` for it. That pins the gap the new guard closes.
- **Nothing else counts a run's filings (settled fact 1).** Confirmed by grep at plan time. `Waived plugin/bin/lib/console/: the spec's ASSUMPTION grep (git grep -n -F "decisions.md" plugin/bin/lib/console/) was run at plan time; the tally file is new and private to deferral-route.js.`
- **The installed 6.173.1 resolver tolerates both new keys in `policy.yml` (settled fact 2).** Task 1 Step 6 re-runs the probe before the `policy.yml` lines land, as the spec's Gotcha asks.
- **The git top level for `test:` evidence.** `resolvePolicyConfig` falls back to the cwd when `git rev-parse --show-toplevel` fails (`policy-schema.js` lines 1004-1010), so its `root` cannot tell "no repository" from "repository at the cwd". The CLI therefore runs its own `git rev-parse --show-toplevel` through `callerDeps`' bounded `git` (`windowsHide: true`, injected `env`), and only when `test:` evidence actually needs checking. A failure means there is no top level, and `test:` evidence is then invalid.
- **An integer key with no default.** Unset resolves `{ value: undefined, source: 'default' }` (`resolveValue` line 570 returns `entry.default`), and an invalid value resolves the same with `invalid: true`. `fleet-daily-grant-cap` (line 237) is the precedent.
- **`DEFER_REASONS`' code home** is `plugin/bin/lib/issues/record.js`. `route.js` imports it from `../issues/record`, and `record-payload.js` re-exports it.
- **`tiebreak.js` already uses the word `no-evidence`** (`plugin/bin/lib/tiebreak.js:329`) as a tiebreak-parse reason. That is a different vocabulary in a different module, with no shared reader. `RULES` is read only by `route.test.js` and the CLI's output.
- **Consumers of the changed surfaces.**
  - `routeDeferral` is called only by `plugin/bin/deferral-route.js` and `tests/bin-lib/deferral-route/route.test.js` (`git grep -n -F routeDeferral -- plugin tests tools`).
  - The CLI's `run` is called by `tests/deferral-route-cli.test.js` and by `tests/materiality-floor-conformance.test.js`'s `routeVerdict`. That one runs with a policy-free cwd and `env: {}`, so it reaches neither the evidence `git` call nor the tally.
  - `specShapedBody` gains an optional field. Its callers pass none, so their output is byte-identical (Task 6's characterization test).
- **The sites pass `--run` (settled by the Deliverable).** The Technical Approach says "every routing site gets the cap without change", but each of the seven `DEFERRAL_SITES` (`tests/materiality-floor-conformance.test.js` lines 213-221) carries its own copy of the command, and none passes `--run`; without `--run` there is no cap. The Deliverable "`materiality-floor.md`'s command form gains `--evidence` and `--run`" settles it: Task 8 adds `[--evidence {evidence}] [--run "$PIPELINE_RUN_DIR"]` to each site's command, and that flag is the code path that produces the effect.
- **Digest labels (record Decision 2).** One digest-label table in `materiality-floor.md` names the label for every digest rule (`floor`, `policy-reason`, `no-evidence`, `run-cap`), and every routing site cites it instead of restating labels, replacing the per-site labels #5932 pinned (`LABEL_SITES`, `tests/materiality-floor-conformance.test.js` lines 1105-1146). Task 7 writes the table; Task 8 changes the nine label sites to cite it.
- **Who may set the keys (record Decision 1).** Both are `policyOnly`: only `.claude-tweaks/policy.yml` sets them, a run's `config.yml` cannot, so a run never loosens the evidence rule or raises its own cap, and `set-config.js` writes neither key. `--run` still names the run directory for the tally and for `deferral-digest-reasons`' run overlay; it does not overlay these two keys. Task 1 pins it.

## Global Constraints

- Key names are final: `filed-record-evidence` (`enum ['off', 'required']`, default `off`) and `run-filed-record-cap` (`integer`, `min: 0`, no default). Both `policyOnly: true`, `category: 'pipeline-behavior'`, `tier: 'advanced'`.
- `rule` values are only added: `no-evidence` and `run-cap`. Verdicts stay `file`, `digest`, `refused`. `RULES` becomes `['refused', 'human', 'severity', 'policy-reason', 'tangential', 'not-low', 'floor', 'no-evidence', 'run-cap']`.
- Precedence: refused; human files; `high`/`critical` severity files (and is counted); a listed digest reason digests; the three-axis floor; then evidence; then the cap. Evidence and the cap act only on an agent-raised item whose verdict would otherwise be `file` on rule `tangential` or `not-low`.
- Evidence reasons: exactly `pre-existing-outside-diff`, `genuinely-larger`, `tangential`. Exempt: exactly `needs-human-decision`, `blocked-external`, `blocked-dependency`, `needs-verification`. A `DEFER_REASONS` member in neither list fails a test.
- Evidence form: `test:{path}` or `ref:{id}`, with `kind` the text before the first `:`, lowercase and exact. `ref` ids match `/^(?:#\d+|IL-\d+)$/`. `test` paths:
  - Rejected, in this order: an absolute path (`/^(?:[\\/]|[A-Za-z]:[\\/])/`, a leading `/` or `\`, or a drive root), a scheme prefix (`/^[A-Za-z][A-Za-z0-9+.-]*:/`), any `%`, a trailing `/` or `\`. Absolute comes before scheme, so a win32 drive path reports `absolute` and not `scheme`.
  - Resolved with `path.resolve(topLevel, path)`, then realpath'd, never `join`. With `resolve`, an absolute path inside the tree would otherwise be valid, so the absolute guard is the only thing that decides that case.
  - Valid only when the real path is a regular file under the real top level.
  - Invalid evidence is treated as none. The check is form-only: `ref` existence is out of scope.
- Tally: `{run-dir}/deferral-route-tally.log`. One line per agent-raised final `file` verdict, `{ISO}\t{reason}\t{rule}\n`. The count is the number of non-empty lines. The tally is read only when a cap is set and `--run` is given. A line is appended only on a final `file` verdict for an agent-raised item, with a cap and `--run`. Writes are create-or-append with no lock, which is best-effort under concurrency. A missing tally (`ENOENT`) counts 0. Any other read or append failure is exit 1 with a line naming the path, and nothing on stdout.
- CLI exit codes: 0 a verdict or `--help`. 1 the run directory or policy could not be used: the cwd is unreadable, `--run` is missing or not under the main checkout's `.claude-tweaks/pipelines/`, the resolver refused, or the tally could not be read or appended. 2 refused, which still wins over every exit-1 cause. The `input` echo keeps its six keys. Neither `--evidence` nor `--run` is echoed. `realDeps` keeps exactly `cwd`, `env`, `stderr`, `stdout`.
- Tests:
  - One file per `node --test <file>` call, in the foreground. Never the full suite: it runs centrally later.
  - A test that reads a repo-rooted file uses `tests/helpers/read-skill.js`'s `readText`. Scratch directories use `tests/helpers/tmp-dir.js`'s `scratchDir` (two conformance suites enforce both).
  - Every new test is shown red against the pre-change code, either in Step 2 or by the named mutation. A characterization test is green before the change on purpose. Its discrimination is a named mutation instead.
- Commits: `git commit -m "{Verb} {what} — {detail}" -m "Refs #5933" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"`. Stage files by path. Never `git add -A`, `git stash` or `git reset`.
- No new source scan, so `bin-source-scan-conformance` does not apply. New `plugin/bin/lib/` files carry no `existsSync`/`realpathSync` token (`tests/path-guard-conformance.test.js`). Path checks go through `plugin/bin/lib/path-guard` (`resolveLeaf`, `canonicalRealpath`, `isAncestorOrSelf`, `lstatType`), and a file read catches `ENOENT` instead of probing first.
- Paths in test assertions are built with `path.join` on the fixture's own path (`windows-checkout-test-parity`). A test that needs a symlink skips on `EPERM`/`EACCES` from `fs.symlinkSync`. The `file:` scheme fixture skips on `win32`, where `:` cannot appear in a file name.
- Governing skill `.claude/skills/policy-key-addition/SKILL.md`, quoted verbatim:
  - "`tests/policy-schema.test.js` pins `POLICY_KEYS.length`. Bump it in the same commit, and rewrite the `Last bump: {old} -> {new}, #{record}` line directly above the assertion — the test fails when that line's new value differs from the pin."
  - "Every key needs a table row there that starts `` | `{key}` | `` (`tests/policy-key-naming.test.js`), and its summary must not be copied verbatim from the row's `summary` (`tests/policy-schema-metadata.test.js`). State the value the resolver returns for unset, set and malformed input, from the code, not from intent."
  - "**A `policyOnly` key** is also named in the `policyOnly` bullet of `_shared/policy-schema-coverage.md`'s \"Canonical read path carve-outs\", which lists every key carrying the flag"
  - "**A `policyOnly` key** is also named in the step 3 Red flags list of `docs/journeys/resolve-a-policy-key.md`, which lists every `policyOnly` flat key with its record."
  - "Every new key gets this decision, even when the answer is neither flag. … Say the decision in the comment above the row, as both of those do."
  - "The core tier has an enforced cap of 12 (`tests/policy-schema-metadata.test.js`) and sits at it, so a new key is `advanced` unless it replaces a core one."
  - "**Pin each new validation branch with its own assertion.**"
  - "a malformed value arrives as `source: 'default'` with `invalid: true`, never as a non-default source, so a `source !== 'default'` guard never sees it. Key such a guard on `invalid`"
- Governing skill `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`, quoted verbatim:
  - "Read `deps.cwd()` only where a relative path or a child process needs it"
  - "A relative path is resolved against `deps.cwd()`, never left to `path.resolve` or `fs`"
  - "Every child process is started with a `cwd` derived from `deps.cwd()` and with `env: deps.env`"
  - "An existence or type check goes through `plugin/bin/lib/path-guard`'s `lstatType`, never a bare `fs.existsSync`"
  - "A file the CLI is about to read is read directly with `ENOENT`/`ENOTDIR` caught as \"absent\", never checked for existence first"
  - "Changing an existing CLI's exit code is a contract change — sweep every statement of the old code before calling it done."
  - "Adding a CLI to a named exit-code family needs the same sweep: every list that names its siblings gains the new CLI."
- Governing skill `.claude/skills/gh-api-module-pattern/run-dir-boundary-guards.md`, quoted verbatim:
  - "Import the copy that sits beside the writer you call when you add another writer instead of re-deriving the predicate"
  - "a fixture for it needs the sibling-prefix case (`.claude-tweaks/pipelines-copy/<id>`), the one a string-prefix check wrongly accepts."
  - "pin the refusal with a fixture carrying both a real main-checkout run dir and a worktree-local shadow of it"
- Governing skill `.claude/skills/run-directory-fact-packs/SKILL.md`, quoted verbatim: "**Absence is ENOENT, not a null read.**" and "A probe that branches on a file's absence gets two fixtures: the file missing, and the file present but unreadable." The tally deviates from the wrapper contract's `ENOTDIR`-as-absent on purpose. The run dir has already been checked to be a directory, so `ENOTDIR` means it changed underneath the call, and that fails loud.
- Governing skill `.claude/skills/skill-prose-conformance-tests/SKILL.md`, quoted verbatim: "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`." "copy the pinned literal out of the edit's own replacement text, never from memory of what that edit says." "**A clause pinned to its row or paragraph owes a move-out control, not only a deletion.**"
- Sizes (`wc -c`; rail `RAIL_BYTES` = 52,500, `plugin/bin/lib/skill-audit/budgets.js`):

  | File | Start | Planned change | Headroom after |
  |---|---|---|---|
  | `plugin/skills/_shared/policy-schema.md` | 51471 (merged tree; #5915 added 131 bytes) | +~90 (two key-only rows, intro words) | ~940 (98% of rail; key-only stubs as the spec requires) |
  | `plugin/skills/_shared/pipeline-run-dir.md` | 24868 | +~0.4 KB (Task 5's CLI-list sentence) | ~27 KB |
  | `plugin/skills/_shared/policy-schema-deferral-routing.md` | 1725 | +~1.6 KB | ~49 KB |
  | `plugin/skills/_shared/materiality-floor.md` | 16016 | +~1.9 KB | ~34.6 KB |
  | `plugin/skills/_shared/deferral-gate.md` | 8141 | +~0.8 KB | ~43.5 KB |
  | `plugin/skills/_shared/ledger-format.md` | 45263 | −~0.1 KB (citation is shorter) | ~7.3 KB |
  | `plugin/skills/_shared/policy-schema-coverage.md` | 44438 | +~50 | ~8 KB |
  | the other six site files | ≤ 39853 | about ±0.1 KB each | ≥ 12.6 KB |

## Review Focus

1. **A `--run` with the cap unset, and a cap with no `--run`.** With `--run`, the verdict is unchanged and no tally file is written. With a cap but no `--run`, there is no cap: no read, no write, `file`. Task 5's `review focus 1` test pins both.
2. **An invalid policy value.** `filed-record-evidence: yes`, `run-filed-record-cap: -1`, `two` or `1.5` each give one stderr warning naming the key and the raw value, then routing with the default (`off`, or no cap). It never exits non-zero, and is never read as `required` or as a cap. Task 5's `review focus 2` test pins this.
3. **`--evidence` that does not apply.** It is ignored when the key is `off` or the reason is exempt, so the verdict is unchanged. `--evidence` as the last token is refused with `--evidence needs a value`. Given twice, it is refused with `--evidence given more than once`. It is never echoed in `input`. Task 5's `review focus 3` test pins this.
4. **A tally holding blank lines, CRLF line ends or arbitrary text.** The count is the number of non-empty lines, so content is never "malformed". Task 4's `review focus 4` test pins this.
5. **A `test:` path that is fine but unusual.**
   - It resolves against the git top level, not the cwd. A cwd in a subdirectory still validates `test:tests/example.test.js` (Task 5's `review focus 5`).
   - A symlink inside the tree to a file inside the tree is valid. `test:tests` (a directory with no trailing slash) is invalid, problem `not-a-file` (Task 2's `review focus 5`).

---

### Task 1: The two policy keys, their docs, and this repository's values

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (two rows after `deferral-digest-reasons`, line 324 on the merged tree, with one comment above them)
- Modify: `plugin/skills/_shared/policy-schema.md` (the `## Deferral routing` stub, lines 199-205)
- Modify: `plugin/skills/_shared/policy-schema-deferral-routing.md` (intro line 5; two table rows)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md:102` (the `policyOnly` list)
- Modify: `docs/journeys/resolve-a-policy-key.md:47` (step 3 Red flags `policyOnly` list)
- Modify: `.claude-tweaks/policy.yml` (two lines after line 19)
- Modify: `tests/policy-schema.test.js:46-48` (114 → 116; the merge brought it to 114)
- Test: `tests/policy-deferral-frictions.test.js` (new; precedent `tests/policy-deferral-digest-reasons.test.js`)
- Waived `.claude/skills/policy-key-addition`: read for this task's Global Constraints quotes, no change (no new mechanism).

**Interfaces:**
- Produces two `POLICY_KEYS` rows:
  - `{ key: 'filed-record-evidence', type: 'enum', values: ['off', 'required'], default: 'off', policyOnly: true, summary, category: 'pipeline-behavior', tier: 'advanced' }`
  - `{ key: 'run-filed-record-cap', type: 'integer', min: 0, policyOnly: true, summary, category: 'pipeline-behavior', tier: 'advanced' }` (no `default`).
- Task 5 resolves both through `resolvePolicy`.

- [ ] **Step 1: Write the failing tests** in `tests/policy-deferral-frictions.test.js`. Use `resolveOne(key, opts)` as in the #5932 file, collecting `onInvalid` calls.
  - `#5933 filed-record-evidence row: enum off|required, default off, policyOnly, advanced, pipeline-behavior`. Check `type`, `values` deepEqual `['off','required']`, `default === 'off'`, `policyOnly === true`, `!policySourceExcluded`, `tier`, `category`.
  - `#5933 run-filed-record-cap row: integer, min 0, no default, policyOnly`. Check `type === 'integer'`, `min === 0`, `!('default' in row)`, `policyOnly === true`, `tier`, `category`.
  - `#5933 filed-record-evidence resolves off when unset, required when set, off with invalid on any other value`:
    - `'autonomy: trusted\n'` → `{ value: 'off', source: 'default' }`.
    - `'filed-record-evidence: required\n'` → `{ value: 'required', source: 'policy' }`.
    - For each raw in `['yes', 'Required', 'on']`: `{ value: 'off', source: 'default', invalid: true }`, with `onInvalid` called once with `[key, raw]`.
  - `#5933 run-filed-record-cap resolves no value when unset, the integer when set, no value with invalid otherwise`:
    - Unset → `{ value: undefined, source: 'default' }`.
    - `'1'` → `{ value: 1, source: 'policy' }`. `'0'` → `{ value: 0, source: 'policy' }`.
    - For each raw in `['-1', 'two', '1.5']`: `{ value: undefined, source: 'default', invalid: true }`, plus one `onInvalid` call.
  - `#5933 policyOnly: a run config never sets either key`:
    - `policyRaw: 'run-filed-record-cap: 1\nfiled-record-evidence: required\n'` with `runConfigRaw: 'run-filed-record-cap: 9\nfiled-record-evidence: off\n'` → `1`/`policy` and `required`/`policy`.
    - `runConfigRaw` alone → both from `default`.
  - `#5933 this repository sets filed-record-evidence: required and run-filed-record-cap: 1`: `resolvePolicyKeys` over `readText(REPO_POLICY)` gives `required` and `1`, both `source: 'policy'`, neither `invalid`.
  - In `tests/policy-schema.test.js`, change line 46 (today `// Last bump: 113 -> 114, #5932`) to `// Last bump: 114 -> 116, #5933`, and lines 47-48 to `116`.
  - Guard discrimination:
    - Deleting `min: 0` makes `'-1'` resolve `-1`, which is red.
    - Deleting `policyOnly: true` from either row turns the policyOnly test red.
    - Deleting `values` makes `isValidValue` throw.

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F "filed-record-evidence" -- plugin/bin/lib/policy-schema.js`
Expected: FAIL. Exit 1, no match (probed at plan time).
Run: `node --test tests/policy-deferral-frictions.test.js`
Expected: FAIL after Step 1. Every test fails: no row exists, and `policy.yml` lacks the lines.

- [ ] **Step 3: Implement the rows** in `plugin/bin/lib/policy-schema.js`, directly after the `deferral-digest-reasons` row.
  - The comment above the rows: `// #5933: read by bin/deferral-route.js through resolve-policy.js's resolvePolicy (routeDeferral's no-evidence and run-cap rules). policyOnly: both bound what a run may file, so a run's own config.yml must never loosen them (set-config.js writes neither). Not Manifesto levers.`
  - Summaries (at most 140 characters, without the key name): evidence `"Requires an agent-filed record of three Defer-reasons to name a test file or record; without it the item goes to the digest."`, cap `"Caps how many records one pipeline run's agents may file; past it an item goes to the digest. Leave it unset for no cap."`.

- [ ] **Step 4: Write the docs**
  - `policy-schema.md`'s stub. The intro line becomes `Registered by #5932 and #5933; read by \`bin/deferral-route.js\`. Full rows: \`policy-schema-deferral-routing.md\`.` Add the rows `` | `filed-record-evidence` | `` and `` | `run-filed-record-cap` | `` under the existing one.
  - `policy-schema-deferral-routing.md` line 5 becomes: `Registered by #5932 (\`deferral-digest-reasons\`) and #5933 (\`filed-record-evidence\`, \`run-filed-record-cap\`). \`bin/deferral-route.js\` reads all three through \`bin/resolve-policy.js\`'s resolver, from \`policy.yml\`. A run's \`config.yml\` overlays \`deferral-digest-reasons\` when the call passes \`--run {dir}\`; the other two are \`policyOnly\`, so a run's own config never loosens them. None is a Manifesto lever. \`_shared/materiality-floor.md\`'s Overrides section and Applying the floor give their places in the precedence.` Append two rows in the same five columns:
    - `` | `filed-record-evidence` | `policy.yml` | `bin/deferral-route.js` | `off` | `off` or `required`. With `required`, an agent-raised item the route would file whose `Defer-reason:` is `pre-existing-outside-diff`, `genuinely-larger` or `tangential` needs `--evidence test:{path}` (a regular file whose real path is under the working tree's git top level) or `--evidence ref:{id}` (`#{digits}` or `IL-{digits}`); without valid evidence it goes to the digest, rule `no-evidence`. The other four reasons need none. Unset resolves `off`; any other value resolves `off` with `invalid: true`, and `bin/deferral-route.js` prints one stderr warning naming the key and the value. `policyOnly`: a run's `config.yml` value is ignored. | ``
    - `` | `run-filed-record-cap` | `policy.yml` | `bin/deferral-route.js` | unset (no cap) | A non-negative integer. With a value and a call passing `--run {dir}`, `bin/deferral-route.js` appends one line to `{dir}/deferral-route-tally.log` for each agent-raised `file` verdict, and an item that would file once the tally holds that many lines goes to the digest, rule `run-cap`; a `high`/`critical` severity still files and is counted. `0` digests every such item. A call without `--run` is never capped. The tally is per `--run` directory: a multi-spec run's per-spec `spec-{N}/` directories keep separate tallies. Unset resolves to no value; a negative or non-integer value resolves to no value with `invalid: true` and one stderr warning. `policyOnly`. | ``
  - `policy-schema-coverage.md:102`: after `` `changelog-max-releases` `` insert `` , `filed-record-evidence` and `run-filed-record-cap` (#5933) ``. Keep the sentence's "are `policyOnly`" ending, and move its "and" so the list still reads correctly.
  - `resolve-a-policy-key.md:47`: after `` `changelog-max-releases`, #5563 `` insert `` ; `filed-record-evidence`, `run-filed-record-cap`, #5933 ``.

- [ ] **Step 5: Run and see it pass**

Run, one at a time: `node --test tests/policy-deferral-frictions.test.js`, `node --test tests/policy-schema.test.js`, `node --test tests/policy-key-naming.test.js`, `node --test tests/policy-schema-metadata.test.js`, `node --test tests/resolve-policy-control-mode.test.js`, `node --test tests/policy-deferral-digest-reasons.test.js`, `node --test tests/skill-size-single-source.test.js`
Expected: PASS for each file. Note that the repo-values test still fails until Step 7 lands the `policy.yml` lines. Run it again after Step 7. `wc -c plugin/skills/_shared/policy-schema.md` prints at most 52500. Record the value in the commit body.

- [ ] **Step 6: Re-probe the installed resolver before the `policy.yml` lines** (spec Gotcha; settled fact 2 held at plan time)
  - Write a scratch node script with the Write tool, into the session scratchpad. The script does five things:
    1. Makes a temp dir and runs `git init -q` in it.
    2. Writes `.claude-tweaks/policy.yml` holding `autonomy: trusted\nfiled-record-evidence: required\nrun-filed-record-cap: 1\n`.
    3. Runs `process.argv[2]` (the installed `resolve-policy.js`) with `--values autonomy` and with `--values filed-record-evidence`, through `spawnSync(process.execPath, …, { cwd, encoding: 'utf8' })`.
    4. Prints each exit code, stdout and stderr.
    5. Removes the dir.
  - Run it once: `node "{script}" "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js"`.
  - Expected: both calls exit 0, and `autonomy` prints `trusted`.
  - If either call exits non-zero, or `autonomy` is not `trusted`:
    - Leave Step 7's lines out, and drop the repo-values test.
    - Name the release they wait for in the PR body.
  - Either way, log one entry: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "policy.yml probe" --text-file "{text-file}"`.

- [ ] **Step 7: Append to `.claude-tweaks/policy.yml`**, after `deferral-digest-reasons: …`: `filed-record-evidence: required` and `run-filed-record-cap: 1`. Then run `node --test tests/policy-deferral-frictions.test.js`. Expected: PASS, every test.

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/lib/policy-schema.js plugin/skills/_shared/policy-schema.md plugin/skills/_shared/policy-schema-deferral-routing.md plugin/skills/_shared/policy-schema-coverage.md docs/journeys/resolve-a-policy-key.md .claude-tweaks/policy.yml tests/policy-schema.test.js tests/policy-deferral-frictions.test.js
git commit -m "Add the filed-record-evidence and run-filed-record-cap policy keys — policyOnly frictions on what a run files, set to required and 1 in this repo" -m "Refs #5933" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"
```

### Task 2: The evidence check

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/deferral-route/evidence.js`
- Test: `tests/bin-lib/deferral-route/evidence.test.js` (new)

**Interfaces:**
- Produces `checkEvidence(text, { topLevel, fsImpl, realpath } = {}) -> { valid: true, kind, ref } | { valid: false, problem }`.
  - `topLevel` is an absolute path, or `null` when there is no git top level.
  - `problem` is one of the frozen `EVIDENCE_PROBLEMS`: `'empty'`, `'form'`, `'kind'`, `'empty-ref'`, `'ref-id'`, `'absolute'`, `'scheme'`, `'percent'`, `'trailing-slash'`, `'no-top-level'`, `'missing'`, `'outside'`, `'not-a-file'`.
  - Checks run in exactly that order:
    - Not a string, or `''` → `empty`.
    - No `:` → `form`.
    - Kind not `test`/`ref` → `kind`.
    - Ref `''` → `empty-ref`.
    - `ref` kind failing `REF_ID_RE` → `ref-id`.
    - For `test`: `absolute`, `scheme`, `percent` and `trailing-slash`, in that order, by the Global Constraints patterns. Then `topLevel` null, or `canonicalRealpath(topLevel)` null → `no-top-level`. Then `resolveLeaf(path.resolve(topLevel, ref))` not `resolved` → `missing`. Then `!isAncestorOrSelf(realTop, leaf.path)` → `outside`. Then `lstatType(leaf.path).type !== 'file'` → `not-a-file`.
  - `ref` evidence never touches the filesystem.
- Also exports `EVIDENCE_KINDS` (`['test','ref']`, frozen), `REF_ID_RE` and `EVIDENCE_PROBLEMS`.
- Requires only `path` and `../path-guard`. It does not import `route.js`.

- [ ] **Step 1: Write the failing tests** in `evidence.test.js`. The fixture is `PARENT = scratchDir('ct-evidence-', { realpath: true })`, removed in `after`, holding:
  - `ROOT = PARENT/root`, with `ROOT/tests/example.test.js` and `ROOT/%41.js`.
  - `PARENT/outside.js`.
  - Symlinks `ROOT/link.js → PARENT/outside.js` and `ROOT/inlink.js → ROOT/tests/example.test.js`, each skipped on `EPERM`/`EACCES`.
  - `ROOT/file:/x.js`, not on win32.

  `const check = (text, topLevel = ROOT) => checkEvidence(text, { topLevel })`. Assert exact objects:
  - `AC4.1 ref:#1234 and ref:IL-85 are valid` → `{ valid: true, kind: 'ref', ref: '#1234' }` and the `IL-85` twin, also with `topLevel: null`.
  - `AC4.2 ref:soon is not valid` → `{ valid: false, problem: 'ref-id' }`. The same for `ref:#`, `ref:IL-`, `ref: #12` and `ref:#12x`.
  - `AC3.1 test:../outside.js, test:missing.test.js and note:anything are invalid` → `outside`, `missing`, `kind`.
  - `AC3.2 a/../../outside.js, /etc/passwd, file:///etc/passwd, %2e%2e/outside.js, tests/ and an escaping symlink are invalid` → `outside`, `absolute`, `scheme`, `percent`, `trailing-slash`, `outside` (`test:link.js`).
  - `AC12.1 a file-and-line pointer is not evidence` → `checkEvidence('plugin/bin/example.js:10', …)` gives `kind`.
  - `AC2.2 test:tests/example.test.js inside the tree is valid` → `{ valid: true, kind: 'test', ref: 'tests/example.test.js' }`.
  - `form problems`: `''` and `undefined` give `empty`, `'nothing'` gives `form`, `'TEST:tests/example.test.js'` gives `kind`, and `'test:'` and `'ref:'` give `empty-ref`.
  - `no top level makes test evidence invalid, ref evidence still valid`: `test:tests/example.test.js` with `topLevel: null` → `no-top-level`.
  - `review focus 5`: `test:inlink.js` is valid. `test:tests` gives `not-a-file`.
  - `guard discrimination: each test-path guard alone decides one existing in-tree target`. Each of these targets exists inside `ROOT`, so only its own guard rejects it:
    - `test:${ROOT}/tests/example.test.js` (absolute) → `absolute`.
    - `test:%41.js` → `percent`.
    - `test:tests/example.test.js/` → `trailing-slash`.
    - `test:file:/x.js` → `scheme` (skipped on win32).
    - `test:tests` → `not-a-file`.
    - `test:../outside.js`, which exists outside → `outside`.

    The plan states that deleting any one guard turns its own row valid or changes its problem, so its row goes red. On win32 `ROOT` starts with a drive letter. Deleting `absolute` there moves the row to `scheme`, which is still red.

- [ ] **Step 2: Run and see it fail**

Run: `node --test tests/bin-lib/deferral-route/evidence.test.js`
Expected: FAIL. At plan time the test file does not exist. After Step 1, `Cannot find module '../../../plugin/bin/lib/deferral-route/evidence'`.

- [ ] **Step 3: Implement `checkEvidence`** in `plugin/bin/lib/deferral-route/evidence.js`, per the Interfaces block.
  - The header comment says three things:
    - The check is form-only (#5933). It is a speed bump that cannot detect a fabricated citation; `ref` existence and relevance are out of scope.
    - `path.resolve`, not `join`, is used so that the absolute guard is what rejects an in-tree absolute path.
    - It has no `existsSync`/`realpathSync`; every path step is `path-guard`'s.

- [ ] **Step 4: Run, and prove each guard**

Run: `node --test tests/bin-lib/deferral-route/evidence.test.js`
Expected: PASS.
Run: `node --test tests/path-guard-conformance.test.js`
Expected: PASS.
Then, in a scratch copy of `evidence.js`, delete each guard in turn and re-run the evidence test. Expected: each deletion turns its own guard-discrimination row red. Restore the file after each run.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/deferral-route/evidence.js tests/bin-lib/deferral-route/evidence.test.js
git commit -m "Add the deferral-route evidence check — test:{path} must be a real file under the git top level, ref:{id} a #N or IL-N id" -m "Refs #5933" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"
```

### Task 3: The `no-evidence` and `run-cap` rules in `routeDeferral`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/deferral-route/route.js` (header lines 7-23, `RULES` line 29, `routeDeferral` lines 35-54, `module.exports` line 56)
- Test: `tests/bin-lib/deferral-route/route.test.js` (the `constants` test, line 67; new tests after line 239). Lines 36-59 (`AC7.1 exhaustive`) and 169-189 (#5932's exhaustive tests) are **not edited**.

**Interfaces:**
- Produces `routeDeferral({ deferReason, severity, size, priority, risk, agentRaised, digestReasons, evidenceRequired, evidenceValid, cap, filedCount }) -> { verdict, rule, reason? }`.
  - `evidenceRequired` and `evidenceValid` count only when `=== true`.
  - `cap` counts only when `Number.isInteger(cap) && cap >= 0`.
  - `filedCount` is a non-integer → `0`.
  - After the floor's `digest` return, a would-be file with rule `r` (`tangential` or `not-low`) becomes `{ verdict: 'digest', rule: 'no-evidence' }` when evidence is required, the reason is in `EVIDENCE_REASONS` and evidence is not valid. Then it becomes `{ verdict: 'digest', rule: 'run-cap' }` when `filedCount >= cap`. Otherwise it is `{ verdict: 'file', rule: r }`.
- Also exports, frozen: `EVIDENCE_REASONS = ['pre-existing-outside-diff','genuinely-larger','tangential']` and `EVIDENCE_EXEMPT_REASONS = ['needs-human-decision','blocked-external','blocked-dependency','needs-verification']`. `routeDeferral` stays pure.

- [ ] **Step 1a: Write the characterization test first**: `#5933 characterization: friction inputs that are off change no verdict`.
  - Over `COMBINATIONS` × lists `[[], LIST]`, call `routeDeferral({ ...c, digestReasons: list, evidenceRequired: false, evidenceValid: false, cap: undefined, filedCount: 99 })`. It equals `policyOracle(c, list)`. Assert the count is 10752.
  - Run `node --test tests/bin-lib/deferral-route/route.test.js`. Expected: PASS before the change, because today's function ignores the extra keys.
  - Its discrimination is a mutation: in Step 4, treat `cap === undefined` as `0` and it goes red.

- [ ] **Step 1b: Write the failing tests** in `route.test.js`:
  - Set the `constants` test's `RULES` to the nine-rule list from the Global Constraints.
  - `#5933 every DEFER_REASONS member is in exactly one evidence group`:
    - `EVIDENCE_REASONS` deepEquals the literal three.
    - `EVIDENCE_EXEMPT_REASONS` deepEquals the literal four.
    - The two are disjoint.
    - Their sorted union deepEquals `[...DEFER_REASONS].sort()`.
    - Both are frozen.
  - `#5933 exhaustive with frictions: every combination matches the friction oracle`. For each list in `[[], LIST]` and each setting in `FRICTIONS`, run all `COMBINATIONS` and assert `frictionOracle`. Assert the count is 86016 and that every verdict is in `VERDICTS`. The oracle is written from the spec, with the reasons listed literally:

```js
const NEEDS_EVIDENCE = ['pre-existing-outside-diff', 'genuinely-larger', 'tangential'];
function frictionOracle(c, list, f) {
  const base = policyOracle(c, list);
  if (base.verdict !== 'file' || !c.agentRaised || base.rule === 'severity') return base;
  if (f.evidenceRequired && NEEDS_EVIDENCE.includes(c.deferReason) && !f.evidenceValid) return { verdict: 'digest', rule: 'no-evidence' };
  if (f.cap !== undefined && f.filedCount >= f.cap) return { verdict: 'digest', rule: 'run-cap' };
  return base;
}
const FRICTIONS = [
  { evidenceRequired: false, evidenceValid: false, cap: undefined, filedCount: 0 },
  { evidenceRequired: true, evidenceValid: false, cap: undefined, filedCount: 0 },
  { evidenceRequired: true, evidenceValid: true, cap: undefined, filedCount: 0 },
  { evidenceRequired: false, evidenceValid: false, cap: 1, filedCount: 0 },
  { evidenceRequired: false, evidenceValid: false, cap: 1, filedCount: 1 },
  { evidenceRequired: false, evidenceValid: false, cap: 0, filedCount: 0 },
  { evidenceRequired: true, evidenceValid: false, cap: 1, filedCount: 1 },
  { evidenceRequired: true, evidenceValid: true, cap: 1, filedCount: 2 },
];
```

  - `#5933 AC2.1 required: genuinely-larger at not-low axes without valid evidence digests by no-evidence`. `{ deferReason: 'genuinely-larger', size: 'high', agentRaised: true, evidenceRequired: true, evidenceValid: false }` → `digest`/`no-evidence`. `#5933 AC2.2 with valid evidence it files` → `file`/`not-low`.
  - `#5933 AC5.1 required: needs-human-decision with no evidence files` → `file`/`not-low`.
  - `#5933 AC6.1 cap 1: the first would-file files and the second digests by run-cap`: `filedCount` 0 → `file`/`not-low`, and 1 → `digest`/`run-cap`. `#5933 AC6.2 severity high files past the cap, and the next plain call digests`: `severity: 'high', filedCount: 1` → `file`/`severity`. `filedCount: 2`, with no severity → `digest`/`run-cap`.
  - `#5933 AC10.1 cap reached: an exempt needs-human-decision digests by run-cap` → `digest`/`run-cap`. `#5933 AC10.2 the same item from a human files` → `file`/`human`.
  - `#5933 the floor and a policy reason beat the frictions`:
    - A low-axes `genuinely-larger` with evidence required and invalid → `digest`/`floor`.
    - A listed `tangential` with cap 0 → `digest`/`policy-reason`.
  - `#5933 cap 0 digests every agent-raised would-file item` → `run-cap`.
  - `#5933 guards: only true, and only a non-negative integer cap, count`:
    - `evidenceRequired: 'true'` with `genuinely-larger` at `size: 'high'` → `file`/`not-low`.
    - `evidenceValid: 'yes'` with required → `no-evidence`.
    - `cap` in `['1', -1, 1.5, null]` with `filedCount: 5` → `file`/`not-low`.
    - `filedCount: '9'` with `cap: 1` → `file`/`not-low`.
  - `#5933 a refusal ignores the friction inputs`: `not-a-reason` with every friction input on → the same object as without them.

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F "no-evidence" -- plugin/bin/lib/deferral-route/route.js`
Expected: FAIL. Exit 1, no match (probed at plan time).
Run: `node --test tests/bin-lib/deferral-route/route.test.js`
Expected: FAIL after Step 1b. These fail: `constants`, the partition test (the exports are undefined), the friction exhaustive test, AC2.1, AC6.1's second call, AC6.2's last call, AC10.1, `cap 0`, and the `evidenceValid: 'yes'` guard row. These pass: the characterization test, AC2.2, AC5.1, AC10.2, and the floor and policy-reason precedence test, whose rules already hold.

- [ ] **Step 3: Implement in `route.js`.**
  - Destructure the four new inputs.
  - Replace the `tangential` and `not-low` returns with a computed `rule`, then the two friction clauses, then `return { verdict: 'file', rule }`.
  - Append `'no-evidence', 'run-cap'` to `RULES`, and add the two frozen lists and their exports.
  - Header comment: add the inputs, plus the lines `no-evidence — evidenceRequired, deferReason in EVIDENCE_REASONS, evidenceValid !== true -> digest` and `run-cap — cap set and filedCount >= cap -> digest`. Note that both apply only to an agent-raised item the earlier rules would file. The caller counts (`bin/deferral-route.js`'s run tally), so `high`/`critical` severity files are counted though never capped.

- [ ] **Step 4: Run, mutate, and prove the contract unchanged**

Run: `node --test tests/bin-lib/deferral-route/route.test.js`
Expected: PASS, every test.
Mutations, each in a scratch copy and then restored:
- `cap === undefined` treated as `0` → the characterization test goes red.
- Drop the `=== true` on `evidenceRequired` → the `'true'` guard row goes red.
- Swap the two friction clauses → the friction exhaustive test goes red, on `{ required, invalid, cap 1, count 1 }`.
Run: `git diff 2f7da5969a -- tests/bin-lib/deferral-route/route.test.js`
Expected: no hunk inside lines 36-59 or 169-189. The `RULES` line in the `constants` test is the only changed line; everything else is added.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/deferral-route/route.js tests/bin-lib/deferral-route/route.test.js
git commit -m "Add the no-evidence and run-cap rules to routeDeferral — two frictions after the floor on an agent-raised item that would file" -m "Refs #5933" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"
```

### Task 4: The run tally

**Role:** integration
**Review risk:** high (an unlocked tally file shared by parallel callers in one run: the count-then-append race is accepted as best-effort, so review the header's statement of it and that a single-line append is the only write)

**Files:**
- Create: `plugin/bin/lib/deferral-route/tally.js`
- Test: `tests/bin-lib/deferral-route/tally.test.js` (new)
- Waived `plugin/bin/resolve-profile.js`: read as the append-only tally precedent (lines 145-174) for this task's shape. No change, and its cwd-relative `--run-dir` is not copied.
- Waived `plugin/bin/lib/model-profiles/`: the spec's Gotcha names it as the module *not* to copy. Read only to confirm it holds no tally writer.

**Interfaces:**
- Produces:
  - `TALLY_FILE = 'deferral-route-tally.log'`.
  - `readTallyCount(runDir, { fsImpl = fs } = {}) -> number`: the count of lines whose `trim()` is non-empty; `ENOENT` → `0`; any other error is rethrown.
  - `tallyLine({ reason, rule, now }) -> string`: `${now.toISOString()}\t${reason}\t${rule}\n`.
  - `appendTally(runDir, { reason, rule, now = new Date() }, { fsImpl = fs } = {}) -> void`: one `fsImpl.appendFileSync(path.join(runDir, TALLY_FILE), tallyLine(…))`, which throws on failure.
- The header states three things: the file is create-or-append with no lock; it is best-effort under concurrency (parallel callers can each read the count before any append; each single-line append is atomic); and it is private to `deferral-route.js`.

- [ ] **Step 1: Write the failing tests** in `tally.test.js`, each in its own `scratchDir`:
  - `absent tally counts 0`.
  - `appendTally writes one tab-separated line; readTallyCount counts it`. With `now = new Date('2026-11-19T07:00:00.000Z')`, the file equals `2026-11-19T07:00:00.000Z\tgenuinely-larger\tnot-low\n`. A second append gives a count of 2.
  - `review focus 4: blank lines and CRLF are not counted, arbitrary text is`: content `'a\r\n\r\n\n  \nb\nnot a tally line\n'` → `3`.
  - `a tally that cannot be read throws, never reads as 0`: make `TALLY_FILE` a directory → throws with `code === 'EISDIR'` (or `EPERM` on win32: assert only that it throws, and that the code is not `ENOENT`).
  - `an append into a missing run dir throws ENOENT`.
  - `an injected fsImpl whose appendFileSync throws propagates the error`.

- [ ] **Step 2: Run and see it fail**

Run: `node --test tests/bin-lib/deferral-route/tally.test.js`
Expected: FAIL. At plan time the test file does not exist. After Step 1, `Cannot find module …/tally`.

- [ ] **Step 3: Implement** `tally.js` per the Interfaces block (`fs.readFileSync(p, 'utf8')` in a try/catch on `ENOENT` alone, no existence probe).

- [ ] **Step 4: Run and mutate**

Run: `node --test tests/bin-lib/deferral-route/tally.test.js`
Expected: PASS.
Run: `node --test tests/path-guard-conformance.test.js`
Expected: PASS.
Mutations: swallowing every read error as `0` turns the directory test red. Counting `split('\n').length` turns review focus 4 red. Restore after each.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/deferral-route/tally.js tests/bin-lib/deferral-route/tally.test.js
git commit -m "Add the deferral-route run tally — one appended line per agent-raised file verdict, counted by non-empty lines" -m "Refs #5933" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"
```

### Task 5: The CLI takes `--evidence`, anchors `--run` under the pipelines directory, and keeps the tally

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/deferral-route.js`:
  - the header, lines 1-28
  - `USAGE`/`ACCEPTED`, lines 35-37
  - `parseArgs`, lines 44-95
  - `run`, lines 118-153
- Test: `tests/deferral-route-cli.test.js`:
  - the `project` helper, lines 25-34
  - the accepted-list texts, lines 164 and 176
  - the #5932 `--run` tests, lines 262-313 and 353-357, retargeted to the new fixture
  - new tests
- Modify: `docs/plugin-structure.md` (line 78's module list, line 390's command entry)
- Modify: `.claude/skills/gh-api-module-pattern/run-dir-boundary-guards.md` (shape 3's list of `stage-item/write.js` `resolveTarget` importers gains `deferral-route.js`, with its exit 1 stated)
- Modify: `plugin/skills/_shared/pipeline-run-dir.md` (the CLI list: a sentence after the **Sanctioned-write CLIs** bullet's last line, `rather than re-deriving the predicate, as the third, fourth and fifth did.`, naming `bin/deferral-route.js`)
- Read, no change: `plugin/bin/lib/stage-item/write.js` (`resolveTarget`), `plugin/bin/resolve-policy.js` (`resolvePolicy`, `callerDeps`, `EXIT_OK`), `plugin/bin/lib/health-core/io.js` (`resolveAgainst`)

**Interfaces:**
- Consumes:
  - `checkEvidence` (Task 2).
  - `routeDeferral`, `EVIDENCE_REASONS` (Task 3).
  - `readTallyCount`, `appendTally`, `TALLY_FILE` (Task 4).
  - The two keys (Task 1).
  - `resolveTarget({ runDir, cwd })` → `{ ok, dir } | { ok: false, reason: 'missing'|'not-anchored'|'not-a-run-dir' }`.
- Produces:
  - `parseArgs(argv) -> { help, reason, input, runDir, evidence }`. `evidence` is `null` when absent. It is not echoed.
    - Missing value (undefined or starting `--`) → refusal `--evidence needs a value`.
    - Repeated → `--evidence given more than once`.
    - `''` is a value, and invalid evidence.
  - `ACCEPTED = '--defer-reason, --severity, --size, --priority, --risk, --agent-raised, --human, --evidence, --run, --help'`.
  - `USAGE`: `usage: deferral-route.js --defer-reason <reason> (--agent-raised | --human) [--severity <critical|high|medium|low|info>] [--size <v>] [--priority <v>] [--risk <v>] [--evidence <test:path|ref:id>] [--run <dir>] [--help]\nexit codes: 0 a verdict (file or digest) or --help; 1 the run directory or policy could not be used (the working directory could not be read, --run is missing or not a run directory under the main checkout's .claude-tweaks/pipelines, the resolver refused it, or the run tally could not be read or appended; stderr only, no verdict); 2 refused, which wins over every exit-1 cause.\n`.
- `run` order. Exit 1 always means nothing on stdout.
  1. `--help`, then a parse refusal (exit 2), then the routing pre-check with no frictions (exit 2). This is unchanged, with no `deps.cwd()` read.
  2. `cwd = deps.cwd()`, in a try. A throw → exit 1, as today.
  3. If `runDir`:
     - `target = resolveTarget({ runDir: resolveAgainst(cwd, runDir), cwd })`, in a try (a throw → exit 1).
     - `missing` → `deferral-route: --run dir does not exist or is not a directory: ${runDir}\n`, exit 1.
     - Any other refusal → `deferral-route: --run dir is not a run directory under the main checkout's .claude-tweaks/pipelines (a worktree-local shadow, or a directory outside pipelines/): ${runDir}\n`, exit 1.
  4. `resolvePolicy({ keys: [DIGEST_KEY, EVIDENCE_KEY, CAP_KEY], runDir }, callerDeps({ cwd, env: deps.env }))`. Its failure is exit 1, as today.
  5. Warnings, one line per invalid key, in this order:
     - The digest-list warning, as today.
     - `deferral-route: warning: filed-record-evidence has invalid value "${raw}" — using the default (off)\n`.
     - `deferral-route: warning: run-filed-record-cap has invalid value "${raw}" — using the default (no cap)\n`.
     - `raw` comes from `out.invalidRaw`.
  6. `evidenceRequired = evidence value === 'required'`.
  7. `evidenceValid` is computed only when `evidenceRequired && EVIDENCE_REASONS.includes(deferReason) && evidence !== null`. Otherwise it is `false`.
     - A `test:` value (the exact lowercase prefix `test:`) first runs `callerDeps(…).git(['rev-parse', '--show-toplevel'], { cwd, env: deps.env }).trim()`. A throw gives `null`. The result is the `topLevel` for `checkEvidence`.
     - Every other value — a `ref:` value, and every value that is neither `ref:` nor `test:` (no `:` at all such as `nothing`, another kind such as `note:x`, a case variant such as `TEST:x` or `Ref:#1`, a file-and-line pointer such as `plugin/bin/example.js:10`, or `''`) — goes straight to `checkEvidence(evidence, { topLevel: null })`, with no `git` call. `checkEvidence` returns `valid: true` only for a well-formed `ref:`; for the rest it returns `valid: false` (problem `empty`, `form` or `kind`), so `evidenceValid` is `false` and the item digests, rule `no-evidence`, exactly as if no `--evidence` were given. No such value is refused (exit 2) or reported on stderr: invalid evidence is treated as none (the spec's closed rule). `review focus 3` and AC3.1/AC12.1 pin `note:anything`, `TEST:tests/example.test.js` and the file-and-line pointer through the CLI.
  8. `cap` is the resolved integer only when `runDir` is set and the value is an integer. Then `filedCount = readTallyCount(target.dir)`. A throw → `deferral-route: cannot read run tally ${path.join(runDir, TALLY_FILE)}: ${err.message}\n`, exit 1.
  9. `result = routeDeferral({ …, evidenceRequired, evidenceValid, cap, filedCount })`.
  10. If `result.verdict === 'file' && input.agentRaised === true && cap !== undefined`, run `appendTally(target.dir, { reason: deferReason, rule: result.rule })`. A throw → `deferral-route: cannot append run tally ${path.join(runDir, TALLY_FILE)}: ${err.message}\n`, exit 1.
  11. Print the JSON line and return 0.

- [ ] **Step 1a: Retarget the fixture and write the characterization test first.**
  - `project({ policy, runConfig })` becomes `{ dir: gitRepo(), runDir: <dir>/.claude-tweaks/pipelines/2026-11-19T000000-test }`, writing the same two files. Import `gitRepo` (already imported) and `linkedWorktreeOf`.
  - The relative-`--run` test passes `--run .claude-tweaks/pipelines/2026-11-19T000000-test`.
  - The missing-dir test keeps its stderr prefix.
  - Add `#5933 characterization AC1.1: with both keys unset, a call with --run routes as #5932 and writes no file`. In `project({})`, `genuinely-larger --size high --agent-raised --run {runDir}` gives exit 0, `file`/`not-low`, stderr `''`, and `fs.readdirSync(runDir)` deepEquals `[]`.
  - Run `node --test tests/deferral-route-cli.test.js`. Expected: PASS before the change, because the resolver accepts a pipelines dir in the main checkout. Its discrimination is Step 4's mutation: appending without a cap turns it red.

- [ ] **Step 1b: Write the failing tests.** Helpers:
  - `withTests(dir)` writes `tests/example.test.js` in the repo.
  - `tallyLines(runDir)` reads `deferral-route-tally.log` (`[]` when absent).
  - `REQ = 'filed-record-evidence: required\n'`, `CAP1 = 'run-filed-record-cap: 1\n'`.
  - `NOT_LOW = ['--size', 'high']`.

  Tests:
  - `#5933 AC2.1 CLI: required, genuinely-larger at not-low axes and no --evidence digests by no-evidence`.
  - `#5933 AC2.2 CLI: --evidence test:tests/example.test.js that exists in the fixture tree files`.
  - `#5933 AC3.1 CLI: test:../outside.js, test:missing.test.js and note:anything digest by no-evidence`. The outside file sits beside the repo, via `gitRepo({ parent: scratchDir(…) })`.
  - `#5933 AC3.2 CLI: a/../../outside.js, /etc/passwd, file:///etc/passwd, %2e%2e/outside.js, tests/ and an escaping symlink digest by no-evidence`. The symlink is skipped on `EPERM`/`EACCES`.
  - `#5933 AC4.1 CLI: ref:#1234 and ref:IL-85 file`. `#5933 AC4.2 CLI: ref:soon digests by no-evidence`.
  - `#5933 AC5.1 CLI: required, needs-human-decision with no evidence files`.
  - `#5933 AC6.1/AC6.2 CLI: cap 1 in one run dir — file, run-cap, severity high files, run-cap`. Four calls of `genuinely-larger --size high --agent-raised --run R`, the third adding `--severity high`. The rules are `not-low`, `run-cap`, `severity`, `run-cap`. After each call, `tallyLines(R).length` is `1, 1, 2, 2`. Each line matches `/^\d{4}-\d{2}-\d{2}T[^\t]+\tgenuinely-larger\t(not-low|severity)$/`.
  - `#5933 AC7.1 CLI: two run dirs keep separate tallies`. Two pipelines dirs `R1`, `R2` in one repo: R1 → `file`, R2 → `file`, R1 → `run-cap`. Each tally holds 1 line. Then a multi-spec member dir `R1/spec-1` (holding its own `config.yml`, accepted by `resolveTarget` as a nested run dir) → `file`, and its tally is `R1/spec-1/deferral-route-tally.log` with 1 line while R1's still holds 1 (plan review round 2: the tally is per `--run` directory).
  - `#5933 AC8.1 CLI: an unreadable tally exits 1 naming the path, no verdict` (the tally path is a directory). Then `an unappendable tally exits 1 naming the path, no verdict`: an empty tally `chmod 0o444`, skipped when `process.getuid && process.getuid() === 0`. Both give code 1, stdout `''`, and stderr including `path.join(R, 'deferral-route-tally.log')`.
  - `#5933 AC10.1 CLI: cap reached, needs-human-decision digests by run-cap` (one prior filing call). `#5933 AC10.2 CLI: the same with --human files and adds no tally line`.
  - `#5933 AC11.1 CLI: a --run outside the main checkout's pipelines directory exits 1 naming the path, no verdict`. Each fixture holds a `config.yml`, and each gives code 1, stdout `''`, and stderr including the path as passed:
    - a `scratchDir` outside every checkout; for this one, also assert that `resolvePolicy({ keys: ['deferral-digest-reasons'], runDir }, callerDeps({ cwd: repo, env: GIT_ENV })).code === 0`, which is the gap the guard closes
    - `<repo>/run`
    - `<repo>/.claude-tweaks/pipelines-copy/run`
    - a linked worktree's `.claude-tweaks/pipelines/run`, with cwd in that worktree; the shadow gains no tally file
  - `#5933 AC12.1 CLI: --evidence plugin/bin/example.js:10 digests by no-evidence`.
  - `#5933 review focus 1: --run without a cap writes no tally; a cap without --run is no cap` (`CAP1` policy, two filing calls without `--run`, both `file`).
  - `#5933 review focus 2: invalid policy values warn once each and route with the default`. Policy `filed-record-evidence: yes\nrun-filed-record-cap: two\n` with `--run`: `file`/`not-low`, with stderr exactly the two warning lines, and no tally file.
  - `#5933 review focus 3: --evidence ignored when off or exempt; refused when last or repeated; never echoed`:
    - `note:x` with no policy → `file`.
    - With `REQ`, `genuinely-larger` at not-low axes: `--evidence TEST:tests/example.test.js` and `--evidence nothing` each → exit 0, `digest`/`no-evidence`, stderr `''` (an unrecognised value is invalid evidence, never a refusal).
    - `--evidence` last → refused, `--evidence needs a value`.
    - Twice → refused, `--evidence given more than once`.
    - `Object.keys(json.input)` stays the six keys.
  - `#5933 review focus 5: a test: path resolves against the git top level, not the cwd` (cwd `<repo>/sub`, `test:tests/example.test.js` → `file`).
  - `#5933 a refusal wins over an outside --run`: `--defer-reason not-a-reason --agent-raised --run {outside}` gives code 2.
  - Retarget the accepted-list texts at lines 164 and 176 to the new `ACCEPTED`.

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F -e "--evidence" -- plugin/bin/deferral-route.js`
Expected: FAIL. Exit 1, no match (probed at plan time).
Run: `node --test tests/deferral-route-cli.test.js`
Expected: FAIL after Step 1b. These fail:
- every new test that passes `--evidence`, because today it is an unknown flag
- AC2.1, AC6, AC7, AC8, AC10.1 and review focus 2, because no policy is read for the new keys
- AC11.1, because today the outside dirs print a verdict
- the two accepted-list tests

These pass:
- AC5.1 and AC10.2, which pass no `--evidence`. Their rules already hold, so keep them as the pins for the exempt and human paths.
- review focus 1
- the characterization test and #5932's retargeted tests

- [ ] **Step 3: Implement** per the Interfaces block. Constants `EVIDENCE_KEY = 'filed-record-evidence'` and `CAP_KEY = 'run-filed-record-cap'`.
  - The header comment states:
    - The three keys.
    - The strict `--run` anchoring, through stage-item's `resolveTarget` (shape 3's predicate). It exits 1, this CLI's existing run-dir and policy failure code; there is no exit 3, because no caller branches on a run-dir code distinct from 1.
    - The tally: written only with a cap and `--run`, create-or-append, no lock, best-effort.
    - The new exit-1 causes.
  - It replaces "Writes nothing and makes no gh call" with `Writes only the run tally (a cap and --run) and makes no gh call.`

- [ ] **Step 4: Docs, run, mutate, prove**
  - `docs/plugin-structure.md` line 78 gains `; evidence.js — checkEvidence (#5933): the form and in-tree path check for --evidence; tally.js — the run's deferral-route-tally.log (#5933)`.
  - Line 390's entry:
    - gains `[--evidence <test:path|ref:id>]` in its synopsis
    - after its `policy-reason` clause, gains: `reads filed-record-evidence and run-filed-record-cap (both policyOnly) and applies rules no-evidence and run-cap after the floor; --run must be a run directory under the main checkout's .claude-tweaks/pipelines (exit 1 otherwise) and, with a cap, hosts deferral-route-tally.log`
    - widens its `rule:` list with `|no-evidence|run-cap`
    - replaces `writes nothing` with `writes only the run tally`
    - replaces its exit-1 clause with the USAGE text's
  - `run-dir-boundary-guards.md`: in shape 3's parenthesis listing stage-item's `resolveTarget` importers, add `deferral-route.js` (#5933, which exits 1, its existing run-dir and policy failure code, since it has no 3 and no caller branches on a distinct run-dir code).
  - `_shared/pipeline-run-dir.md`: directly after the Sanctioned-write CLIs bullet's sentence `rather than re-deriving the predicate, as the third, fourth and fifth did.`, append on the same bullet: `` `bin/deferral-route.js` (`--run`, #5933), which writes only its own `deferral-route-tally.log` and only with `run-filed-record-cap` set, imports the same `resolveTarget` but refuses with exit **1** — its run-dir and policy failure code, since it has no exit 3 and no caller branches on a distinct run-dir code. `` Before editing, `git grep -n -F "as the third, fourth and fifth did" -- tests` for a pin on that sentence; a byte pin there gets the same text appended in this commit.
  - Exit-code sweep: `git grep -n -e "deferral-route" -- plugin docs .claude/skills`. Every hit stating the CLI's exit codes or "writes nothing" is updated here or listed in Task 8: the journey and `materiality-floor.md`.

Run, one at a time: `node --test tests/deferral-route-cli.test.js`, `node --test tests/bin-lib/deferral-route/route.test.js`, `node --test tests/materiality-floor-conformance.test.js`, `node --test tests/bin-lib/cli-entry-conformance.test.js`, `node --test tests/bin-lib/exit-code-conformance.test.js`, `node --test tests/path-guard-conformance.test.js`, `node --test tests/windows-hide-spawn-conformance.test.js`
Expected: PASS for each.
Mutations, each restored:
- Append the tally whenever `--run` is given → the characterization test and review focus 1 go red.
- Drop the strict guard → AC11.1's outside-every-checkout and in-repo fixtures go red.
- Read the tally only after routing → AC6.1's second call goes red.
- Append before the verdict is known → AC8.1's unappendable case prints a verdict, which is red.

Proof(public-contract): with `filed-record-evidence` and `run-filed-record-cap` unset, #5930's `AC7.1 exhaustive` block and #5932's exhaustive tests in `route.test.js` pass byte-unmodified (Task 3 Step 4's diff check). Every #5930 and #5932 CLI test passes with only its `--run` fixture moved under `.claude-tweaks/pipelines/`. The JSON line keeps `verdict`, `rule`, `reason` (refused only) and `input`, with `input`'s six keys. `realDeps` keeps `cwd`, `env`, `stderr`, `stdout`. No file is written without a cap (the characterization AC1.1 test). What is added: two `rule` values, two flags and new exit-1 causes. The one narrowing is the set of `--run` values the CLI accepts (AC11), which never shipped (`origin/main` has no `deferral-route.js`).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/deferral-route.js tests/deferral-route-cli.test.js docs/plugin-structure.md .claude/skills/gh-api-module-pattern/run-dir-boundary-guards.md plugin/skills/_shared/pipeline-run-dir.md
git commit -m "Wire evidence and the run cap into deferral-route — --evidence, a --run anchored under the pipelines dir, and a tally line per agent-raised file verdict" -m "Refs #5933" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"
```

### Task 6: The `Evidence:` line in `specShapedBody` and the deferral gate

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/issues/record-payload.js` (doc comment, lines 251-262; destructure and render, lines 368-377)
- Modify: `plugin/skills/_shared/deferral-gate.md` (`## Where the reason lives`: a third bullet after line 88)
- Test: `tests/bin-lib/issues/record.test.js` (new tests after line 1042; existing tests not edited)
- Test: `tests/deferral-gate-conformance.test.js` (a new block at the end)

**Interfaces:**
- Produces `specShapedBody({ …, provenance: { origin, deferReason, evidence } })`.
  - `evidence` absent, `null` or `''` → no line.
  - A non-empty single-line string whose text before the first `:` is exactly `test` or `ref` → an `Evidence: ${evidence}` part directly after the `Defer-reason:` part, or after `Origin:` when there is no reason.
  - Anything else throws `specShapedBody: provenance.evidence must be a single-line test:{path} or ref:{id}` — a multi-line or non-string value, and also a value of any other kind, such as a file-and-line pointer (`src/x.js:10`) or `note:x`, so the `{kind}:{ref}` provenance slot never holds a review finding's file-and-line `Evidence:` (plan review round 2).
  - Only the kind is checked here; the path or id form beyond it is the CLI's to judge, and a body records what the route was given.

- [ ] **Step 1a: Characterization first.** Add `#5933 characterization: a provenance without evidence composes byte-identically`. Pin the full string of `specShapedBody({ header: 'H', ...BASE, acceptanceCriteria: 'a', provenance: { origin: 'o', deferReason: 'genuinely-larger' } })` as a literal, copied from a run of today's code. Run `node --test tests/bin-lib/issues/record.test.js`. Expected: PASS before the change. Its discrimination: emitting `Evidence: undefined` turns it red in Step 4.

- [ ] **Step 1b: Write the failing tests.**
  - In `record.test.js`:
    - `#5933 AC9.1 provenance.evidence renders Evidence: ref:#1234 right after Defer-reason:`. `specShapedBody({ header: 'H', ...BASE, acceptanceCriteria: 'a', provenance: { deferReason: 'genuinely-larger', evidence: 'ref:#1234' } })` includes `'Defer-reason: genuinely-larger\n\nEvidence: ref:#1234\n\n## Current State'`, and holds exactly one `^Evidence: ` line.
    - `#5933 evidence with origin and no reason renders after Origin:`.
    - `#5933 empty, null and undefined evidence render no line`.
    - `#5933 a multi-line or non-string evidence throws`.
    - `#5933 a file-and-line pointer or another kind of evidence throws, never renders`: `src/x.js:10`, `note:x` and `TEST:tests/a.test.js` each throw the message above, and `ref:#1` and `test:tests/a.test.js` each render.
  - In `deferral-gate-conformance.test.js`, add `EVIDENCE_NEEDLES`:
    - `` '- **Evidence** (#5933)' ``
    - `` '`Evidence: {kind}:{ref}`' ``
    - `` 'right after `Defer-reason:`' ``
    - `` '`provenance.evidence`' ``
    - `` '`Evidence: test:{path}`' ``
    - `` '`Evidence: ref:{id}`' ``
    - `` 'A file-and-line pointer (`src/x.js:10`) is neither and is not evidence' ``
    - `` '`bin/deferral-route.js --evidence`' ``

    Add `evidenceProblems(text)`, which finds the one line of `## Where the reason lives` starting `- **Evidence** (#5933)` and lists each needle it lacks. Add `#5933 deferral-gate names the Evidence line for staged proposals and created records`, which asserts `[]`. For each needle, add a move-out control: cut it with `flexible`, append it below the section, and assert exactly `[lacks needle]`.

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F "Evidence: " -- plugin/bin/lib/issues/record-payload.js`
Expected: FAIL. Exit 1, no match (probed at plan time).
Run: `node --test tests/bin-lib/issues/record.test.js`
Expected: FAIL after Step 1b. AC9.1, the origin case and the throw case fail. The characterization test and the empty-evidence case pass: today `evidence` is ignored.
Run: `node --test tests/deferral-gate-conformance.test.js`
Expected: FAIL, because the bullet is missing.

- [ ] **Step 3: Implement and write.**
  - `record-payload.js`: destructure `evidence`. Validate it with the same `isEmpty` and newline rule as `premiseCheck`, plus the kind rule (`/^(?:test|ref):/`). Push the part after the `Defer-reason:` push. Add `evidence?` to the `provenance` shape in the doc comment, and add `Evidence:` to the "Provenance lines" sentence.
  - `deferral-gate.md`: insert after line 88:

````text
- **Evidence** (#5933): an item may carry one `Evidence: {kind}:{ref}` line beside its `Defer-reason:` — inside a staged proposal's header block, and in a created record's provenance block right after `Defer-reason:` (`specShapedBody`'s `provenance.evidence`) — located **by key**, like the reason. A producer writes `Evidence: test:{path}`, naming a test file that covers the defect by its path from the repository's top level, or `Evidence: ref:{id}`, naming an existing record (`#{digits}`) or incident (`IL-{digits}`). A file-and-line pointer (`src/x.js:10`) is neither and is not evidence. A routing site passes the line's value as `bin/deferral-route.js --evidence` (`_shared/materiality-floor.md`'s Applying the floor), and a producer that routed with `--evidence` passes the same value as `provenance.evidence`; `specShapedBody` refuses any other kind, a file-and-line pointer included.
````

- [ ] **Step 4: Run and mutate**

Run, one at a time: `node --test tests/bin-lib/issues/record.test.js`, `node --test tests/deferral-gate-conformance.test.js`, `node --test tests/health-filing-parity.test.js`, `node --test tests/bin-lib/stage-item/cli.test.js`
Expected: PASS for each.
Run: `git diff 2f7da5969a -- tests/bin-lib/issues/record.test.js`
Expected: additions only. `recordPayload`'s existing tests are unmodified (AC9.1's second half).
Mutation: render `Evidence: ${evidence}` unconditionally → the characterization test goes red. Restore.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/record-payload.js plugin/skills/_shared/deferral-gate.md tests/bin-lib/issues/record.test.js tests/deferral-gate-conformance.test.js
git commit -m "Add the Evidence: provenance line — specShapedBody writes it after Defer-reason:, and the deferral gate says how a producer writes it" -m "Refs #5933" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"
```

### Task 7: The materiality floor's command form, the two frictions and the digest-label table

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/materiality-floor.md` (`## Applying the floor`, lines 39-51, replaced whole)
- Test: `tests/materiality-floor-conformance.test.js`:
  - `ROUTE_FORM`, line 212
  - `routeVerdict`, lines 302-312
  - `FLOOR_NEEDLES`, lines 327-337
- Read, no change: `tests/bin-lib/deferral-route/route.test.js`. Its byte pin covers `## The floor` and `## Overrides`, which this task does not touch.

Pin inventory, from `git grep -n -F` over `tests plugin` for each edited sentence:
- `On \`digest\` the label a human sees follows \`rule\`` is pinned only at `tests/materiality-floor-conformance.test.js:336`, and it is replaced here.
- The command form is pinned only by `ROUTE_FORM`.
- `Every routing site passes`, `lowercase (`, and `` `verdict` (`file` `` are kept verbatim.

- [ ] **Step 1: Write the failing tests.**
  - `ROUTE_FORM` becomes `` `${ROUTE_COMMAND} [--severity {severity}] --size {size} --priority {priority} --risk {risk} [--evidence {evidence}] [--run "$PIPELINE_RUN_DIR"] (--agent-raised | --human)` ``.
  - In `routeVerdict`, before the generic bracket unwrap, add `.replace(/\[--(?:evidence|run) [^\]]*\]\s*/g, '')`. A documented `--run` is a site placeholder that no policy-free probe can resolve.
  - In `FLOOR_NEEDLES`, replace the line-336 needle with these, each copied from Step 3's block:
    - `'`--evidence` only when the item carries an `Evidence: test:…` or `Evidence: ref:…` line'`
    - `'a finding's file-and-line `Evidence:` pointer is not one'`
    - `'in a multi-spec run each member's `spec-{N}/` directory keeps its own tally'` (Step 3's block keeps every needle on one line; check that again after any rewrap)
    - `'`--run` only when a run directory resolves'`
    - `'since the command refuses a blank `--run`'`
    - `'**Two frictions after the floor (#5933).**'`
    - `'goes to the digest, rule `no-evidence`'`
    - `'goes to the digest, rule `run-cap`'`
    - `'a `high` or `critical` severity still files, and counts'`
    - `'The cap is first come, first served within a run'`
    - `'never hold items back or rank them to choose which ones file'`
    - the four table rows, each a whole line
    - `'`{where}` is the digest comment URL on `work-backend: github-issues`, or `specs/digest.md` on `local-files`.'`
  - The existing `for (const needle of FLOOR_NEEDLES)` deletion loop gives each needle its control.
  - Add `#5933 go-red: the label table moved out of Applying the floor fails the floor check`: cut the four rows and append them after `## Entry format`, then assert the four `lacks` problems.

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F "Two frictions after the floor" -- plugin/skills/_shared/materiality-floor.md`
Expected: FAIL. Exit 1, no match (probed at plan time).
Run: `node --test tests/materiality-floor-conformance.test.js`
Expected: FAIL after Step 1.
- `#5931 materiality-floor.md names deferral-route.js …` reports every new needle missing.
- Each new deletion control fails on its missing anchor.
- The move-out test fails.
- The seven sites' `routes through the real CLI` tests still pass: their spans carry no `--run` yet.

- [ ] **Step 3: Replace `## Applying the floor`** (from line 39 up to the blank line before `## Entry format`) with exactly:

````text
## Applying the floor

`bin/deferral-route.js` is the floor's code home (its test pins the two sections above
byte-equal). Every site routing an item that carries a gate `Defer-reason:` runs it instead of
applying this prose. The five health sweeps (no gate reason) apply this prose directly; the
tiebreak can't-tell digest, the console-backfill values and ledger narrowing follow their own rules:

`node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason} [--severity {severity}] --size {size} --priority {priority} --risk {risk} [--evidence {evidence}] [--run "$PIPELINE_RUN_DIR"] (--agent-raised | --human)`

`--severity` only when the item has one, lowercase (`critical`, `high`, `medium`, `low`, `info`);
each axis `low`, `medium` or `high` as the site scores it.
`--evidence` only when the item carries an `Evidence: test:…` or `Evidence: ref:…` line
(`_shared/deferral-gate.md`'s "Where the reason lives"), passing that line's value; otherwise omit
the flag — a finding's file-and-line `Evidence:` pointer is not one. `--run` only when a run directory resolves (`_shared/pipeline-run-dir.md`); otherwise
omit it, since the command refuses a blank `--run`. Every routing site passes `--agent-raised`: no
typed input reaches one. It prints `verdict` (`file`, `digest` or `refused`) and `rule`.

**Two frictions after the floor (#5933).** An agent-raised item the rules above would file, on rule
`tangential` or `not-low`, meets two policy checks in this order, both off by default
(`_shared/policy-schema-deferral-routing.md`). With `filed-record-evidence: required`, an item whose
`Defer-reason:` is `pre-existing-outside-diff`, `genuinely-larger` or `tangential` and whose call
passes no valid `--evidence` goes to the digest, rule `no-evidence`. With `run-filed-record-cap: {n}`
and `--run`, an item goes to the digest, rule `run-cap`, once the run has given `{n}` `file` verdicts;
a `high` or `critical` severity still files, and counts. The tally belongs to the run directory the
call names: in a multi-spec run each member's `spec-{N}/` directory keeps its own tally.
The cap is first come, first served within a run: route each item when it comes up, and
never hold items back or rank them to choose which ones file.

On `digest` the label a human sees, and the words of a ledger Resolution, follow `rule` — the
digest-label table every routing site cites:

| `rule` | Label | Ledger Resolution |
|---|---|---|
| `floor` | "Digest — below floor" | `below the materiality floor — digested at {where}` |
| `policy-reason` | "Digest — policy (`deferral-digest-reasons`)" | `digested by policy (deferral-digest-reasons) at {where}` |
| `no-evidence` | "Digest — no evidence (`filed-record-evidence`)" | `digested without evidence (filed-record-evidence) at {where}` |
| `run-cap` | "Digest — run cap (`run-filed-record-cap`)" | `digested over the run cap (run-filed-record-cap) at {where}` |

`{where}` is the digest comment URL on `work-backend: github-issues`, or `specs/digest.md` on `local-files`.

````

- [ ] **Step 4: Run and see it pass**

Run, one at a time: `node --test tests/materiality-floor-conformance.test.js`, `node --test tests/bin-lib/deferral-route/route.test.js`, `node --test tests/skill-size-single-source.test.js`
Expected: PASS for each. `wc -c plugin/skills/_shared/materiality-floor.md` prints under 52500. Record it in the commit body.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/materiality-floor.md tests/materiality-floor-conformance.test.js
git commit -m "State the evidence and run-cap frictions in the materiality floor — the command form gains --evidence and --run, and one digest-label table names every rule" -m "Refs #5933" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"
```

### Task 8: The routing sites pass both flags and cite the digest-label table

**Role:** integration
**Review risk:** high

**Files:**
- Modify, each site's `deferral-route.js` command span. Insert ` [--evidence {evidence}] [--run "$PIPELINE_RUN_DIR"]` directly before ` --agent-raised`:
  - `plugin/skills/review/step3-routing.md:69`
  - `plugin/skills/reflect/full-mode.md:397`
  - `plugin/skills/reflect/SKILL.md:156`
  - `plugin/skills/wrap-up/residue-sweep.md:166`
  - `plugin/skills/wrap-up/leftover-routing.md:29`
  - `plugin/skills/visual-review/browser-review.md:247`
  - `plugin/skills/_shared/ledger-format.md:208`
- Modify, each label or Resolution clause, using `LABEL_CITE = "the label \`_shared/materiality-floor.md\`'s digest-label table gives the printed \`rule\`"` and `RESOLUTION_CITE = "the Ledger Resolution \`_shared/materiality-floor.md\`'s digest-label table gives the printed \`rule\`"`:
  - `step3-routing.md:110`: `` `"Digest — below floor"` (rule `floor`) or "Digest — policy (`deferral-digest-reasons`)" (rule `policy-reason`) instead of `` → `LABEL_CITE instead of`.
  - `step3-routing.md:71`: `` below the materiality floor on rule `floor`, listed in policy key `deferral-digest-reasons` on rule `policy-reason` `` → `RESOLUTION_CITE`.
  - `full-mode.md:397`: `` "Digest — below floor" (rule `floor`) or "Digest — policy (`deferral-digest-reasons`)" (rule `policy-reason`) instead of `` → `LABEL_CITE instead of`.
  - `full-mode.md:398`: `` ("Digest — below floor" or "Digest — policy (`deferral-digest-reasons`)") `` → `(LABEL_CITE)`.
  - `browser-review.md:247`: `` "Digest — below floor" (rule `floor`) or "Digest — policy (`deferral-digest-reasons`)" (rule `policy-reason`) in the Recommended column `` → `LABEL_CITE in the Recommended column`.
  - `residue-sweep.md:167`: `` `"Digest — below floor"` (rule `floor`) or "Digest — policy (`deferral-digest-reasons`)" (rule `policy-reason`) instead of `` → `LABEL_CITE instead of`.
  - `plugin/skills/release/disposition.md:58`: `` `Digest — below floor` (rule `floor`) or "Digest — policy (`deferral-digest-reasons`)" (rule `policy-reason`), appended only `` → `LABEL_CITE, appended only`.
  - `ledger-format.md:210`: `` Resolution `below the materiality floor — digested at {digest comment URL | specs/digest.md}` when the item's route printed rule `floor`, or `digested by policy (deferral-digest-reasons) at {digest comment URL | specs/digest.md}` when it printed `policy-reason`. `` → `RESOLUTION_CITE.`
- Modify: `plugin/skills/_shared/policy-schema-deferral-routing.md`, the `deferral-digest-reasons` row's last sentence. `and no routing site passes \`--run\`, so in a pipeline run the repository value applies.` → `and a routing site passes \`--run\` only inside a pipeline run, so a run's \`config.yml\` could overlay it there; nothing writes the key to one, so in practice the repository value applies.`
- Modify: `docs/skill-graph.md:519` and `:740`. `` "Digest — below floor" (rule `floor`) or "Digest — policy (`deferral-digest-reasons`)" (rule `policy-reason`) `` → `` the digest label for its rule (`_shared/materiality-floor.md`'s digest-label table) ``.
- Modify: `docs/journeys/route-a-declined-reflection-insight.md:28`. `` "Digest — below floor" (or "Digest — policy (`deferral-digest-reasons`)") is `` → `` A digest label from `_shared/materiality-floor.md`'s digest-label table is ``. After `` policy key `deferral-digest-reasons` lists, `` add `` or that lacks the evidence `filed-record-evidence` requires or passes the run's `run-filed-record-cap`, ``.
- Modify: `docs/journeys/route-a-deferred-finding-in-code-5930.md`:
  - `files:` gains `plugin/bin/lib/deferral-route/evidence.js` and `plugin/bin/lib/deferral-route/tally.js`.
  - Step 1's Action gains `` `--evidence {kind}:{ref}` when the item carries an `Evidence:` line, `--run "$PIPELINE_RUN_DIR"` inside a pipeline run ``.
  - Line 34: `digest` also comes from rule `no-evidence` (policy key `filed-record-evidence` requires evidence the call did not give) or rule `run-cap` (the run reached `run-filed-record-cap`).
  - Line 35's order gains `, then \`no-evidence\` and \`run-cap\` on an item that would file`.
  - Line 37 → `The command writes nothing and calls no \`gh\`, except one tally line in the \`--run\` directory per agent-raised \`file\` verdict when \`run-filed-record-cap\` is set; acting on the verdict is still the caller's job.`
  - Line 38's red flags gain: a `no-evidence` digest for an exempt reason or a `--human` call; a `run-cap` digest without `--run`; a tally line for a digest or a `--human` verdict.
  - Line 48 gains: `--run` outside the main checkout's `.claude-tweaks/pipelines/`, and a tally that cannot be read or appended, are exit 1 too.
  - Line 62 → `A digest's label and ledger Resolution come from \`_shared/materiality-floor.md\`'s digest-label table, by the rule that sent it.`
- Test: `tests/materiality-floor-conformance.test.js`:
  - `deferralSiteProblems`' flag list, line 234
  - `SAMPLE_SITE`, line 256
  - `SITE_MUTATIONS`, lines 257-267
  - the split sample, line 278
  - `RULE_LABEL`/`LABEL_SITES`, lines 1109-1120
- Test: `tests/control-mode-console-prose.test.js:73`

Pin inventory, from `git grep -n -F` over `tests plugin docs` for `Digest — policy`, `rule-matched label`, `digested by policy` and `--risk {risk}`:
- The only test pins are the `materiality-floor-conformance.test.js` lines listed above and `control-mode-console-prose.test.js:73`.
- `control-mode-console-prose.test.js:70` (`` prints `digest` (`false` on `file` ``) and `:72` (`whichever \`rule\``) stay true.
- The `docs/` hits carry no pin.

- [ ] **Step 1: Write the failing tests.**
  - `deferralSiteProblems`' flag list gains `'[--evidence {evidence}]'` and `'[--run "$PIPELINE_RUN_DIR"]'`, between `'--risk {risk}'` and `'--agent-raised'`.
  - `SAMPLE_SITE` and the split sample's command become `` `${ROUTE_COMMAND} --size {size} --priority {priority} --risk {risk} [--evidence {evidence}] [--run "$PIPELINE_RUN_DIR"] --agent-raised` ``.
  - `SITE_MUTATIONS` gains `['[--evidence {evidence}]', 'the command paragraph lacks [--evidence {evidence}]']` and `['[--run "$PIPELINE_RUN_DIR"]', 'the command paragraph lacks [--run "$PIPELINE_RUN_DIR"]']`.
  - Replace `RULE_LABEL` with `LABEL_CITE` and add `RESOLUTION_CITE`, both copied from this task's Files block.
  - `LABEL_SITES` needles become:
    - step3-routing Defer: `` `${LABEL_CITE} instead of` ``.
    - step3-routing digest paragraph: `` `stating why it was digested — ${RESOLUTION_CITE} — and that it was` ``.
    - full-mode Defer: `` `${LABEL_CITE} instead of "Defer — {reason}"` ``.
    - full-mode Capture: `` `the same rule-matched label (${LABEL_CITE})` ``.
    - browser-review: `` `${LABEL_CITE} in the Recommended column` ``.
    - residue-sweep: `` `${LABEL_CITE} instead of` ``.
    - disposition: `` `${LABEL_CITE}, appended only` ``.
    - ledger-format `digested`: `` `with ${RESOLUTION_CITE}.` ``.
    - The control-mode entry is unchanged.
  - Add `#5933 no label site restates a digest label` for each `LABEL_SITES` scope: its text contains none of `"Digest — below floor"`, `Digest — policy`, `Digest — no evidence`, `Digest — run cap`. Pair it with a go-red that pastes `"Digest — below floor"` into one scope and expects a problem.
  - `control-mode-console-prose.test.js:73` becomes `[RESOLUTION_CITE_LITERAL, 'the digested state does not take its Resolution from the digest-label table']`, where `RESOLUTION_CITE_LITERAL` is the same string.

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F "digest-label table" -- plugin/skills/review/step3-routing.md`
Expected: FAIL. Exit 1, no match (probed at plan time).
Run: `node --test tests/materiality-floor-conformance.test.js`
Expected: FAIL after Step 1. All seven sites' deferral-site tests fail on the two missing flags. Every `LABEL_SITES` check, deletion control and move-out control fails on its missing anchor. The no-restatement test fails at the eight label scopes.
Run: `node --test tests/control-mode-console-prose.test.js`
Expected: FAIL. Row 73's needle is absent.

- [ ] **Step 3: Edit the prose** exactly as the Files block lists, copying each replacement string from it. In each command span, the inserted text sits between `--risk {risk}` and `--agent-raised`. Deictic check: no edited sentence says "above" or "below" about another edited paragraph. Every site cites `_shared/materiality-floor.md` by name.

- [ ] **Step 4: Run, sweep, measure**

Run, one at a time: `node --test tests/materiality-floor-conformance.test.js`, `node --test tests/control-mode-console-prose.test.js`, `node --test tests/deferral-gate-conformance.test.js`, `node --test tests/reflect-integration-branch-probe.test.js`, `node --test tests/skill-size-single-source.test.js`, `node --test tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS for each. The `routes through the real CLI` test passes for every site, because `routeVerdict` drops the two bracketed flags.
Run: `git grep -n -F -e "Digest — below floor" -e "Digest — policy" -- plugin/skills ':!plugin/skills/_shared/materiality-floor.md'`
Expected: exit 1, no match. Absence-grep control: at base 2f7da5969a the same command with `-c` matched six lines in five files (probed at plan time): `reflect/full-mode.md:2`, `release/disposition.md:1`, `review/step3-routing.md:1`, `visual-review/browser-review.md:1` and `wrap-up/residue-sweep.md:1`. The search is scoped to `plugin/skills`, so no exclusion of plans or ledgers is owed.
Run: `git grep -c -F '[--run "$PIPELINE_RUN_DIR"] --agent-raised' -- plugin/skills`
Expected: exactly the seven site files, each `:1`. `_shared/materiality-floor.md` is absent, because its form ends `(--agent-raised | --human)`.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/step3-routing.md plugin/skills/reflect/full-mode.md plugin/skills/reflect/SKILL.md plugin/skills/wrap-up/residue-sweep.md plugin/skills/wrap-up/leftover-routing.md plugin/skills/visual-review/browser-review.md plugin/skills/_shared/ledger-format.md plugin/skills/release/disposition.md plugin/skills/_shared/policy-schema-deferral-routing.md docs/skill-graph.md docs/journeys/route-a-declined-reflection-insight.md docs/journeys/route-a-deferred-finding-in-code-5930.md tests/materiality-floor-conformance.test.js tests/control-mode-console-prose.test.js
git commit -m "Pass --evidence and --run at every deferral routing site — the run cap reaches each site, and every digest label cites the materiality floor's table" -m "Refs #5933" -m "Claude-Session: https://claude.ai/code/session_016yg3znZfdV181e3d4oRJ3T"
```

## Behavior-change prose sweep (classified)

Grep for the old behavior's phrases (`writes nothing`, `There is no exit 1`, `no routing site passes`, `Digest — below floor`, `Digest — policy`, `rule-matched label`, `digested by policy`) over `plugin/skills plugin/bin docs .claude/skills README.md`:
- `plugin/bin/deferral-route.js` header: changed (Task 5).
- `docs/plugin-structure.md:390`: changed (Task 5).
- `docs/journeys/route-a-deferred-finding-in-code-5930.md:37,48,62`: changed (Task 8).
- `policy-schema-deferral-routing.md`'s "no routing site passes `--run`": changed (Task 8).
- The eight label sites, `docs/skill-graph.md:519,740` and `docs/journeys/route-a-declined-reflection-insight.md:28`: changed (Task 8).
- `_shared/materiality-floor.md`'s Audit line (`rule={rule}`): no change. `rule=` names `no-evidence` or `run-cap` as it does `policy-reason`.
- `plugin/skills/reflect/SKILL.md:156`'s `On \`digest\`` branch: no change beyond the flags. It handles every digest rule alike.
- `plugin/skills/wrap-up/review-console.md` step 10 (`belowFloor` from the insight route): no change. It keys on `digest`, whichever `rule`.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable: key `filed-record-evidence` | Task 1 |
| Deliverable: `required` needs `--evidence` for the three reasons; `no-evidence` | Task 3 (rule), Task 5 (CLI) |
| Deliverable: closed evidence rule (kinds, `ref` ids, `test` path rules, partition test, form-only) | Task 2 (`checkEvidence`), Task 3 (partition test) |
| Deliverable: key `run-filed-record-cap` | Task 1 |
| Deliverable: tally with a cap and `--run`; `run-cap`; no `--run` no cap; anchoring failure exits non-zero | Task 4 (tally), Task 5 (CLI) |
| Deliverable: cap semantics (count read, severity bypass counted, `--human` never tallied, best-effort, repeated calls counted) | Task 3 (rule), Task 4 (header), Task 5 (CLI tests AC6, AC10) |
| Deliverable: precedence | Task 3 (friction oracle), Task 7 (prose) |
| Deliverable: `specShapedBody` `provenance.evidence`; deferral-gate's "Where the reason lives" | Task 6 |
| Deliverable: materiality-floor's command form gains `--evidence` and `--run` | Task 7 (form), Task 8 (each site's instance) |
| Deliverable: how a producer writes the evidence line; pass `--evidence` when the item carries one, omit it otherwise | Task 6 (deferral-gate), Task 7 (materiality-floor) |
| Deliverable: this repository's `policy.yml` | Task 1 Steps 6-7 |
| Deliverable: tests for both frictions, the precedence and the tally | Tasks 2-5 |
| Gotcha: first come, first served said in materiality-floor | Task 7 |
| Gotcha: `policy-schema.md` key-only rows, full rows in the sub-file | Task 1 |
| Gotcha: installed resolver probe | Task 1 Step 6 |
| Gotcha: `--run` anchoring guard from the CLI wrapper contract | Task 5 (stage-item's `resolveTarget`) |
| Record Decision 1 (both keys `policyOnly`; `--run` does not overlay them) | Task 1 (policyOnly test) |
| Record Decision 2 (one digest-label table every site cites) and the `--run` at each site | Task 7 (table), Task 8 (sites) |
| AC1.1 | Task 3 (exhaustive blocks unmodified, Step 4 diff), Task 5 (characterization AC1.1) |
| AC2.1, AC2.2 | Task 3 (function), Task 5 (CLI), Task 2 (AC2.2 path) |
| AC3.1, AC3.2 | Task 2 (problems), Task 5 (CLI) |
| AC4.1, AC4.2 | Task 2, Task 5 |
| AC5.1 | Task 3, Task 5 |
| AC6.1, AC6.2 | Task 3, Task 5 |
| AC7.1 | Task 5 |
| AC8.1 | Task 4 (throws), Task 5 (CLI exit 1, both read and append) |
| AC9.1 | Task 6 |
| AC10.1, AC10.2 | Task 3, Task 5 |
| AC11.1 | Task 5 |
| AC12.1 | Task 2, Task 5 |
