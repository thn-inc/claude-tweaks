# Release Recommendation Gate

Shared by `flow/summary-template.md`, `flow/multispec-summary.md`, and `wrap-up/SKILL.md`'s Next
Actions (#2257) — the "cut a release" row renders only from a verified premise, never a guess.
Record #680: a paste-ready release command was once recommended for work a prior release had
already carried; `/claude-tweaks:release`'s own Anti-Patterns table states the same rule for its
own console.

**Run once per render site, read `unreleased`:**

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/release-preflight.js" --run "{run-dir}"
```

Then read `{run-dir}/release-preflight.json`'s `unreleased` field (unit 5's fact pack — see
`release/SKILL.md` Step 1's field table for the full envelope):

| `unreleased` | Row |
|---|---|
| `{ok: true, value: {commits: [...]}}` with `commits` non-empty | Render **`/claude-tweaks:release`** — cut the release |
| `{ok: true, value: {commits: []}}` | Omit — nothing unreleased |
| `{ok: false, error: ...}` | Omit — the field is degraded; never recommend from an unverified premise |
| The CLI call failed, or `release-preflight.json` could not be read at all | Omit — no preflight pack was produced for this run. Expected on any run whose pipeline predates unit 5's adoption everywhere, not a bug to fix around; becomes rare once adoption is universal |

**Recommended slot.** The release row takes `(recommended)` only when the caller's own
higher-priority rows (a next spec, a resume-to-merge row) are absent — each render site's own
precedence rule states this locally, since the competing rows differ per site.
