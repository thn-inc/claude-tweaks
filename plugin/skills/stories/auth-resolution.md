# Stories — Auth Resolution

Loaded by `/claude-tweaks:stories` Step 2 **only when** at least one discovered page requires authentication. When no auth-gated page is found, SKILL.md skips this file entirely.

## Auth Vault — vault-naming convention

Stories that require login reference the captured session-state file via `auth: { vault: "<name>" }`. Vault names follow this convention:

- `default-user` — canonical user persona (matches the examples in `story-examples.md`).
- `<persona>-user` — additional personas (`admin-user`, `customer-user`).
- `<project-slug>-user` — when a project benefits from disambiguating from other vaults on the same machine.

Stay consistent with whatever vault list `ls .claude-tweaks/auth-state/*.json` already shows; only introduce a new convention when no clean match exists.

## Procedure

1. **List existing vaults:** Run `ls .claude-tweaks/auth-state/*.json`. Each file's basename (minus `.json`) is a vault name.
2. **Vault matches the project** (e.g., `default-user`, project slug, admin/customer name): use that name. Stories reference it via `auth: { vault: "<name>" }`.
3. **No matching vault:**

   **Interactive mode:** print the one-time capture procedure for the user to run in their own shell — do NOT search the project for credentials and do NOT ask the LLM:
   ```
   No matching auth vault found. To create one (the LLM will never see the password):

       playwright-cli open <login-page-url>
       # log in directly in the browser, then:
       playwright-cli state-save .claude-tweaks/auth-state/<vault-name>.json
       playwright-cli close

   Recommended vault name: `default-user` (or `<project-slug>-user`).
   ```
   Then call `AskUserQuestion` with `question`: `"Auth vault ready?"`, `header`: `"Auth vault"`, `multiSelect`: `false`:
   - Option 1 — `label`: `"Ready (Recommended)"`, `description`: `"Vault was created — re-run ls .claude-tweaks/auth-state/*.json, confirm, and continue"`
   - Option 2 — `label`: `"Skip for now"`, `description`: `"Skip auth-gated stories — tag them needs-auth-vault"`

   On "Ready": re-run `ls .claude-tweaks/auth-state/*.json`, confirm, continue. On "Skip for now": tag stories needing auth as `needs-auth-vault`. Note: Step 5 refinement's sample selection (5a) filters only by `priority`, not tags, so a tagged story can still be selected for validation — if it is, the auth step is inapplicable and the story is expected to fail validation until a vault exists (not a defect).

   **Auto mode:** never block — tag auth-gated stories as `needs-auth-vault` and stage the install hint. (Step 5 refinement's sample selection filters only by `priority`, not tags, so a tagged story may still be validated and is expected to fail its auth step until a vault exists.) Log:
   ```
   STAGED {HH:MM:SS} — Auth Resolution: no matching vault for {auth-gated-page-list}. Auth-gated stories tagged `needs-auth-vault` (may still be sampled by Step 5 refinement and fail the auth step until a vault exists). User can create a vault with `playwright-cli open <login-url>`, logging in, then `playwright-cli state-save .claude-tweaks/auth-state/default-user.json`, and re-run /stories. Reversibility: high (re-run /stories or /test qa).
   ```
   Surface the install hint at the Wrap-Up Review Console.
4. **Multiple vaults exist** (e.g., `default-user`, `admin-user`): map each story's persona to the matching vault; fall back to `default-user` with a comment when no clean match.

## Tag self-heal (update mode)

When update mode is active and an existing story carries the `needs-auth-vault` tag, re-check it against the `ls .claude-tweaks/auth-state/*.json` output from Step 1 of this procedure: if a matching vault now exists, remove the tag (and any accompanying vault-hint comment) as part of the update-mode write — the tag records a condition that no longer holds, and leaving it makes every later run re-report a solved problem. `/test qa`'s Story Hygiene section recommends the same cleanup when it observes a tagged story whose vault now exists; this step is what actually performs it.
