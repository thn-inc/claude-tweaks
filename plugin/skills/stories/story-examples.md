# Story Examples

All examples use schema v2 — locators are semantic only: `{ role, name? }`, `{ testid }`, `{ text, exact? }`, `{ label }`, `{ placeholder }`. Raw selectors and `@eN` snapshot refs are forbidden in YAML. At runtime, a locator and its step's action execute as a two-step sequence — `snapshot` to resolve the locator to an `eN` ref, then a separate `click <eN>`/`fill <eN> "<text>"` (Playwright CLI's `find` is read-only and text-only, so it cannot resolve role/testid/css locators or perform an action in one call) — see `playwright-cli-reference.md` in the `/claude-tweaks:browse` skill directory for the full operation vocabulary.

### Example 1: DOM-only stories (no source files available)

Input: `/claude-tweaks:stories https://news.ycombinator.com/`

Output file: `stories/hackernews-reader.yaml`
```yaml
schema_version: 2

stories:
  - id: front-page-loads
    description: "Front page loads with posts"
    url: "https://news.ycombinator.com/"
    tags: [smoke, navigation]
    priority: high
    source_files: []
    steps:
      - action: assert_visible
        locator: { role: heading, name: "Hacker News" }
        verify: "At least 10 posts are visible, each with a title and a link"
      - action: assert_visible
        locator: { text: "points" }
        verify: "Each post shows a rank number, score, and comment count"

  - id: navigate-to-page-two
    description: "Navigate to page two and back"
    url: "https://news.ycombinator.com/"
    tags: [navigation]
    priority: medium
    source_files: []
    steps:
      - action: assert_visible
        locator: { role: heading, name: "Hacker News" }
        verify: "Front page loads with posts"
      - action: click
        locator: { text: "More" }
        verify: "Page 2 loads with a new set of posts"
      - action: press
        value: "Alt+ArrowLeft"
        verify: "Page 1 loads again with the original posts"

  - id: neg-404-handling
    description: "Non-existent page shows error gracefully"
    url: "https://news.ycombinator.com/item?id=9999999999"
    tags: [negative, error-handling]
    priority: medium
    source_files: []
    steps:
      - action: assert_visible
        locator: { text: "No such item." }
        verify: "Page shows an error message or 'No such item' — not a blank screen or crash"
```

### Example 2: Source-aware stories (React app with source analysis)

Input: `/claude-tweaks:stories http://localhost:3000`

Source analysis found: `app/(dashboard)/settings/page.tsx` imports a `ProfileForm` component with `maxLength={50}` on the name input, a zod schema requiring email format, an `isSaving` state variable, and a `useMutation` with success/error toasts.

Output file: `stories/myapp-admin.yaml`
```yaml
schema_version: 2

stories:
  - id: settings-profile-update
    description: "Update profile with valid data"
    url: "http://localhost:3000/settings"
    auth: { vault: "default-user" }
    tags: [core, form]
    priority: high
    source_files:
      - app/(dashboard)/settings/page.tsx
      - app/(dashboard)/settings/components/profile-form.tsx
      - lib/schemas/profile.ts
    steps:
      - action: assert_visible
        locator: { role: heading, name: "Profile settings" }
        verify: "Profile form is visible with name and email fields"
      - action: fill
        locator: { label: "Name" }
        value: "Alice Johnson"
        verify: "Name field shows 'Alice Johnson'"
      - action: fill
        locator: { label: "Email" }
        value: "alice@example.com"
        verify: "Email field shows 'alice@example.com'"
      - action: click
        locator: { role: button, name: "Save" }
        verify: "Save button shows a loading spinner (isSaving state), then a success toast appears"
      - action: assert_visible
        locator: { text: "Profile updated", exact: true }
        verify: "Success toast appears confirming profile update"

  - id: settings-name-boundary-max
    description: "Name input enforces maximum length of 50 characters"
    url: "http://localhost:3000/settings"
    auth: { vault: "default-user" }
    tags: [form, core]
    priority: medium
    source_files:
      - app/(dashboard)/settings/components/profile-form.tsx
    steps:
      - action: fill
        locator: { label: "Name" }
        value: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        verify: "Input contains exactly 50 characters — the 51st character is not accepted or a validation error is shown"

  - id: settings-email-validation
    description: "Email field rejects invalid format"
    url: "http://localhost:3000/settings"
    auth: { vault: "default-user" }
    tags: [form, error-handling]
    priority: medium
    source_files:
      - app/(dashboard)/settings/components/profile-form.tsx
      - lib/schemas/profile.ts
    steps:
      - action: fill
        locator: { label: "Email" }
        value: "not-an-email"
        verify: "Email field shows entered text"
      - action: click
        locator: { role: button, name: "Save" }
        verify: "Validation error appears near the email field indicating an invalid email format. Form is NOT submitted."
      - action: assert_visible
        locator: { text: "Invalid email" }
        verify: "Inline validation error message is visible near the email field"

  - id: settings-save-error-handling
    description: "Profile save failure shows error toast"
    url: "http://localhost:3000/settings"
    auth: { vault: "default-user" }
    tags: [error-handling, core]
    priority: medium
    source_files:
      - app/(dashboard)/settings/components/profile-form.tsx
    steps:
      - action: fill
        locator: { label: "Name" }
        value: "Alice Johnson"
      - action: click
        locator: { role: button, name: "Save" }
        verify: "If the save API call fails, an error toast appears (e.g. 'Failed to save profile') and the save button is re-enabled after the loading state clears"
```

### Example 3: Journey-aware stories

Input: `/claude-tweaks:stories http://localhost:3000`

Journey file exists at `docs/journeys/profile-settings.md` with persona "Returning user who wants to update their profile", entry point `/settings`, and steps covering `/settings`, `/settings/password`, `/settings/notifications`. Journey frontmatter `files:` includes `app/(dashboard)/settings/page.tsx`, `lib/services/profile.ts`.

Output file: `stories/myapp-user.yaml`
```yaml
schema_version: 2

stories:
  - id: profile-settings-flow
    description: "Complete profile settings journey — update profile, change password, configure notifications"
    url: "http://localhost:3000/settings"
    journey: profile-settings
    auth: { vault: "default-user" }
    tags: [core, smoke]
    priority: high
    source_files:
      - app/(dashboard)/settings/page.tsx
      - lib/services/profile.ts
      - app/(dashboard)/settings/components/profile-form.tsx
      - app/(dashboard)/settings/password/page.tsx
      - app/(dashboard)/settings/notifications/page.tsx
    steps:
      - action: assert_visible
        locator: { role: heading, name: "Profile settings" }
        verify: "Profile settings page loads with name and email fields pre-filled"
      - action: fill
        locator: { label: "Name" }
        value: "Alice Johnson"
        verify: "Name field shows 'Alice Johnson'"
      - action: click
        locator: { role: button, name: "Save" }
        verify: "Success toast appears confirming profile update"
      - action: click
        locator: { role: tab, name: "Password" }
        verify: "Password change form is visible with current password and new password fields"
      - action: assert_visible
        locator: { label: "Current password" }
      - action: click
        locator: { role: tab, name: "Notifications" }
        verify: "Notification preferences visible with toggles for email and push notifications"
      - action: assert_visible
        locator: { role: switch, name: "Email notifications" }
```

Note: `source_files` merges the journey's `files:` frontmatter (`page.tsx`, `profile.ts`) with component-level files discovered during source analysis (`profile-form.tsx`, `password/page.tsx`, `notifications/page.tsx`). The `journey: profile-settings` field enables `/test qa journey=profile-settings` and coverage tracking. The `auth: { vault: "default-user" }` field is meant to cause the runtime to load the `default-user` captured session-state file after `open` and before the first action (`state-load` followed by a `goto` re-navigation — see `auth-resolution.md`), so credentials never appear in the YAML.

### Example 4: File-level blocks (setup, teardown, target_env)

File-level blocks sit above the `stories` array. `setup` carries shared preconditions (viewport, an Auth Vault reference, pre-steps), `teardown` runs after the file's stories, and `target_env` records the Target Environment Guard's classification from generation time (`/claude-tweaks:stories` SKILL.md Step 2) — `/test qa` re-checks it before running `negative`-tagged stories.

```yaml
schema_version: 2

target_env: { host: "localhost", classification: local, negatives_acknowledged: true }

setup:
  viewport: "1440x900"
  # Auth Vault reference (vault stores credentials encrypted, locally):
  auth: { vault: "default-user" }
  # Or use file-level `setup.steps` for non-auth setup actions:
  steps:
    - action: navigate
      target: "https://example.com/setup-page"

teardown:
  steps:
    - action: click
      locator: { role: button, name: "Log out" }

stories:
  - id: story-kebab-id
    description: "Descriptive name of the journey"
    url: "https://example.com/starting-page"
    journey: profile-settings          # optional — refs docs/journeys/profile-settings.md
    auth: { vault: "default-user" }    # optional — overrides the file-level vault
    tags: [core, smoke]
    priority: high
    source_files:
      - app/(dashboard)/starting-page/page.tsx
    steps:
      - action: click
        locator: { role: button, name: "Add to cart" }
        verify: "Cart shows 1 item"
```

### Locator-type quick reference

| Locator | Use when | Example |
|---|---|---|
| `{ testid: "..." }` | The element has a `data-testid` (or framework equivalent). Most stable. | `{ testid: "checkout-submit" }` |
| `{ role: "...", name: "..." }` | The element has an unambiguous accessible name. Resolved via `snapshot`'s accessibility tree (see `SKILL.md`'s Locators note) — any role works, not just `button`. | `{ role: button, name: "Save" }` |
| `{ label: "..." }` | Form inputs with associated `<label>` elements. | `{ label: "Email" }` |
| `{ placeholder: "..." }` | Inputs without labels but with placeholder text. | `{ placeholder: "Search posts..." }` |
| `{ text: "...", exact?: true }` | Last resort — unique visible text. Brittle to copy edits. | `{ text: "Order confirmed", exact: true }` |

Locator preference order (Step 3 of `/claude-tweaks:stories`): `testid` > `role + name` > `label` > `placeholder` > `text`.

