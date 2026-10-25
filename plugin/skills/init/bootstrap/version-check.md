# Core Bootstrap Version Check (detailed procedure)

Runs before Step 1, on every `/init` invocation regardless of scope — **except** when
`$ARGUMENTS` explicitly names the `bootstrap` Phase scope, which always runs Steps 1-8.5 fully
regardless of the marker (see the Exception in `../SKILL.md`'s "Core Bootstrap Version Check").

**Read the marker and extract its version:**

```bash
MARKER_RAW=$(cat .claude-tweaks/init-state.yml 2>/dev/null)
if [ -z "$MARKER_RAW" ]; then
  MARKER_VERSION=""
else
  MARKER_VERSION=$(echo "$MARKER_RAW" | grep -E '^[[:space:]]*plugin-version:' | sed -E 's/.*plugin-version:[[:space:]]*//; s/"//g')
fi
```

`init-state.yml` only ever has one top-level key (`core-bootstrap`) with two flat children
(`plugin-version`, `verified`), each written double-quoted (see "Write the marker" below) — the
`sed` above strips those quotes, since `compareVersions` rejects a quoted string as invalid
semver. Treat an empty `$MARKER_VERSION` (file missing, or present but malformed enough that
the grep finds no `plugin-version:` line) identically: as if the marker were absent.

**Read the installed version:**

```bash
INSTALLED_VERSION=$(node -e "console.log(require('${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json').version)")
```

**Compare (only when `$MARKER_VERSION` is non-empty):**

```bash
node -e "
  const { compareVersions } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/changelog.js');
  console.log(compareVersions(process.argv[1], process.argv[2]));
" -- "$MARKER_VERSION" "$INSTALLED_VERSION"
```

Prints `-1` (marker older than installed), `0` (match), or `1` (marker newer — shouldn't happen
in practice, treat identically to a match). If `compareVersions` throws (e.g. `$MARKER_VERSION`
extracted to something that still isn't valid semver), treat it the same as marker-missing —
run Steps 1-8.5 fully, skip the changelog notice.

- `$MARKER_VERSION` empty (missing or malformed) → run Steps 1-8.5 fully, skip the changelog notice.
- Result `0` or `1` → skip Steps 1-8.5 (except under the `bootstrap`-scope Exception above, which always runs them); print `"Core bootstrap already verified at v$MARKER_VERSION on {verified date from the marker} — skipping Steps 1-8.5. Delete .claude-tweaks/init-state.yml to force a full re-check."`
- Result `-1` → run Steps 1-8.5 fully, then run the changelog notice below.

**Changelog notice:**

`CHANGELOG.md` is a dev-side file — it lives at the repo root, outside the `plugin/` payload
(`CLAUDE.md`'s Structure table), so a `git-subdir` install never ships a copy alongside the
plugin root the snippet below reads from. This notice is informational-only (see "Changelog
notice policy" below), so its absence is a silent skip, not an error:

```bash
node -e "
  const fs = require('fs');
  const path = '${CLAUDE_PLUGIN_ROOT}/CHANGELOG.md';
  if (!fs.existsSync(path)) { console.log(JSON.stringify([])); process.exit(0); }
  const { extractChangelogRange } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/changelog.js');
  const changelog = fs.readFileSync(path, 'utf8');
  console.log(JSON.stringify(extractChangelogRange(changelog, process.argv[1], process.argv[2])));
" -- "$MARKER_VERSION" "$INSTALLED_VERSION"
```

An empty array means either no entries in range or (the common installed-build case) no
`CHANGELOG.md` to read — skip the notice silently either way; there is nothing to synthesize.
Read the returned `{version, title, body}` entries — in the same newest-first order they
appear in `CHANGELOG.md` — and synthesize the filtered summary described under "Changelog notice policy"
below.

**Write the marker:**

```bash
mkdir -p .claude-tweaks
cat > .claude-tweaks/init-state.yml <<EOF
core-bootstrap:
  plugin-version: "$INSTALLED_VERSION"
  verified: "$(date -u +%Y-%m-%d)"
EOF
```

Write this only after Steps 1-8.5 have actually run (or been skipped) — not before.
`init-state.yml` only ever has this one key today — a full overwrite is safe. If a future
change adds other top-level keys to this file, switch to a merge instead of an overwrite.

## Marker state to action

| Marker state | Action |
|---|---|
| Missing | Run Steps 1-8.5 fully. No changelog notice — nothing to diff against yet. |
| Present, versions match, or marker newer than installed (shouldn't happen in practice, treat identically) | Skip Steps 1-8.5 entirely; print a one-line confirmation naming the marker's own recorded version and date, and mentioning that deleting `.claude-tweaks/init-state.yml` forces a full re-check. |
| Present, marker version older than installed | Run Steps 1-8.5 fully, then surface the changelog notice below. |

## Changelog notice policy

**Changelog notice (version-mismatch case only).** Read the plugin's own `CHANGELOG.md` when the "Changelog notice" snippet above found one (not the target project's — the marker records a *plugin* version, so only the plugin's own changelog is meaningful to diff against) and call `bin/lib/changelog.js`'s `extractChangelogRange` for the range between the marker's old version (exclusive) and the installed version (inclusive). Synthesize a short summary limited to entries that change what `/init` offers, writes to CLAUDE.md, or exposes as a scope/config key — omit internal-only entries (bug fixes, refactors with no `/init`-visible behavior change). Present as an informational note, not a gate, ending with a pointer to `/init update --full` (or a narrower scope) if the user wants to act on anything it surfaces. No cap on how large the range is — if it spans an unusually large number of releases, say so explicitly.

## When to write the marker

The `worktree-always` contrast drawn below names `../SKILL.md`'s "Finalizing the worktree-always
Decision" section, whose own procedure lives in `../worktree-policy-finalization.md`.

**Write the marker** after Steps 1-8.5 have run (or been skipped) — i.e. as the last step of this whole Core Bootstrap Version Check, not before Steps 1-8.5 execute — regardless of which branch ran. Unlike the `worktree-always` decision (see "Finalizing the worktree-always Decision" below), this write creates no new gate that could deny this same invocation's own remaining steps, so there is no need to defer it further than that. Create `.claude-tweaks/` if it doesn't exist yet.
