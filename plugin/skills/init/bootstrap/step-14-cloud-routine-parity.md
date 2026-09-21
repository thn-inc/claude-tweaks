# Step 14 — Cloud/Routine Parity Setup (detailed procedure)

*Optional Enhancement step — see `SKILL.md`'s `## Input` for when this group is offered or filtered, and `../bootstrap-steps.md` for its ordering and renumbering conventions.*

Cloud sessions (claude.ai/code) and scheduled Routines run in fresh sandboxes with no access to this machine's local `~/.claude` config. A project that never configures this has full local capability but silently loses claude-tweaks (and everything it depends on) the moment someone opens a cloud session or fires a scheduled Routine against it.

**The declaration is not the installer — the Setup script is.** The **project-level** `.claude/settings.json#enabledPlugins` (paired with any custom marketplace under `extraKnownMarketplaces`) is what a sandbox is *permitted* to load, and Anthropic's docs describe those plugins as "installed at session start"; that install was measured not happening. In a live cloud session on a repo whose clone contained the declaration, with the environment's network access set to **Full** and the marketplace repo clonable from inside the VM, `~/.claude/plugins/` did not exist at all — no `known_marketplaces.json`, no `marketplaces/`, no `cache/` — and every plugin command returned `Unknown command`. Adding `bash scripts/claude-cloud-setup.sh` to that same environment's Setup script field fixed it in the next session (measured with the bare form then in use; the canonical field line today is the logging form in `scripts/claude-cloud-setup.sh`'s header), on two different repositories, one of which received no repo change at all. So: declare **and** paste the Setup script. A project with the declaration and no Setup script has nothing installed, which is the same outcome as declaring nothing (`[IL-113]`). That measurement covers interactive cloud sessions, where the field is confirmed effective. Scheduled Routine sandboxes were measured **not** receiving the field's effects (2026-08-09, reproduced across three fresh containers — populated field, zero plugin effects; the scope of affected sandbox types is unknown, so treat further incidents as appends, not replacements). The routine kernel's self-heal-to-execution fallback (#260) — not this field — is what guarantees a scheduled firing ends in a real result or a diagnosable failure (`[IL-117]`).

**Gate:** same two-tier check Step 9 documents. No remote → skip this step silently.

**Branch check.** Resolve the repo's actual GitHub default branch: when `gh` is available and authenticated, `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`; otherwise fall back to `git remote show origin` and read its `HEAD branch:` line (the same two-source lookup `skills/_shared/integration-branch.md`'s git-inference rank runs, which `/claude-tweaks:routine`'s CREATE Step 5.5 reaches only after every stated source above it has come up empty). Compare it against the current branch (`git branch --show-current`). If neither source resolves a default branch, skip this check silently rather than guessing — everything below still runs. If they differ, this doesn't block the step, but print this warning before continuing to Detect:

> This project's default branch is '{default}', but you're currently on '{current}'. Cloud sessions check out '{default}' — the plugin declarations and script this step is about to write won't take effect for cloud sessions until this branch merges into '{default}'. Scheduled Routines are pinned separately: each audits the branch it was given at creation time. If '{current}' is where development actually happens, set `integration-branch: {current}` in `.claude-tweaks/policy.yml`, so every routine created or re-synced from here on audits it — existing ones pick it up on `/claude-tweaks:routine update <skill>`.

That second half matters because the two are genuinely independent: a routine left unpinned audits '{default}' forever, and on a `dev` → `staging` → `main` model that branch can be simultaneously behind and ahead of the one being developed (#132). This check runs on every invocation of this step, including a re-run where the Idempotency behavior below skips the settings.json portion — the branch can change between runs even when the declared plugins haven't.

**Detect.** Read the current project's `.claude/settings.json` (treat as `{}` if the file doesn't exist yet) — get `enabledPlugins` and `extraKnownMarketplaces`, each defaulting to `{}` if absent. Read `~/.claude/settings.json` (user-level) the same way. `claude-tweaks@claude-tweaks-marketplace` and `superpowers@claude-plugins-official` are this step's two hard requirements — always candidates for declaration, regardless of whether they appear in the user-level file (this session is running *as* claude-tweaks, so its own identity and its hard dependency are always known). Any other key present in the user-level `enabledPlugins` that is **not** already a key in the project-level `enabledPlugins` is a mirror candidate — read straight from the JSON keys (already fully-qualified `name@marketplace` strings), no CLI-output parsing needed.

**Present.** Call `AskUserQuestion` with a batch table, per this repo's Multi-item Decisions convention:

- `question`: `"Declare these plugins for cloud sessions and Routines? Cloud sandboxes only see what's declared in this project's own .claude/settings.json — not your local machine's config."`, `header`: `"Cloud parity"`, `multiSelect`: `false`
- Option 1 — `label`: `"Apply all recommended (Recommended)"`, `description`: `"Declare claude-tweaks + superpowers, plus mirror {N} other locally-enabled plugin(s): {list}."` (omit the "plus mirror..." clause entirely when there are no mirror candidates — just "Declare claude-tweaks + superpowers.")
- Option 2 — `label`: `"Override specific items"`, `description`: `"Choose which of the {N} candidates above to declare — claude-tweaks and superpowers are always included."`
- Option 3 — `label`: `"Skip entirely"`, `description`: `"Don't touch .claude/settings.json — I'll configure cloud parity myself later."`

When there are zero mirror candidates, this still renders (never silently auto-applied — matches Step 8's "always prompt before wiring a settings file" precedent), with Option 1's description reduced to the two hard deps only. On "Override specific items," follow up with the two candidates that are always-included stated plainly, then a `multiSelect: true` `AskUserQuestion` listing only the mirror candidates for the user to pick from.

**Apply.** On any outcome except "Skip entirely": merge the project's `.claude/settings.json` — preserve every existing key untouched (same non-destructive merge Step 8 uses for `~/.claude/settings.json`'s `statusLine` key), add `claude-tweaks@claude-tweaks-marketplace: true` and `superpowers@claude-plugins-official: true` under `enabledPlugins`, plus one `true` entry per selected mirror candidate. For `extraKnownMarketplaces`: always ensure a `claude-tweaks-marketplace` entry —

```json
"claude-tweaks-marketplace": {
  "source": {
    "source": "github",
    "repo": "thomasholknielsen/claude-tweaks-marketplace"
  }
}
```

— and for each mirrored plugin whose marketplace isn't `claude-plugins-official` (Anthropic's own official marketplace needs no explicit registration), copy that marketplace's source definition from the user-level `~/.claude/settings.json#extraKnownMarketplaces` into the project-level file, keyed the same way.

**Generate `scripts/claude-cloud-setup.sh`** — always regenerated in full (never appended to or hand-merged):

```bash
#!/usr/bin/env bash
# Generated by claude-tweaks /init (Step 14 — Cloud/Routine Parity Setup).
# Regenerated in full on every /init run from .claude/settings.json — do not hand-edit;
# customize by changing enabledPlugins/extraKnownMarketplaces instead, then re-run /init.
# Idempotent: safe to run on every cloud session, not just the first.
#
# Paste this canonical line into this project's claude.ai/code environment Setup script
# field (environment settings, web UI only — no API sets this remotely) so cloud sessions
# get the same plugins available locally:
#   { bash scripts/claude-cloud-setup.sh || bash */scripts/claude-cloud-setup.sh; } > "$HOME/claude-cloud-setup.log" 2>&1 || true
# See CLAUDE.md's "Cloud parity" section for why this exists and what it doesn't cover.
set -euo pipefail

# The Setup script field's cwd is a workspace root containing the cloned repo as a single
# subdirectory, not the repo root itself ($HOME is not a reliable substitute either) —
# locate the repo by its .git marker (directory or file, to also cover gitdir-file clone
# forms) and cd into it before anything below runs. This defense and the field line's own
# `*/scripts/` fallback both encode the same workspace-root layout assumption — changing
# one obliges re-verifying the other.
SEARCH_ROOT="$(pwd)"
REPO_DIR=$(find "$SEARCH_ROOT" -maxdepth 2 \( -type d -o -type f \) -name .git 2>/dev/null | head -1 | xargs -I{} dirname {})
[ -n "$REPO_DIR" ] && cd "$REPO_DIR"

# Marketplaces referenced below that Claude Code doesn't already know by name — refreshed
# every run so a later `update` pulls from a current catalog pointer, not a stale local clone.
# `add` stays best-effort (a duplicate add is the expected no-op on every re-run), but a
# failed `update` is announced rather than swallowed: `claude plugin update` decides whether
# a plugin is current by comparing version strings against THIS local catalog and nothing
# else, so a catalog that failed to refresh makes every "already at the latest version"
# below true of a stale snapshot and false of reality.
claude plugin marketplace add thomasholknielsen/claude-tweaks-marketplace 2>/dev/null || true
claude plugin marketplace update claude-tweaks-marketplace \
  || echo "[claude-cloud-setup] WARNING: catalog refresh failed for claude-tweaks-marketplace — version checks below are measured against whatever catalog this sandbox already had."
# `claude-plugins-official` (Anthropic's own marketplace) still needs an explicit `add` here:
# on a fresh cloud sandbox it is not pre-registered at the CLI/runtime level (only this
# project's own .claude/settings.json schema recognizes it by name with no settings entry),
# so `update` alone is a silent no-op until `add` has run at least once in this sandbox.
claude plugin marketplace add anthropics/claude-plugins-official 2>/dev/null || true
claude plugin marketplace update claude-plugins-official \
  || echo "[claude-cloud-setup] WARNING: catalog refresh failed for claude-plugins-official — version checks below are measured against whatever catalog this sandbox already had."
# (one additional `claude plugin marketplace add <org>/<repo> 2>/dev/null || true` line plus
# a matching `claude plugin marketplace update <name> || echo "[claude-cloud-setup] WARNING: ..."`
# line per mirrored plugin's marketplace, sourced from that marketplace's `source.repo` field
# in extraKnownMarketplaces — omit both only for a marketplace already added above)

# Plugins declared in .claude/settings.json#enabledPlugins. `claude plugin install` is NOT
# idempotent (errors if the plugin is already present), so try update first and fall back to
# install if update fails. This avoids fragile JSON parsing and works reliably across all runs.
# Deliberately not silencing update's stderr here: if update fails for a real reason (network,
# corrupt marketplace cache) rather than "not installed yet," the install fallback's own
# "already installed" error would otherwise be the only, misleading diagnostic surfaced.
PLUGIN_SPECS="claude-tweaks@claude-tweaks-marketplace superpowers@claude-plugins-official"
# (one additional spec appended to PLUGIN_SPECS per mirrored plugin, in the same order
# enabledPlugins lists them — the update-then-install and verify loops both pick it up)
for spec in $PLUGIN_SPECS; do
  claude plugin update "$spec" --scope project || claude plugin install "$spec" --scope project
done

# Verify what landed; do not trust that the loop above landed it. `claude plugin update`
# compares version strings and never looks inside the cached plugin directory — a sandbox
# whose plugin directory is older than its own installation record passes the loop with
# "already at the latest version" and exit 0, which is indistinguishable from success
# (claude-tweaks #129: a Routine ran a build predating a shipped fix for days, reporting the
# pre-fix behavior as though it were current). Resolve each plugin's version from the
# directory a session would actually load, compare it against the catalog, and repair drift.
# Session-scoped destination, reimplemented inline rather than delegating to
# bin/lib/session-tmp.js (_shared/session-tmp-root.md's mechanism) — this generated script's
# whole job is bootstrapping claude-tweaks onto a sandbox that doesn't have it yet, so it can
# never assume ${CLAUDE_PLUGIN_ROOT} resolves to an installed payload at the point this line
# runs. The collision this convention exists to prevent doesn't apply here either way: each
# cloud sandbox this script provisions is its own isolated container with its own /tmp, so
# there is no concurrent-session race to close — this mirrors the mechanism (and its degrade
# rule) defensively, in case the script is ever re-run inside a live session that does export
# CLAUDE_CODE_SESSION_ID, rather than because a collision has ever been observed here.
CC_TMP_DIR="${TMPDIR:-/tmp}"
if [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then
  CC_TMP_DIR="$CC_TMP_DIR/ct-session-$CLAUDE_CODE_SESSION_ID"
  mkdir -p "$CC_TMP_DIR"
fi
CC_INSTALLED="$CC_TMP_DIR/cc-installed.json"
CC_MARKETPLACES="$CC_TMP_DIR/cc-marketplaces.json"
claude plugin list --json > "$CC_INSTALLED" 2>/dev/null || echo '[]' > "$CC_INSTALLED"
claude plugin marketplace list --json > "$CC_MARKETPLACES" 2>/dev/null || echo '[]' > "$CC_MARKETPLACES"

for spec in $PLUGIN_SPECS; do
  VERDICT=$(node -e '
    const fs = require("fs");
    const spec = process.argv[1];
    // The two session-scoped snapshot paths reach the script as process.argv args rather
    // than spliced into this single-quoted JS source (_shared/session-tmp-root.md) — a
    // path containing a quote character would otherwise break out of the string literal,
    // the same reason code-health/focus-mode.mds F1 block passes its own values that way.
    const installedPath = process.argv[2];
    const marketplacesPath = process.argv[3];
    const [pluginName, marketplaceName] = spec.split("@");
    const read = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

    // The installed directory decides what a session loads. `claude plugin list`s own
    // `version` is metadata recorded beside that directory rather than read out of it, and
    // `installed_plugins.json`s `gitCommitSha` is not refreshed by `claude plugin update`
    // at all — neither can be trusted to describe the files actually on disk.
    const entry = (read(installedPath) || []).find((p) => p.id === spec);
    const manifest = entry && read(entry.installPath + "/.claude-plugin/plugin.json");
    const installed = (manifest && manifest.version) || "none";

    const mkt = (read(marketplacesPath) || []).find((m) => m.name === marketplaceName);
    const catalog = mkt && read(mkt.installLocation + "/.claude-plugin/marketplace.json");
    const declared = catalog && (catalog.plugins || []).find((p) => p.name === pluginName);
    // Not every marketplace declares a per-plugin version (claude-plugins-official does not).
    // An absent declaration is nothing to compare against, not evidence of drift — but that
    // guard must not also swallow a total non-install. On a cold sandbox, the marketplace
    // list/read above can fail for the same underlying reason nothing got installed (first-run
    // race, marketplace not yet resolvable), which degrades `expected` to "unversioned" too —
    // indistinguishable, by this variable alone, from a marketplace that legitimately has no
    // version field. `installed === "none"` is unambiguous either way and must win.
    let expected = (declared && declared.version) || null;
    // A git-subdir-sourced entry (claude-tweaks, post-#418) carries no entry-level version at
    // all: the payload plugin.json is the single version authority, and the catalog only pins
    // a release commit sha. Resolve that sha to a version by reading the manifest the source
    // repo actually shipped at that commit, instead of treating a missing version field as
    // nothing to compare (claude-tweaks #860, which used to make claude-tweaks drift permanently
    // unverifiable via this comparison).
    if (!expected && declared && declared.source && declared.source.source === "git-subdir" && declared.source.sha && declared.source.url) {
      // Announce every fallback path with the console.error-to-stderr style this script uses
      // for its other degrades (its output passes through the surrounding $(...) capture into
      // the setup log) -- a silent "unversioned" here used to make the one plugin this block
      // exists to protect (claude-tweaks itself, a git-subdir source) read "ok" on a fetch failure.
      if (declared.source.url.startsWith("https://github.com/")) {
        try {
          const rawBase = declared.source.url.replace(/^https:\/\/github\.com\//, "https://raw.githubusercontent.com/");
          const rawUrl = rawBase + "/" + declared.source.sha + "/" + declared.source.path + "/.claude-plugin/plugin.json";
          const atSha = JSON.parse(require("child_process").execFileSync("curl", ["-fsSL", rawUrl], { encoding: "utf8", timeout: 10000 }));
          if (atSha && atSha.version) expected = atSha.version;
        } catch (e) {
          // Network failure, missing manifest at that path, or unexpected shape: fall through to
          // "unversioned" below, the same fail-open posture as an unresolvable catalog entry --
          // but announce it instead of swallowing it silently.
          console.error("[claude-cloud-setup] WARNING: could not resolve the pinned version of " + spec + " at " + declared.source.sha + " (" + e.message + ") — freshness unverified.");
        }
      } else {
        // The github.com -> raw.githubusercontent.com rewrite above only makes sense for a
        // github.com source url; fetching an unrewritten url for any other host would be
        // meaningless (low severity -- the catalog is already the trust boundary), so skip the
        // fetch entirely rather than invoke curl against a URL that was never rewritten for this.
        console.error("[claude-cloud-setup] WARNING: could not resolve the pinned version of " + spec + " at " + declared.source.sha + " (non-github.com source url) — freshness unverified.");
      }
    }
    expected = expected || "unversioned";

    const drift = installed === "none" || (expected !== "unversioned" && installed !== expected);
    console.log([installed, expected, drift ? "DRIFT" : "ok", (entry && entry.installPath) || "-"].join("\t"));
  ' "$spec" "$CC_INSTALLED" "$CC_MARKETPLACES" || true)
  # `|| true` inside the substitution, because this loop is diagnostic-and-repair, not a
  # prerequisite: under `set -e` an unreadable manifest would otherwise abort the script here.
  if [ -z "$VERDICT" ]; then
    echo "[claude-cloud-setup] WARNING: could not resolve an installed version for $spec — freshness unverified."
    continue
  fi

  INSTALLED=$(printf '%s' "$VERDICT" | cut -f1)
  EXPECTED=$(printf '%s' "$VERDICT" | cut -f2)
  STATUS=$(printf '%s' "$VERDICT" | cut -f3)
  WHERE=$(printf '%s' "$VERDICT" | cut -f4)
  echo "[claude-cloud-setup] $spec: installed=$INSTALLED catalog=$EXPECTED ($STATUS) at $WHERE"

  if [ "$STATUS" = "DRIFT" ]; then
    echo "[claude-cloud-setup] DRIFT: $spec resolves v$INSTALLED but the catalog declares v$EXPECTED — reinstalling."
    claude plugin uninstall "$spec" --scope project || true
    claude plugin install "$spec" --scope project
  fi
done

# playwright-cli — required in the cloud sandbox for /browse-dependent skills
# (/stories, /visual-review, /review, qa-agent, /flow) to work in cloud sessions.
npm install -g @playwright/cli
```

Write this to `scripts/claude-cloud-setup.sh` in the project root, creating the `scripts/` directory if it doesn't exist. `2>/dev/null || true` on every marketplace-**add** line — a duplicate add is the expected no-op on a re-run. Marketplace-**update** lines are not silenced: they fall through to a `WARNING` echo instead, because a failed catalog refresh is not a harmless no-op here but the precondition that makes the version comparison downstream measure the sandbox against itself. The plugin install-or-update branch and the `npm install -g @playwright/cli` line are left unguarded so a real failure surfaces loudly within the Setup script's own ~5-minute budget, rather than being silently swallowed.

**The dedicated-environment offer is deferred to Step 15, not asked here.** Writing the script is not what makes it run — an environment has to reference it — but whether a *dedicated* environment is worth creating right now depends on whether this same `/init` pass ends up selecting any Routine (Step 15): an interactive cloud session doesn't need a dedicated environment the same way a scheduled Routine does, and asking here — before Step 15 has even run — risks steering the user toward creating one for a reason (Routines) they're about to decline. Rather than calling `AskUserQuestion` at this position, this step's file/settings.json writes above are its complete output; the "apply the Setup script to a dedicated environment now via browser" offer itself is issued from Step 15 instead, once its routine picklist selection is fully known — see `step-15-routine-installation.md`'s "Apply the Setup script to a dedicated environment (deferred from Step 14)" section for the full procedure, its two outcome branches (one or more routines selected: same offer, options, and Recommended default as before — no behavior change; zero selected: no offer is asked, falling straight through to the manual instruction line), and the `REPO_SLUG`/`environment_name`/reporting details this paragraph used to own. Step 15 still runs after this step in a normal `/init` pass (see this step's own header) — that ordering is unchanged and is what lets Step 15's deferred offer, on success, resolve to the same environment every routine it goes on to create then reuses. When Step 15 itself is skipped entirely (no routine templates shipped, or every candidate already has a record), the deferred offer never fires either — the `## Cloud parity` CLAUDE.md section below still documents the manual Setup-script line permanently, so nothing about cloud parity is lost, only the proactive browser-automation offer.

**Why the verify loop exists (#129).** `claude plugin update` is a version-string comparison against the local catalog, not a content check — confirmed live by emptying a cached plugin directory of its files and re-running `update`, which reported `already at the latest version` and exit 0 while repairing nothing. Three separate conditions therefore produce an identical, successful-looking log: a catalog that failed to refresh, a plugin directory restored from an older snapshot, and a genuinely current install. The verify loop separates the second from the third, and the un-silenced marketplace `update` separates the first. What none of it covers is the case where this script never runs at all in a given sandbox — that one is caught from the other side, by the resolved-build line every routine prompt now prints at startup (`_shared/routine-template-schema.md`'s standard prompt kernel). The two together are what make a stale sandbox self-identifying instead of merely suspected.

Deliberately **not** added to the generated `## Cloud parity` CLAUDE.md section below: that section is already a large always-loaded block in consuming projects, and the failure it would describe is now announced by the script and the routine themselves, at the moment it happens, to whoever is actually reading the log.

**Write/update the `## Cloud parity` CLAUDE.md section** — add near the other project-level config sections (same "add or update a section" idiom Step 11 uses for `## Design integration`):

```markdown
## Cloud parity

Cloud sessions (claude.ai/code) and scheduled Routines run in fresh sandboxes with no
access to this machine's local ~/.claude config. Two things are required, and the
declaration alone is not enough: this project's .claude/settings.json#enabledPlugins
(paired with any custom marketplace under extraKnownMarketplaces) says what a sandbox
may load, and the Setup script below is what actually installs it. The field is
confirmed effective for interactive cloud sessions; it was measured not reaching
scheduled Routine sandboxes (scope of affected sandbox types unknown) — the routine
kernel's self-heal fallback, not this field, is what guarantees a scheduled
firing ends in a real result or a diagnosable failure.

- **Setup script (required, not optional):** paste the canonical Setup-script line (see
  `scripts/claude-cloud-setup.sh`'s header) into this project's cloud environment's Setup script
  field (claude.ai/code environment settings, web UI only — no API/CLI can set this remotely).
  Installs every declared plugin/marketplace. Regenerated by
  `/claude-tweaks:init`; don't hand-edit it. Without it, a declared plugin is simply absent:
  measured on a live session whose clone carried the declaration, with network access Full,
  `~/.claude/plugins/` did not exist at all and every plugin command returned `Unknown command`.
  This applies per *environment*, not per repo — an environment you pick in the session composer
  that has never had this pasted will fail this way even for a repo that is fully declared.
- **Branch:** cloud sessions check out the environment's configured branch (typically this
  repo's actual GitHub default branch) — confirm it's the branch these plugin declarations
  actually landed on, especially if your team develops primarily on a non-default branch.
  Scheduled Routines are pinned independently of that: each audits the branch it was given
  at creation. If development happens off the default branch, set `integration-branch` in
  `.claude-tweaks/policy.yml` — every routine created or re-synced afterwards picks it up.
- **First exposure:** if a skill is uninvocable in a cloud session, check which of two
  states you're in before waiting — they look identical from the chat and need opposite
  responses. Run `ls ~/.claude/plugins/`. Missing directory (or an empty `marketplaces/`)
  means nothing was installed: the Setup script is absent from this environment or it
  failed, and waiting will never fix it — check the session's "Initialized session" panel
  for the script's output. Present and populated, yet the skill is still uninvocable, is
  the transient case: that has been observed to clear one session later with no config
  change, but that was one observation, not a guarantee — re-check the directory rather
  than assuming a heal is coming.
- **MCP servers:** this project's committed .mcp.json is what cloud sessions see. Any MCP
  server configured only in your local ~/.claude.json won't reach cloud — review those
  individually if cloud parity matters for them (server configs can carry credentials, so
  this is never auto-copied).
```

**MCP-parity note (report-only, no write).** Read the current project's `.mcp.json` if it exists (top-level `mcpServers` object — the same key Claude Code's own project-MCP convention uses; verify this against the actual file content before relying on it, since it may vary). Read `~/.claude.json`'s own `mcpServers` object the same way, verifying its actual shape directly rather than assuming — this file's structure hasn't been previously confirmed by this plugin. For every server name present in the local file but absent from the project's `.mcp.json`, print one line: `"{N} MCP server(s) configured locally aren't available to cloud sessions: {names}. If any should be, add them to .mcp.json yourself — server configs can contain credentials, so this is never done automatically."` Print nothing when there's no local-only server, or when `~/.claude.json` has no `mcpServers` key at all.

**Idempotency / re-run behavior.** On a re-run where the project's `.claude/settings.json` already declares both hard deps and there are no new local-only mirror candidates: skip the `AskUserQuestion` prompt, report "Cloud parity: already configured" under Phase 9's Verified & Consistent section, and still regenerate `scripts/claude-cloud-setup.sh` silently (its content is fully derived, so silent regeneration can't lose anything) — but only re-render the CLAUDE.md section if it's missing or doesn't already contain the four bullet labels above (Setup script / Branch / First exposure / MCP servers), to avoid a spurious rewrite on every run.

**Failure handling.** Malformed `.claude/settings.json` (fails to parse as JSON) → report it and skip this step entirely rather than risk corrupting it with a merge. A write failure on either generated file → surface the failure and continue the rest of `/init` (same "don't abort on this step's failure" precedent as Step 11's plugin-install failure handling).
