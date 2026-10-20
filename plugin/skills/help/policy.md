# Help — Policy Mode

The standing answer to "how is this project configured, and what should I change?" — run by `/claude-tweaks:help` on the `policy` argument. Lazy-loaded from `SKILL.md`.

## Gather

Run once, at the start of the mode, and hold the results for the rest of this run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --all
```

Returns the full config JSON — one entry per key: `{value, source, summary, category, tier, type, default}`.

```bash
node -e "const {auditPolicy}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/policy-schema.js'); console.log(JSON.stringify(auditPolicy(process.argv[1])))" "$(git rev-parse --show-toplevel)"
```

Returns `{unrecognizedKeys, invalidValues, migratableKeys, renamedKeys, sourceExcludedKeys}`.

**The `--all` snapshot is held for the whole mode run.** Every render below reads from this one snapshot, never a re-run. The apply path's revert (`## Next Actions` below) reads a key's prior value from THIS snapshot too — never by re-reading `.claude-tweaks/policy.yml` after a write, since a write may have already landed other keys' lines by the time a revert is needed.

Section 3 below argues from three probes, run once here alongside the two calls above. Each carries its own skip-on-absence rule — a failing probe or absent `gh` means that probe's judgment is skipped for this run, not retried, not substituted:

- `git remote -v` — forge presence, argues against an unset `integration-model`.
- `gh issue list --label auto:build --state open --limit 1 --json number` — standing grants, argues against the `autonomy` ceiling. Skip if `gh` is absent or the call fails.
- `ls .claude-tweaks/pipelines/` — recent pipeline activity, argues against `project-maturity`. Empty or missing directory is a valid "no activity" result, not a failure.

This three-probe list is the v1 signal set. Extending it is a prose edit to this file's Section 3 below — no schema change, no new-issue ceremony.

## Render contract

The four numbered sections below — their headings, order, and data sources — are the stable surface `skills/init/policy-review.md` consumes (#536); changing any of them requires updating that citation in the same change.

### 1. Set levers

Only keys with `source ≠ default`, grouped by `category` (render only categories that have at least one such key).

Row form, one per key, all values verbatim from the `--all` snapshot — the trailing `{summary}` carries the key's meaning so the row is legible without a lookup:

```
`{key}` — {value} ({source}) · default: {default} — {summary}
```

**Null-default keys:** when a key's envelope carries `default: null`, render its default cell as `default: no default` — consumers read a `null` default as "this key has no default", not literal `null`. The derived-default keys keep their own special case below instead of this rule.

**Derived-default keys special case:** when a key from `_shared/policy-schema.md`'s Derived-default keys list (Shape A or Shape B — that file's canonical membership, never re-enumerated here) appears in this section (i.e. `source: policy`, someone set it explicitly), its default cell renders as computed rather than the schema's literal `default` — neither shape's real default is a static value: Shape A carries no static default at all, and Shape B's static default is only the in-loop derivation's base, masked by the explicit set the same way.

| Key (shape) | Default cell renders | Real default | Derivation prose |
|---|---|---|---|
| `integration-model` (A) | `computed (forge detection)` | `detectIntegrationModel()`'s forge-detection result | `_shared/integration-model.md`'s resolution ladder |
| `merge-verification` (A) | `computed (derivation ladder)` | `deriveMergeVerification()`'s result | `_shared/policy-schema-coverage.md`'s `merge-verification` coverage block |
| `housekeeping-auto-merge` (B) | `computed (derived from autonomy)` | `deriveHousekeepingAutoMerge()`'s result | `_shared/policy-schema.md`'s Shape B paragraph |

A key added to either shape's list there is covered by this rule automatically — state only its own `computed (…)` wording when it's added, never a new hardcoded name check here.

**Zero set keys:** when no levers diverge from defaults, render the single line `No levers diverge from defaults.`, then — since the levers that govern what the pipeline may do without a human are exactly what a fresh project's owner needs to see — render the core-tier levers still on `source: default`, grouped by `category`, each row `` `{key}` — {default} — {summary} `` (advanced-tier defaults stay section 4's business).

### 2. Issues

From the held `auditPolicy()` result:

- **`invalidValues`** — each entry, with the schema default the value silently degrades to (the entry's own `expected.default`).
- **`unrecognizedKeys`** — each key name.
- **`migratableKeys`** — each entry, with its remedy from `alsoInPolicy`: `false` → "move it to policy.yml", `true` → "delete the dead CLAUDE.md copy".
- **`renamedKeys`** — each entry, with its `replacedBy` and `suggestedValue`.
- **`sourceExcludedKeys`** (#839) — each entry, noting it never takes effect from `policy.yml` (a resolver special case discards it, falling back to the schema default) and naming the actual way to set it when one exists — for `merge-authorization`, a live per-run answer — `/claude-tweaks:flow`'s `pre-authorize-merge` token or a `confirm`/`hybrid` Manifesto override — never a standing project default.

When ALL five lists are empty, render exactly one line: `Policy config issues: none` — never silently skipped. Otherwise render each non-empty list (omit only the empty ones).

### 3. Notable defaults

Core-tier keys still on `source: default` where an available signal argues otherwise — one of Gather's three probes, or the snapshot-intrinsic source below. Advanced-tier keys are never "notable" — this section is core-tier only. A key whose envelope carries `invalid: true` is excluded from candidacy here regardless of tier — it's section 2's business (the file holds a bad line for that key), not a notable default.

One line per finding: lever + proposed value + why. For example: an unset `integration-model` plus a GitHub remote → propose `pr-first`; `autonomy: supervised` plus standing `auto:*` grants → propose reviewing the ceiling; `project-maturity: greenfield` plus a populated pipelines directory → propose a later stage.

**A fourth finding source — snapshot-intrinsic, so always available** (no probe, no `gh`, no network): any core-tier key that carries a non-null static `default` (Shape B only — Shape A's derived-default keys hold no static default at all, so their snapshot `default` is always `null`, already covered by the Null-default keys rule above and by probe 1) and is on `source: default`, whose snapshot `value` differs from that static `default`, is itself a finding — the Shape B derived-default signal (`_shared/policy-schema.md`). Propose the snapshot `value` (the already-derived answer, never re-derived here); the why clause names the basis the derivation reads, e.g. `housekeeping-auto-merge` unset with `value: true`/`default: false` → propose `true`, why: "derived from `autonomy: {resolved autonomy value}`". This never promotes the key into section 1 — `source` still decides section membership, unchanged by this finding.

Each finding line carries two distinct text sources, in this order: the "why" clause (what the probe observed, or — for the snapshot-intrinsic source above — the derivation's own basis) comes from that signal itself; the lever's meaning text (what the key does) comes from the key's own `summary` field in the snapshot — never re-derived or paraphrased.

Two zero-finding cases, each rendering its own line — never silently skipped:

- At least one probe ran, and no source argued against a default → render `No notable defaults.`
- Every probe was skipped (per Gather's skip-on-absence rules) and the snapshot-intrinsic source found no divergence → render `No notable defaults — no project signals available.`

### 4. Advanced tier

One collapsed line, `{N}` computed from the snapshot at render time:

```
{N} advanced levers on defaults — say "show advanced" to expand.
```

On the user saying "show advanced": render the advanced-tier keys still on `source: default`, grouped by `category`, in-conversation, no new `AskUserQuestion`:

```
`{key}` — {value} ({source}) — {summary}
```

## Next Actions (apply path)

This section replaces SKILL.md's own `## Next Actions` block for the `policy` mode — the two never both fire in the same run.

**Main-checkout pre-check (run BEFORE offering apply options at all):** check the held snapshot's `worktree-always` value, the session's checkout, and the running plugin build's version:

```bash
node -e "const { repoInfo } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/hooks/worktree-detect.js'); console.log(repoInfo(process.cwd()).isLinkedWorktree ? 'WORKTREE' : 'PRIMARY')"
node -e "console.log(require('${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json').version)"
```

When `worktree-always` is `true` AND the first command prints `PRIMARY` (a main checkout, not a linked worktree), the write gate's general Edit/Write/commit posture is denied for everything EXCEPT `.claude-tweaks/policy.yml` itself — `_shared/policy-schema-coverage.md`'s coverage block is the canonical statement of that exemption's terms (path identity, and the allowlisted policy-only commit); do not restate the grammar here. On a plugin build whose version compares greater than `6.86.0` (the last release without the exemption — compare with `bin/lib/changelog.js`'s `compareVersions`, per `skills/init/bootstrap/version-check.md`'s pattern), that exemption is live: proceed to the `AskUserQuestion` below as normal, then apply each approved edit as an isolated Edit/Write to `.claude-tweaks/policy.yml` followed by `git add .claude-tweaks/policy.yml` and then, as a **separate** Bash call, a bare `git commit -m "..."` — never chained with `&&` (the allowlist rejects every shell operator, so a chained form is denied whole), and staging nothing else in that commit, or the staged-set proof fails and the commit is denied.

On an OLDER build (version `6.86.0` or below, predating the exemption), the write path is gate-denied unconditionally in a main checkout — this is a pre-check, not a try/catch around a failed write. In that case, skip the `AskUserQuestion` below entirely — deliberately: nothing in this branch is agent-decidable, since the agent cannot legally write the file itself. Instead render each of section 3's recommendations as a paste-ready command block for THE USER to run themselves, outside this session — the agent never executes these commands (the write gate denies agent file-writes in a main checkout under `worktree-always` on that build, and a bare-shell workaround is not a supported bypass):

```
Run this yourself, from the repo root, to apply the recommended change:

printf '%s\n' "{key}: {value}" >> "$(git rev-parse --show-toplevel)/.claude-tweaks/policy.yml"
```

**If section 3 yielded zero recommendations** (either zero-finding case above): render all four render-contract sections as usual, then end with the single line `Nothing to change — configuration looks healthy; say "show advanced" to inspect defaults.` and skip the `AskUserQuestion` entirely. With a "No changes" option and no real recommendations, fewer than 2 real options exist for the call — a lone real choice needs no question: state the outcome directly rather than asking the user to pick between one meaningful option and a no-op.

**Otherwise**, the mode's ONE `AskUserQuestion` call (`multiSelect: true`). This call is a **blocking apply/write gate** — it decides which lines get written to `.claude-tweaks/policy.yml` before the skill can finish — so it falls under docs/skill-authoring.md's "decisions that block the skill from finishing" clause; it is not a terminal menu, and the plain-markdown close-out rule does not apply to it:

- Options: the top recommended edits from section 3, **capped at 3**, ranked in section 3's own listing order (core-tier severity first), plus a "No changes" option.
- Each option's `description` carries the exact `key: value` line that would be written. For an enum key, also list every legal value — read live from `POLICY_KEYS` in `bin/lib/policy-schema.js` (the pinned source of truth; never a hardcoded list in this file or the rendered option).
- Recommendations beyond the cap of 3 are never dropped — they stay visible in section 3's rendered list, tagged with an "ask to apply" note.
- "Show advanced" is section 4's own in-conversation affordance, not an option here — it never appears in this question.
- If "No changes" is checked, it wins outright — any other checked options in the same `multiSelect` batch are ignored, and nothing is written.

**Apply semantics**, once options are approved:

1. Per key, in the user's selection order: validate the approved value before writing its line to `.claude-tweaks/policy.yml`.

   ```bash
   node -e "const {resolveValue}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/policy-schema.js'); console.log(JSON.stringify(resolveValue(process.argv[1], process.argv[2])))" "{key}" "{raw-value}"
   ```

   `resolveValue` coerces silently to the schema default on an invalid value — parse the output and compare `String(parsedValue)` against the raw `{raw-value}` string: a mismatch means the value was rejected. (`resolveValue` returns numbers and booleans already coerced to their real type, not strings — comparing the parsed value directly against the raw string, without the `String()` wrap, inverts the check for every integer or boolean key.) A rejected key is reported (key + rejected value) and its line is never written; continue validating and writing the rest of the batch.

2. After the whole batch has been written: re-run the exact `auditPolicy()` call from Gather, ONCE. Any issue that is NEW relative to the Gather-time snapshot names the offending key and reverts it: a key whose pre-apply `source` (read from the Gather snapshot) was `default` — no line existed before this apply — reverts by DELETING the line this apply added; a key that already had a `.claude-tweaks/policy.yml` line before this apply reverts by restoring that line to its Gather-snapshot value (never by re-reading the file). The derived-default keys' (`integration-model`, `merge-verification`) computed defaults are never written back as a "revert" value — deleting the line is the only valid revert for either key. Report the revert either way. No edit is described as confirmed to the user until this re-audit comes back clean.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|---------------|
| Restating a default value in prose instead of rendering the `--all` snapshot | The snapshot is the ground truth; a hand-typed default drifts from the schema silently. |
| Re-reading `policy.yml` to discover a key's prior value after writing | The apply path may have already written other keys' lines; only the Gather-time snapshot holds the true "before" state for revert. |
| Offering apply options without running the main-checkout pre-check first | On a build at or below `6.86.0`, a main-checkout write under `worktree-always: true` is gate-denied outright — presenting options that will fail wastes the user's selection. On a newer build the exemption covers only the isolated policy.yml write/commit shape; skipping the check risks an apply attempt the allowlist's staged-set proof still rejects. |
| Hardcoding an enum's legal value list in an option description | `POLICY_KEYS` is the pinned source; a hardcoded copy goes stale the moment a value is added or removed there. |
| Adding a second `AskUserQuestion` call anywhere in this mode | The mode has exactly one — the capped Next Actions call; "show advanced" and the older-build paste-ready fallback are both in-conversation renders, not questions. |
