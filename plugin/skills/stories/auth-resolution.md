# Stories — Auth Resolution

Loaded by `/claude-tweaks:stories` Step 2 **only when** at least one discovered page requires authentication. When no auth-gated page is found, SKILL.md skips this file entirely.

## Auth Vault — vault-naming convention

Stories that require login reference the credentials via `auth: { vault: "<name>" }`. Vault names follow this convention:

- `default-user` — canonical user persona (matches the examples in `story-examples.md`).
- `<persona>-user` — additional personas (`admin-user`, `customer-user`).
- `<project-slug>-user` — when a project benefits from disambiguating from other vaults on the same machine.

<!-- playwright-cli: no equivalent found for agent-browser auth list — see issue Gotchas -->
Stay consistent with whatever vault list `agent-browser auth list` already shows; only introduce a new convention when no clean match exists.

## Procedure

<!-- playwright-cli: no equivalent found for agent-browser auth list — see issue Gotchas -->
1. **List existing vaults:** Run `agent-browser auth list`. Each row is a vault name plus a username.
2. **Vault matches the project** (e.g., `default-user`, project slug, admin/customer name): use that name. Stories reference it via `auth: { vault: "<name>" }`.
3. **No matching vault:**

   **Interactive mode:** print the one-time command for the user to run in their own shell — do NOT search the project for credentials and do NOT ask the LLM:
   <!-- playwright-cli: no equivalent found for agent-browser auth save — see issue Gotchas -->
   ```
   No matching auth vault found. To create one (the LLM will never see the password):

       agent-browser auth save <vault-name> --url <login-page-url> --username <username> --password <password>

   Add --password-stdin instead of --password to keep the password out of shell history.
   Recommended vault name: `default-user` (or `<project-slug>-user`).
   ```
   Then call `AskUserQuestion` with `question`: `"Auth vault ready?"`, `header`: `"Auth vault"`, `multiSelect`: `false`:
   <!-- playwright-cli: no equivalent found for agent-browser auth list — see issue Gotchas -->
   - Option 1 — `label`: `"Ready (Recommended)"`, `description`: `"Vault was created — re-run agent-browser auth list, confirm, and continue"`
   - Option 2 — `label`: `"Skip for now"`, `description`: `"Skip auth-gated stories — tag them needs-auth-vault"`

   <!-- playwright-cli: no equivalent found for agent-browser auth list — see issue Gotchas -->
   On "Ready": re-run `agent-browser auth list`, confirm, continue. On "Skip for now": tag stories needing auth as `needs-auth-vault`. Note: Step 5 refinement's sample selection (5a) filters only by `priority`, not tags, so a tagged story can still be selected for validation — if it is, the auth step is inapplicable and the story is expected to fail validation until a vault exists (not a defect).

   <!-- playwright-cli: no equivalent found for agent-browser auth save — see issue Gotchas -->
   **Auto mode:** never block — tag auth-gated stories as `needs-auth-vault` and stage the install hint. (Step 5 refinement's sample selection filters only by `priority`, not tags, so a tagged story may still be validated and is expected to fail its auth step until a vault exists.) Log:
   ```
   STAGED {HH:MM:SS} — Auth Resolution: no matching vault for {auth-gated-page-list}. Auth-gated stories tagged `needs-auth-vault` (may still be sampled by Step 5 refinement and fail the auth step until a vault exists). User can create a vault with `agent-browser auth save default-user --url <login-url> --username <username> --password <password>` and re-run /stories. Reversibility: high (re-run /stories or /test qa).
   ```
   Surface the install hint at the Wrap-Up Review Console.
4. **Multiple vaults exist** (e.g., `default-user`, `admin-user`): map each story's persona to the matching vault; fall back to `default-user` with a comment when no clean match.

## Tag self-heal (update mode)

<!-- playwright-cli: no equivalent found for agent-browser auth list — see issue Gotchas -->
When update mode is active and an existing story carries the `needs-auth-vault` tag, re-check it against the `agent-browser auth list` output from Step 1 of this procedure: if a matching vault now exists, remove the tag (and any accompanying vault-hint comment) as part of the update-mode write — the tag records a condition that no longer holds, and leaving it makes every later run re-report a solved problem. `/test qa`'s Story Hygiene section recommends the same cleanup when it observes a tagged story whose vault now exists; this step is what actually performs it.
