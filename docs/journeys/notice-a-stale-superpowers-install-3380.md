---
files:
  - plugin/bin/lib/superpowers-version.js
  - plugin/bin/lib/installed-plugins.js
  - plugin/bin/lib/hooks/session-start.js
---

# Notice That a Project's Superpowers Install Is Behind

**Persona:** a developer who installed superpowers at project scope months ago in one of their projects. They now open Claude Code there, and their user-scope superpowers and claude-tweaks have both moved on. They have no idea this project still runs the older superpowers, whose writing-plans predates the rules claude-tweaks' cost-shape changes assume.
**Goal:** learn, once and without being interrupted, that this project's superpowers is older than the version claude-tweaks is verified against, and get the exact command that updates it.
**Entry point:** start a new Claude Code session (`claude`) in the project, or anywhere in the same git checkout (a subdirectory or a worktree).
**Success state:**
- The model's first reply relays the notice once: `claude-tweaks: superpowers {old} is older than {floor}, the version claude-tweaks is verified against — update with: claude plugin update superpowers@{marketplace} --scope {project|user} …`.
- The developer runs that command themselves.
- The next new session says nothing.

## Steps

### 1. Open a session in the stale project
- **URL:** `claude`, run from the project directory (or `docs/`, or a worktree under the project)
- **Action:** Start a fresh session the usual way.
- **Should feel:** Nothing new happens, no prompt and no pause. The session starts exactly as fast as before, and the only change is one line in the model's context.
- **Should understand:** The check is a single read of `installed_plugins.json` (under `$CLAUDE_CONFIG_DIR`, defaulting to `~/.claude`) plus the matched install's own `plugin.json`. The version comes from the installed files, not the install metadata.
- **Red flags:** A slower session start, any stop or question, or a notice in a project whose superpowers is current.

### 2. Read the relayed notice
- **URL:** the model's first reply
- **Action:** Read the line the model passes on.
- **Should feel:** Informed, not nagged. One sentence names both versions and the command to run, and, when the install belongs to another path of the same checkout, where it is recorded.
- **Should understand:**
  - Claude Code runs the first install record in `installed_plugins.json` order that applies to this directory: a user-scope or managed record applies everywhere; a project or local record applies to its own directory, or to any directory of the same git checkout (worktrees included). Scope is not ranked — the record listed first wins.
  - A project install recorded for the home directory is not special: it loses only when a user-scope record is listed before it.
  - The `--scope` and the `superpowers@{marketplace}` name in the command come from the matched install, never hardcoded.
  - The "run from …" hint appears only when the matched install is recorded for a different, still-existing directory; when that directory is gone, the notice says so instead. A project-scope update acts on the project you run it from.
- **Red flags:**
  - The model runs `claude plugin update` itself. The line tells it never to, and updating on the developer's behalf is out of scope.
  - The line is repeated on every reply.
  - A notice when no superpowers is installed at all. Missing installs are `/claude-tweaks:init`'s concern.

### 3. Update, then confirm the notice is gone
- **URL:** `claude plugin update superpowers@{marketplace} --scope {scope}`, run from the directory the notice named, if it named one
- **Action:** Run the suggested command. If it reports "already at the latest", run `claude plugin marketplace update {marketplace}` first and retry, then start a new session.
- **Should feel:** Closed. The new session's context carries no superpowers notice.
- **Should understand:**
  - The notice fires only on a fresh start (`source: startup`, or no source at all). Resuming, clearing or compacting the session never repeats it.
  - Anything unreadable or unexpected yields no notice rather than an error: a missing or malformed plugins file, an unreadable install, a pre-release version string.
- **Red flags:** The notice persists after a successful update. That would mean the version was read from install metadata rather than the installed `plugin.json`.

## Origin

Built by #3380 (multi-spec run `2026-10-17T144508-spec-3375-3380`). It is part of the "Build dispatch cost shape" decomposition from #3229, and its floor is the superpowers 7.0.0 re-pin from #3376. #3541 (multi-spec run `2026-10-19T170937-spec-3541-3543-3585`) replaced the install-selection rule with Claude Code's own first-applicable-in-file-order rule and stopped the notice pointing at a deleted directory.
