# Source Analysis Procedure

Detailed extraction patterns for Step 1.5 of `/claude-tweaks:stories`. This file is lazy-loaded — only read it when performing source analysis on identified component files.

## Framework Detection

Before extracting behavioral signals, identify the framework so you apply the correct patterns. Check these markers in order:

| Marker | Framework | Primary file extensions |
|--------|-----------|------------------------|
| `app/` directory with `page.tsx` files | Next.js App Router | `.tsx`, `.jsx`, `.ts`, `.js` |
| `pages/` directory with route files | Next.js Pages Router | `.tsx`, `.jsx`, `.ts`, `.js` |
| `.svelte` files in `src/routes/` | SvelteKit | `.svelte`, `.ts` |
| `angular.json` in project root | Angular | `.ts`, `.html` |
| `.vue` files in `src/` | Vue / Nuxt | `.vue`, `.ts` |
| `.tsx`/`.jsx` files with `React` imports | Generic React (CRA, Vite, etc.) | `.tsx`, `.jsx` |

**v1 scope:** Only React/JSX/TSX extraction is fully supported. For other frameworks, return an empty SourceContract and let story generation fall back to DOM-only mode. Log: "Source analysis: framework '{name}' detected but not supported — falling back to DOM-only generation."

## React/TSX Extraction Patterns

### Input Constraints

Look for props on input elements and input-wrapping components. These appear as JSX attributes.

**Direct HTML input props:**
```
<input min={N} max={N} minLength={N} maxLength={N} step={N} pattern="..." required />
<textarea minLength={N} maxLength={N} required />
<select required />
```

**Patterns to match (heuristic, not AST):**
- `min={N}` or `min="N"` — numeric minimum
- `max={N}` or `max="N"` — numeric maximum
- `minLength={N}` or `minLength="N"` — text minimum length
- `maxLength={N}` or `maxLength="N"` — text maximum length
- `step={N}` or `step="N"` — numeric step interval
- `pattern="..."` or `pattern={/regex/}` — input pattern constraint
- `required` (boolean prop, no value) — field is required
- `type="email"` / `type="number"` / `type="url"` / `type="tel"` — format constraint

**Component library wrappers (shadcn, MUI, Radix, Mantine, Chakra):**
The same props may appear on wrapper components. Look for the same attribute names on any component that renders an input-like element — names like `Input`, `TextField`, `NumberInput`, `TextInput`, `FormField`, etc.

### Validation Schemas

Validation schemas define constraints separate from the JSX. Follow imports to find schema files if the schema is not inline.

**Zod patterns:**
```
z.string().min(N).max(N)
z.string().email()
z.string().url()
z.string().regex(pattern)
z.number().min(N).max(N).int()
z.number().positive().negative().nonnegative()
z.enum([...values])
z.object({ field: z.string().min(1) })     // required field (min 1)
z.object({ field: z.string().optional() })  // optional field
```

**Yup patterns:**
```
yup.string().required().min(N).max(N)
yup.string().email().url()
yup.number().required().min(N).max(N).integer().positive()
yup.mixed().oneOf([...values])
```

**Joi patterns:**
```
Joi.string().required().min(N).max(N)
Joi.string().email().uri()
Joi.number().required().min(N).max(N).integer()
```

**What to extract from each schema field:**
- Field name
- Base type (string, number, boolean, enum)
- Constraints: min, max, minLength, maxLength, required, format (email/url/etc.)
- Enum values (if applicable)

### State Variables

Look for `useState` hooks where the variable name signals UI-affecting state.

**Naming patterns to flag:**
- `is*` — boolean toggles: `isOpen`, `isEditing`, `isSubmitting`, `isValid`, `isDisabled`, `isAuthenticated`
- `has*` — boolean flags: `hasError`, `hasChanges`, `hasDirtyFields`
- `loading*` / `isLoading` — loading states: `loading`, `isLoading`, `loadingUsers`
- `saving*` / `isSaving` — save-in-progress states
- `error*` / `isError` — error states: `error`, `errors`, `errorMessage`, `isError`
- `show*` — visibility toggles: `showModal`, `showTooltip`, `showDropdown`

**Pattern to match:**
```
const [variableName, setVariableName] = useState(initialValue)
```

For each matched state variable, record:
- Variable name
- Initial value (to understand default state)
- Whether it likely affects UI visibility (names matching patterns above)

Also check for state management hooks from libraries:
- `useReducer` — look at action types in the reducer for state transitions
- `useQuery` / `useMutation` (TanStack Query) — has built-in loading/error/success states
- `useSWR` — has `data`, `error`, `isLoading` return values
- `useForm` (react-hook-form) — has `formState.errors`, `formState.isSubmitting`, `formState.isDirty`

### Conditional Rendering

Look for JSX expressions that conditionally show or hide UI elements.

**Ternary pattern:**
```
{condition ? <ComponentA /> : <ComponentB />}
```
Record: condition, element shown when true, element shown when false.

**Logical AND pattern:**
```
{condition && <Component />}
```
Record: condition, element shown when true, hidden when false.

**Early return pattern:**
```
if (isLoading) return <Spinner />;
if (error) return <ErrorMessage />;
return <MainContent />;
```
Record: each guard condition and its rendered element.

**What makes a conditional testable:**
A conditional is user-triggerable (and therefore story-worthy) when the condition depends on:
- User input (form values, search queries)
- User actions (clicks, toggles)
- State that results from user actions (isOpen after clicking a button)
- API responses triggered by user actions (loading/error/success after form submit)

Conditionals based on server-only data (environment variables, feature flags not in the URL, backend config) are NOT user-triggerable and should be noted but not turned into stories.

### Error Handling

**ErrorBoundary components:**
```
<ErrorBoundary fallback={<ErrorFallback />}>
  <Component />
</ErrorBoundary>
```
Record: which components are wrapped, what fallback UI is shown.

**Try/catch in event handlers:**
```
const handleSubmit = async () => {
  try {
    await api.save(data);
  } catch (error) {
    setError(error.message);
    toast.error("Save failed");
  }
};
```
Record: the triggering action (submit), the error state set, any toast/notification.

**Promise .catch() chains:**
```
fetch("/api/data")
  .then(res => res.json())
  .catch(err => setError(err));
```
Record: the API endpoint, the error handler.

### API Call Patterns

**Fetch / axios:**
```
const response = await fetch("/api/endpoint", { method: "POST", body: ... });
axios.post("/api/endpoint", data);
```

**TanStack Query mutations:**
```
const mutation = useMutation({
  mutationFn: (data) => api.save(data),
  onSuccess: () => { toast.success("Saved"); },
  onError: (err) => { toast.error(err.message); },
});
```

**useSWR:**
```
const { data, error, isLoading } = useSWR("/api/endpoint", fetcher);
```

**What to extract from each API call:**
- Endpoint (URL or path)
- HTTP method
- Loading state variable (if identifiable)
- Error state variable (if identifiable)
- Success behavior (redirect, toast, state update)
- Error behavior (toast, error message, state rollback)

### Toast / Notification Triggers

Look for calls to toast or notification libraries triggered by user actions:
```
toast.success("Item saved")
toast.error("Failed to save")
toast("Message", { type: "warning" })
notifications.show({ title: "...", message: "..." })
```

Record: the trigger context (success/error/action), the message pattern.

React component-tree inspection was available under `agent-browser` and has no Playwright CLI
equivalent as of this migration.

## SourceContract Output Format

For each page, produce a SourceContract with this structure:

```
SourceContract {
  page_url: string           -- the page URL this contract describes
  files: string[]            -- source files analyzed (relative paths)
  inputs: [
    {
      name: string           -- field name or label
      type: string           -- input type (text, number, email, etc.)
      min: number | null     -- minimum value (numeric inputs)
      max: number | null     -- maximum value (numeric inputs)
      minLength: number | null
      maxLength: number | null
      step: number | null
      pattern: string | null -- regex pattern constraint
      required: boolean
      validation: string     -- summary of schema validation if present
    }
  ]
  states: [
    {
      name: string           -- state variable name
      initialValue: any      -- initial value from useState
      affectsUI: boolean     -- true if name matches UI-affecting patterns
      description: string    -- brief note on what this state controls
    }
  ]
  conditionals: [
    {
      condition: string      -- the condition expression
      showsElement: string   -- what element is shown/hidden
      userTriggerable: boolean -- whether a user action can flip this condition
    }
  ]
  errorPaths: [
    {
      trigger: string        -- what user action triggers this error path
      handler: string        -- how the error is handled (state, toast, redirect)
      expectedBehavior: string -- what the user should see
    }
  ]
  apiCalls: [
    {
      endpoint: string       -- API endpoint path
      method: string         -- HTTP method
      loadingState: string | null   -- state variable for loading
      errorState: string | null     -- state variable for error
      successBehavior: string       -- what happens on success
      errorBehavior: string         -- what happens on error
    }
  ]
  toasts: [
    {
      trigger: string        -- what triggers the toast (success, error, action)
      message: string        -- the message pattern
    }
  ]
}
```

When a section has no findings, use an empty array `[]` — never omit the field.

## Gotchas

**Barrel exports:** Files like `index.ts` that re-export from other modules. When you encounter `export { ComponentName } from './ComponentName'` or `export * from './module'`, follow the re-export to the actual implementation file. Do not stop at the barrel.

**Server components (Next.js App Router):** Files in the `app/` directory without `"use client"` are server components. They cannot use `useState`, `useEffect`, or browser APIs. Their state lives in:
- Server actions (`"use server"` functions)
- Form actions (`action={serverAction}`)
- Search params and URL state
For server components, focus on form actions and data fetching patterns instead of client-side state hooks.

**Separate schema files:** Validation schemas (zod, yup) are often in dedicated files like `schemas/user.ts`, `lib/validations.ts`, or `validators/form.ts`. When a component imports from such paths, follow the import and extract the schema.

**Component libraries:** Libraries like shadcn/ui, Radix, MUI, Mantine, and Chakra wrap native inputs with custom components. The constraint props (`min`, `max`, `required`, etc.) may appear on the wrapper component, not on a raw `<input>`. Treat any component with input-like props the same as a native input.

**Import depth limit:** Stop following imports after 3 levels of depth from the page file. Level 0 is the page file itself, level 1 is its direct imports, level 2 is imports of imports, level 3 is the maximum. Beyond that, the signal-to-noise ratio drops and analysis time increases. Log when the depth limit is reached: "Source analysis: import depth limit (3) reached — using signals collected so far."

**CSS-in-JS and style files:** Skip `.css`, `.scss`, `.module.css`, and styled-component definitions. They don't contain behavioral signals.

**Test files:** Skip files matching `*.test.*`, `*.spec.*`, `__tests__/`, and `__mocks__/`. They don't represent production behavior.

## Graceful Degradation

Return an empty SourceContract (all arrays empty) when:
- The framework is not React/JSX/TSX (v1 limitation)
- No source files were identified for the page (empty `SOURCE_FILES` from Step 2)
- Source files exist but cannot be read (permissions, binary files, etc.)
- The import chain is too tangled to follow within the depth limit

In all cases, log the reason and continue with DOM-only story generation. Source analysis enhances stories but is never a hard gate — stories can always be generated from DOM exploration alone.
