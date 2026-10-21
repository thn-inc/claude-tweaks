# Step 20 — Integration Model (detailed procedure)

*Optional Enhancement step — see `../SKILL.md`'s `## Input` for when this group is offered or filtered, and `../bootstrap-steps.md` for its ordering and renumbering conventions.*

`integration-model` (`_shared/integration-model.md`) resolves to `pr-first` or `local-merge` — which backend a project integrates through. Left unset, `bin/resolve-policy.js` computes it via forge detection (`_shared/forge-detection.md`'s ladder run in code) every time it's read. That detection is **gh-only**: a Node subprocess cannot see an agent session's MCP tools, so an MCP-only sandbox for a GitHub-backed repo detects `local-merge` even though the repo genuinely has a forge — a different answer than a local session with `gh` authenticated would get for the exact same repo. Setting the value explicitly removes that divergence.

**Gate:** same GHE-safe two-tier remote check Step 9 uses — no remote at all, skip this step entirely (there is nothing to recommend; forge detection will correctly resolve `local-merge` on its own).

**Probe (informational, read-only — runs whenever the gate passes, regardless of which option is chosen below):** `pr-first`'s arm step (`_shared/pr-first-merge.md`'s Step 3) needs the repository's `Allow auto-merge` setting on to arm `--auto` directly; when it's off, that same Step 3 already degrades gracefully (poll-then-merge or ready+comment) rather than failing loudly. Check and report it before the question below, so the choice to pin `pr-first` is made with the setting's actual state in view, not silently:

```bash
gh api repos/{owner}/{repo} -q .allow_auto_merge
```

`true` → no comment needed. `false` → report: `"Allow auto-merge" is off for this repo — arming a PR falls back to _shared/pr-first-merge.md's documented degrade path (poll-then-merge or ready+comment) rather than a live --auto arm. Pinning pr-first still works either way; this only affects which merge path each run takes.` A failed probe (no `gh`, no access, API error) is skipped silently — this is an informational aside, not a gate.

**If a remote is reachable, call `AskUserQuestion`:**

- `question`: `"Pin integration-model to pr-first in policy.yml? Without it, the value is re-detected per environment — a local gh session and an MCP-only sandbox can resolve differently for the same repo."`, `header`: `"Integration model"`, `multiSelect`: `false`
- Option 1 — `label`: `"Pin to pr-first (Recommended)"`, `description`: `"Write integration-model: pr-first to .claude-tweaks/policy.yml — resolves identically in every environment."`
- Option 2 — `label`: `"Leave unset"`, `description`: `"Keep the computed default — detection runs fresh each time, per environment."`

**For option 1 — write the line:**

Append `integration-model: pr-first` to `.claude-tweaks/policy.yml` (creating the file if this is a fresh bootstrap with no other policy keys yet — same file every other policy-writing step in this skill targets).

**For option 2 — no write.** Report that the key stays unset and detection applies.

**Idempotent:** when `integration-model:` already has a value in `.claude-tweaks/policy.yml` (either value — this step never overwrites a project's existing explicit choice, including one already set to `local-merge`), report "already configured" and skip the offer.

**Failure handling:** none applicable — this step only writes a policy line, no external command runs.
