# Findo Web — Design System (F1.4 / F1.6 redesign)

This document records the styling approach and component patterns established by the
routing/design-system redesign (F1.4) and the Documents/receipt-upload rework (F1.6), so
future features extend them instead of reinventing them. It supersedes the original F1.4
single-page/slate-indigo version of this document.

## Styling approach

- **Tailwind CSS v4**, added via the `@tailwindcss/vite` plugin (`web/vite.config.ts`).
  No `postcss.config.js` or `tailwind.config.js` — v4's Vite plugin handles scanning and
  build integration on its own.
- The only CSS file is `web/src/index.css`:
  ```css
  @import "tailwindcss";

  @theme {
    --font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    --font-serif: Georgia, "Iowan Old Style", "Times New Roman", serif;
  }

  body {
    background-color: var(--color-stone-50);
    color: var(--color-stone-900);
  }
  ```
  It's imported once, in `web/src/main.tsx`.
- All styling is done with Tailwind utility classes directly in JSX — no CSS modules, no
  styled-components, no separate stylesheets per component.
- `font-serif` (the Georgia/Iowan Old Style stack above) is used for every page `<h1>`, the
  "Findo" wordmark in the header, and modal titles — everything else (body copy, labels,
  table text, buttons) stays on the default `font-sans`. This serif/sans pairing is the one
  visual signature that distinguishes headings from content throughout the app.
- Light mode only. No dark mode, no theming system.

## Palette

Standard Tailwind `stone`/`emerald`/`rose`/`amber` scales — no custom hex colors, so any
future component can reuse them by name without checking a custom config. This replaced the
original F1.4 slate/indigo palette; `bg-slate-300` survives in exactly one place
(`StatusDot`'s `unknown` tone) as a leftover from before the repaint — new code should use
`stone` instead.

| Role | Tailwind token |
|---|---|
| Page background | `bg-stone-50` |
| Card / modal background | `bg-white` (modal body panel: `bg-stone-50`) |
| Card / input border | `border-stone-200` / `border-stone-300` |
| Primary text | `text-stone-900` |
| Secondary/muted text | `text-stone-500` / `text-stone-400` |
| **Accent** (primary buttons, active nav link, focus rings, "Detected"/success badges) | `emerald-700`/`emerald-800` (buttons, focus), `emerald-50`/`emerald-800` (badges, active nav) |
| Warning ("Needs Review" status, manual-entry account-type badge) | `amber-50`/`amber-800`/`amber-900` |
| Danger (debit amounts, destructive actions, error banners/toasts, "Unreadable" status) | `rose-600`/`rose-700`, `rose-50`/`rose-200` for banner backgrounds |
| Success (credit amounts, toasts) | `emerald-600`/`emerald-900` |

Debits are shown in rose, credits in emerald, same convention as before. `Badge` now exposes
six tones (`neutral`, `success`, `muted`, `accent`, `warning`, `danger`) — `accent` moved from
indigo to amber (used for account-type badges), `warning`/`danger` were added for the
Transactions "Needs Review" status and the Documents "Unreadable" status respectively.

## Layout

- **Routed, three-page app** using `react-router-dom` (`BrowserRouter` in `main.tsx`).
  `App.tsx` defines the routes: `/` redirects to `/accounts`, plus `/accounts`,
  `/transactions`, and `/documents`, each rendering its own page component from
  `web/src/pages/`. This replaced the original single-page (Accounts nesting Transactions)
  layout.
- **`AppShell`** (`components/layout/AppShell.tsx`) is the top-level frame: `Header` across
  the top, then a flex row of `Sidebar` + a `<main>` content area (`min-w-0 flex-1`) that
  renders the active route's page. `max-w-6xl`, centered, with responsive horizontal padding
  (`px-4 sm:px-6`) on both the header and content area.
- **`Sidebar`** (`components/layout/Sidebar.tsx`) is a fixed 48-unit-wide left nav, grouped
  into labeled sections: "Money" (Accounts / Transactions / Documents — real `NavLink`s,
  active state highlighted in emerald), then "Insights" and "Planning" — each a
  `GroupLabel` followed by several `FutureItem` rows (Dashboard, Budgets, Subscriptions,
  Price Tracking, Offers, Tax Planning, Loans & Debt, Reports), rendered greyed-out with a
  "Soon" badge. These aren't routes; they exist to show the intended information architecture
  ahead of the features that will fill them in.
- The Vite dev server proxy (`web/vite.config.ts`) forwards `/accounts`, `/transactions`, and
  `/documents` to the API — but only for non-navigation requests (no `Accept: text/html`).
  A hard refresh or typed URL on one of those paths is *not* proxied, so React Router's
  client-side routing can take over and render the matching page instead of hitting the API
  route of the same name. `/health` and `/chat` are proxied unconditionally since they have
  no client-side route to collide with.
- Tested by inspection down to a 768px-wide viewport: forms collapse from a 4/5-column grid
  (`lg:grid-cols-4` / `lg:grid-cols-5`) to 2-column (`sm:grid-cols-2`) to 1-column on narrower
  widths, and tables scroll horizontally within their own `overflow-x-auto` wrapper rather
  than force the page wider.

## Component patterns

Small, reusable presentational primitives live in `web/src/components/ui/`. Pages
(`AccountsPage.tsx`, `TransactionsPage.tsx`, `DocumentsPage.tsx`) and the shell
(`AppShell.tsx`, `Sidebar.tsx`, `Header.tsx`) compose them.

- **Buttons** — `<Button>` (`components/ui/Button.tsx`). Props: standard `<button>` attributes
  plus `variant?: 'primary' | 'secondary' | 'danger' | 'ghost'` (default `'primary'`).
  - `primary`: solid `emerald-800`, white text — the one primary action per form/modal (e.g.
    "Add Account", "Confirm & Save").
  - `secondary`: white with a stone border — neutral actions (e.g. "View Transactions",
    "Cancel", "Try Another File").
  - `danger`: white with a rose border/text — destructive-leaning actions (e.g. "Deactivate").
  - `ghost`: text-only, stone — low-emphasis actions (e.g. "Refresh" inside the health
    popover).
  All variants share a base of `rounded-md text-sm font-medium px-3 py-1.5` plus a focus ring
  (`focus-visible:outline-emerald-700`) and a disabled state (`disabled:opacity-50`).

- **Cards** — `<Card>` (`components/ui/Card.tsx`). Unchanged shape: a `div` with
  `rounded-lg border border-stone-200 bg-white shadow-sm`. Callers add their own
  padding/overflow via `className`.

- **Badges** — `<Badge>` (`components/ui/Badge.tsx`). A `span` with
  `rounded-full px-2 py-0.5 text-xs font-medium` plus a
  `tone?: 'neutral' | 'success' | 'muted' | 'accent' | 'warning' | 'danger'`
  background/text pairing (see Palette above for the tone → color mapping).

- **Status dot** — `<StatusDot>` (`components/ui/StatusDot.tsx`). A 2×2 filled circle,
  `tone: 'ok' | 'error' | 'unknown'` mapping to emerald/rose/slate (the `unknown` tone is the
  one surviving `slate` reference noted under Palette). Used in the header's health indicator.

- **Modal** — `<Modal>` (`components/ui/Modal.tsx`). New in this redesign. A fixed,
  centered overlay (`bg-stone-900/70` backdrop, click-to-dismiss) containing a
  `max-w-sm` panel with a `font-serif` title, optional subtitle, and a children slot for
  body content. Used for all four Documents-page dialogs (failed/clarify/confirm/manual —
  see below) and nothing else yet; if a future feature needs a confirmation dialog, reuse
  this rather than hand-rolling another overlay.

- **Toasts** — `<ToastProvider>` / `useToast()` (`components/ui/ToastProvider.tsx`). New in
  this redesign. Mounted once at the root (`main.tsx`, inside `BrowserRouter`, wrapping
  `App`). `useToast().showToast(message, tone?)` queues a single bottom-right toast
  (`tone: 'success' | 'error'`, default `'success'`) that auto-dismisses after 4s or on
  manual close. Only one toast is shown at a time — a new call replaces the current one.
  Currently only `DocumentsPage` calls it (upload/save success and network-error failures);
  any future async action with a user-visible outcome should use this instead of inline
  page text.

- **Error banner** — `<ErrorBanner>` (`components/ui/ErrorBanner.tsx`). New in this redesign.
  A rose-toned inline banner (`border-rose-200 bg-rose-50`) with a ⚠️ icon, for errors
  surfaced *inside* a modal (e.g. "No institution or account number found on this file",
  a failed confirm-save with "Your entries are kept — try again."). Distinct from the plain
  `text-rose-600` paragraph still used for inline form errors on the Accounts/Transactions
  pages (see "Known debt" below).

- **Empty state** — `<EmptyState>` (`components/ui/EmptyState.tsx`). New in this redesign.
  A single centered `<p>` (`p-5 text-sm text-stone-500`) for "no rows yet" table states.
  Used by Transactions and Documents; Accounts still inlines its own equivalent text instead
  of using this component (see "Known debt" below).

- **Filter bar** — `<FilterBar>` (`components/ui/FilterBar.tsx`). New in this redesign. A
  single-row control combining a from/to date range, an "All time" toggle button, and an
  account dropdown (`{ id, nickname }[]` in, `{ from, to, accountId, allTime }` out via
  `onChange`). Used identically by Transactions and Documents to filter their respective
  `GET /transactions` and `GET /documents` list calls.

- **Form inputs** — still no shared `<Input>`/`<Select>` component; each page defines its own
  local `inputClass` string constant applied to every `<input>`/`<select>` on that page. The
  three page-level copies have drifted slightly from each other (see "Known debt" below)
  rather than staying byte-identical, which is itself evidence this should be promoted to a
  real component the next time one of these pages changes.

- **Tables** — Accounts, Transactions, and the Documents history list each use a plain
  `<table>` with a `bg-stone-50` header row (`text-xs uppercase tracking-wide text-stone-500`),
  `border-stone-100` row dividers, and right-aligned numeric/action columns, wrapped in an
  `overflow-x-auto` div. This is still the pattern to reuse for future tabular data instead of
  introducing a table library.

## The Documents page: detect → clarify → confirm → manual-entry flow

`DocumentsPage.tsx` is the most stateful page in the app and is worth documenting on its own.
Its state is a single `Stage` union — `idle | processing | clarify | confirm | manual | failed`
— rather than a scatter of independent booleans, so only one modal can ever be open and each
stage carries exactly the data the next step needs:

1. **Upload** — the user picks a file (drag-and-drop styling only; no real drop-zone
   listener yet) and clicks Upload, which POSTs to `/documents/extract`. The button shows
   "Reading…" while `stage.name === 'processing'`.
2. **Branch on the extract result**:
   - Not readable → **`failed`** stage: a `Modal` with "Couldn't read this receipt", offering
     "Try Another File" (back to idle) or "Enter Manually" (→ `manual` stage, keeping the
     `file_ref` so the already-uploaded file is reused rather than re-uploaded).
   - Readable and an account was confidently detected (card-last-four match) → **`confirm`**
     stage directly, with `wasDetected: true` (shows a "Detected" badge next to the account
     field).
   - Readable but no confident account match → **`clarify`** stage: a `Modal` listing every
     account as a button; picking one moves to `confirm` with `wasDetected: false`.
3. **`confirm`** and **`manual`** both render the same `ConfirmForm` component (defined in
   the same file, below `DocumentsPage`) with different props: `confirm` pre-fills
   merchant/date/total/line-items from the extraction and shows line items read-only;
   `manual` starts blank, makes every field editable, and lets the user add/remove line items
   freely (`+ Add Item` / `✕` per row). Line items are reference-only in both cases — only the
   total field is what gets saved as the transaction amount, and the manual-entry help text
   says so explicitly.
4. **Submit** — `ConfirmForm` calls `submitConfirm`, which POSTs to `/documents/confirm` with
   `is_manual` set from `itemsEditable` (true only for the manual-entry path). On success: the
   stage resets to `idle`, a success toast fires, and the history table refetches. On failure:
   the error is shown *inside* the still-open modal via `ErrorBanner` ("Your entries are kept
   — try again.") rather than closing the modal and losing the user's edits.

The upload card and the filter bar / history table are mutually exclusive with the modals —
`modalOpen` hides the list view while any of `clarify`/`confirm`/`manual`/`failed` is active,
so the page never shows a stale table underneath an open dialog.

## What was intentionally not built

Per the original F1.4 brief's out-of-scope list, still true today: no component-library
dependency (no MUI/Chakra/shadcn), no dark mode, no dashboard-level aggregation. `api/public/
chat.html` (the chat shell) is visually untouched by this redesign — only the `/documents`
call it makes under the hood was adapted to the new two-phase extract/confirm API.

New instances of the same principle from the F1.6 work:
- No real drag-and-drop file handling on the Documents dropzone — it's styled to look like a
  drop target but only the "Choose File" input actually accepts a file.
- No client-side image compression/resizing before upload.
- No retry/backoff on the `/documents/extract` or `/documents/confirm` calls beyond the
  user manually clicking again — a failed network call surfaces a toast or in-modal error and
  stops.

## Judgment calls

- The original health check was a manual "Check API Health" button that dumped raw JSON into
  the page. It's now a small status indicator in the header: an `emerald`/`rose`/`slate` dot
  plus label, fetched once on mount, with a click-to-open popover showing the same
  per-subsystem detail the old JSON dump had, plus a "Refresh" button. No new behavior — just
  a different trigger (mount + optional manual refresh) and presentation.
- Accounts are rendered as a table rather than cards, for the same reason as the original
  F1.4 doc gave: a table keeps nickname/institution/type/status/actions scannable in one row,
  which fits the admin-dashboard feel the app is going for.
- Receipt upload does not ask the user to pick an account upfront (the pre-redesign flow
  required this). Instead the account is detected from the extracted card-last-four against
  the user's accounts, and the user is only asked when detection is ambiguous — this was the
  main point of the F1.6 rework and is why the Documents page's state machine exists at all.
- `is_manual` on a confirmed transaction is derived from `itemsEditable` on `ConfirmForm`
  (true only on the manual-entry fallback path) rather than being a separate flag threaded
  through — the same boolean already distinguishes "user can freely edit everything" from
  "this came from a successful parse," so reusing it avoids a second source of truth that
  could disagree with the first.

## Known debt

These are accepted, tracked gaps — not blockers — flagged here rather than fixed, per this
branch's design doc (vault) §9, which already tracks them as deferred follow-up work:

- **Duplicated helpers across pages.** `parseErrorMessage` (turn a failed `fetch` `Response`
  into a display string) is copy-pasted verbatim into `AccountsPage.tsx`, `TransactionsPage.tsx`,
  and `DocumentsPage.tsx`. `isoDateDaysAgo` (turn "N days ago" into an `YYYY-MM-DD` string,
  used to default filter ranges) is copy-pasted into `TransactionsPage.tsx` and
  `DocumentsPage.tsx`. Both should move to a shared `web/src/lib/` module.
- **Drifted, not just duplicated, `inputClass` strings.** Each page defines its own local
  `inputClass` constant for its `<input>`/`<select>` styling, and the three copies no longer
  agree: `AccountsPage`/`TransactionsPage` use `border-stone-300` with an `emerald-500` focus
  ring, while `DocumentsPage` uses `border-stone-200` with an `emerald-700` focus ring. This
  should become a real `<Input>`/`<Select>` component in `components/ui/` rather than a
  string constant repeated (and drifting further) per page.
- **`EmptyState` isn't used everywhere it could be.** `TransactionsPage` and `DocumentsPage`
  use the shared `<EmptyState>` component; `AccountsPage` still inlines its own equivalent
  `<p>` for the "no accounts yet" case.
- **Missing columns called for by the design doc.** A "Source" column on the Transactions
  table (to show whether a row came from manual entry, a receipt upload, or chat) and a
  "Date" column on the Documents history table (currently File / Source / Account / Status /
  Result, with no upload timestamp shown) were both specified in the design doc but fell
  through a gap between two of its sections during implementation. Deferred to a follow-up
  task rather than bundled into this branch.
- **Chat's unreadable-receipt uploads leave no history record.** Chat (`api/public/chat.html`)
  is out of scope for this redesign; when it hits `/documents/extract` and the receipt isn't
  readable, it tells the user in the chat log but never calls `/documents/confirm`, so —
  unlike the web Documents page's "Enter Manually" fallback — nothing is written to the
  `documents` table for that attempt. Confirmed by manual testing: the same illegible fixture
  that produces a `Documents` history row via the web manual-entry flow produces zero rows
  when uploaded through chat.
