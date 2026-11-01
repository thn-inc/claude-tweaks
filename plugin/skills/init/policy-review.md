# Policy Configuration Review

Read by `update-mode.md`'s "Policy Configuration Review" entry in Phase 1u.5. A general "does
your `policy.yml` look right?" pass, distinct from Config Home Drift and Renamed key drift —
those catch a key in the wrong file or under a retired name, this reviews the full
recognized-lever surface: every key currently set, whether its value validates, and (skippable)
what each one does.

## Procedure

Read `auditPolicy(repoRoot)` from `bin/lib/policy-schema.js` — the same module Config Home Drift
and Renamed key drift already call:

```bash
node -e "const {auditPolicy}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/policy-schema.js'); const r=auditPolicy(process.cwd()); console.log(JSON.stringify({invalidValues:r.invalidValues,unrecognizedKeys:r.unrecognizedKeys}))"
```

- **`invalidValues`** — a recognized key set to a value its schema entry rejects (wrong type, an
  enum value outside its list, an out-of-range integer). The lever silently runs on its schema
  default until fixed (`resolveValue`'s coercion contract — see `_shared/policy-schema-coverage.md`).
- **`unrecognizedKeys`** — a `policy.yml` line whose key names no lever in `POLICY_KEYS` and no
  retired key in `RENAMED_KEYS` — most often a typo, or a stray leftover from a lever removed
  outright rather than renamed.

**Always surface a one-line count**, even when both lists are empty (`"Policy config: {N}
lever(s) set, 0 issues found"`) — this is the piece that must never be silently skipped. Both
empty means nothing further to do for this check. Otherwise each non-empty list counts toward
Phase 1u.6's Total drift count, the same self-classifying convention every check in
`update-mode.md`'s Phase 1u.5 already uses.

Then offer the detailed pass in one `AskUserQuestion` call — the low-friction skip this check
requires (one click, never "type no"):

- `question`: `"Show the full policy.yml review — {N} issue(s) found, {M} lever(s) set?"`,
  `header`: `"Policy review"`, `multiSelect`: `false`
- Option 1 — `label`: `"Skip (Recommended if you already know your config)"`, `description`:
  `"Keep the one-line count above; move on to the rest of Update Mode"`
- Option 2 — `label`: `"Show details"`, `description`:
  `"Render the policy configuration per skills/help/policy.md's Render contract (read-only), plus
  the {N} issue(s) found"`

On **Show details**: read `${CLAUDE_PLUGIN_ROOT}/skills/help/policy.md` (an explicit cross-skill
path read — never a `Skill`-tool invocation of `/claude-tweaks:help`, which would run the whole
mode, gather included) and produce its Render contract's four sections in order — Set levers,
Issues, Notable defaults, Advanced tier — from that file's own Gather commands. Section 2's
citation is scoped here to `invalidValues` and `unrecognizedKeys` only: `migratableKeys`,
`renamedKeys`, and `sourceExcludedKeys` are Config Home Drift's and Renamed key drift's business
earlier in this same Phase 1u.5 pass, so rendering them again here would repeat prompts the user
just answered and diverge from those checks' own `{N}` counts. This entrance is **read-only**: render the sections,
then close with one line — "To change any of these, run `/claude-tweaks:help policy` — its Next
Actions apply edits with validation." — and never run the contract's apply path from here. When
zero recognized keys are set (a from-scratch `policy.yml`), no extra step is needed here — the
contract's own section 1 zero-set-keys render already covers onboarding by rendering the
core-tier levers at their defaults, grouped by category with each lever's summary.

This check never writes to `policy.yml` — a malformed or unrecognized line needs a human's actual
intended value, not a guessed one. Record the outcome in Phase 9's Actions Performed table as an
`Operational` row: `"Policy Configuration Review: {N} issue(s) found, walkthrough {shown |
skipped}."`
