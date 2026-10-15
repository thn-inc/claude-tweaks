---
files:
  - plugin/bin/dream-scan.js
  - plugin/bin/lib/dream/scan.js
  - plugin/skills/harness-health/dream-pass.md
---

# Review a Dream-Pass Proposal Without Leaking Paths or Credentials

**Persona:** The claude-tweaks maintainer who runs the dream pass by hand and decides whether a recurring cross-session failure deserves a CLAUDE.md Don'ts entry, a skill Gotchas note, or an auto-memory file.
**Goal:** Read a staged dream-pass proposal and copy its quoted evidence into a committed doc without carrying along an absolute path (which embeds the account's home-directory username) or a credential that appeared in the failing command.
**Entry point:** `plugin/skills/harness-health/dream-pass.md`'s "Running it" commands — `node bin/hooks.js resolve-run-dir --spec-slug dream-standalone --create`, then `node bin/dream-scan.js --run-dir "{printed-run-dir}"`.
**Success state:** Every staged `staged/dream-proposal-{n}.md`, the run's `report.md`, and its `decisions.md` `## /dream-scan` lines show absolute paths only as `<path>` and recognized credential shapes only as `<secret>`, in every field — the Pattern line, each quoted Command, each quoted Error, and the command verb.

## Steps

### 1. Run the dream pass over the recent window
- **URL:** N/A (CLI: `node bin/dream-scan.js --run-dir "{run-dir}" [--window-days 14] [--min-sessions 2] [--max-proposals 10] [--config-dir <dir>]`)
- **Action:** The CLI scans `{config-dir}/projects/*/*.jsonl`, groups tool-call failures by signature, and stages one proposal per pattern that recurred across at least two distinct sessions. Each finding's quoted command, error excerpt, signature error line, and Bash command verb pass through `redact()` (`plugin/bin/lib/dream/scan.js`) before anything is grouped or written.
- **Should feel:** Uneventful — one stdout line (`dream-scan.js: scanned N file(s), … proposal(s) staged`), with the work landing in the run directory.
- **Should understand:** Redaction happens at extraction time, not at render time, so grouping runs on redacted text. Two sessions that failed the same way in different worktrees (different absolute paths) still group under one signature.
- **Red flags:** A `decisions.md` `## /dream-scan` STAGED line or a `report.md` bullet that names a raw `/Users/...` path as the command verb. That was the pre-#2968 behavior for any Bash command whose first token was an absolute path.

### 2. Open a staged proposal and read its evidence
- **URL:** N/A (file: `{run-dir}/staged/dream-proposal-{n}.md`)
- **Action:** Read the `**Pattern:**` line and the `## Quoted evidence` list. Each session entry shows `- Command: \`…\`` and `- Error: \`…\``.
- **Should feel:** Safe to share: the evidence reads like the original failure with the identifying parts masked (`curl -H "Authorization: Bearer <secret>" -o <path> https:<path>`). It is still recognizable enough to judge whether the two sessions really hit the same mistake.
- **Should understand:** `<path>` replaces any token with two or more slashes, including URLs. `<secret>` replaces `Authorization`/`Bearer`/`Basic` values, `NAME=value` and `--name value` where NAME contains a credential word, and GitHub/`sk-`/Slack/AWS-key-id token prefixes. Excerpts are truncated afterward (command to 200 chars, error to 300).
- **Check:** `grep -c "$HOME" {run-dir}/staged/dream-proposal-*.md` prints `0` for every proposal.
- **Red flags:** A proposal whose Command line still shows a raw absolute path or a recognizable token prefix (`ghp_`, `sk-`, `xoxb-`, `AKIA`).

### 3. Copy the evidence into a committed doc, or reject the proposal
- **URL:** N/A (the maintainer's own edit to CLAUDE.md, a skill's Gotchas section, or an auto-memory file)
- **Action:** If the pattern is a real, generalizable mistake, write the rule yourself, quoting the redacted evidence. If it is noise, delete the staged file or leave it for the next cleanup pass.
- **Should feel:** Deliberate. The proposal explicitly says nothing has been applied, and the dream pass never edits a doc itself.
- **Should understand:** Secret redaction is pattern-based and best-effort (`dream-pass.md`'s Scope bullet). It deliberately over-redacts (`--max_tokens=100` becomes `--max_tokens=<secret>`), and a credential of an unrecognized shape can still appear. Re-read the quoted text before it leaves the gitignored run directory.
- **Red flags:** Pasting a Command line into a committed file without re-reading it. The redaction narrows the risk; it does not remove it.

## Origin
- Created during build of #2968 (route every transcript-derived dream-scan field through one `redact()`: paths plus best-effort credentials)
- Related: #2691 (the dream pass itself, which shipped without a journey)
