# Findo Web — Design System (F1.4)

This document records the styling approach and component patterns established in F1.4, so
future features extend it instead of reinventing it.

## Styling approach

- **Tailwind CSS v4**, added via the `@tailwindcss/vite` plugin (`web/vite.config.ts`).
  No `postcss.config.js` or `tailwind.config.js` — v4's Vite plugin handles scanning and
  build integration on its own.
- The only CSS file is `web/src/index.css`:
  ```css
  @import "tailwindcss";

  @theme {
    --font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }

  body {
    background-color: var(--color-slate-50);
    color: var(--color-slate-900);
  }
  ```
  It's imported once, in `web/src/main.tsx`.
- All styling is done with Tailwind utility classes directly in JSX — no CSS modules, no
  styled-components, no separate stylesheets per component.
- Light mode only. No dark mode, no theming system, no routing library.

## Palette

Standard Tailwind slate/indigo/emerald/rose scales — no custom colors, so any future
component can reuse them by name without checking a custom config.

| Role | Tailwind token | Hex |
|---|---|---|
| Page background | `bg-slate-50` | `#f8fafc` |
| Card background | `bg-white` | `#ffffff` |
| Card border | `border-slate-200` | `#e2e8f0` |
| Primary text | `text-slate-900` | `#0f172a` |
| Secondary/muted text | `text-slate-500` / `text-slate-600` | `#64748b` / `#475569` |
| **Accent** (primary actions, links, focus ring, "type" badges) | `indigo-600` (buttons), `indigo-50`/`indigo-700` (badges) | `#4f46e5` |
| Success / credit amounts / active status | `emerald-600` (text), `emerald-50`/`emerald-700` (badges) | `#059669` |
| Danger / debit amounts / destructive actions | `rose-600` | `#e11d48` |

Debits are shown in rose, credits in emerald, per the brief. Account "type" badges use the
indigo accent; active/inactive status uses emerald/slate ("muted") badges so status and
type are visually distinct at a glance.

## Layout

- A single app shell: a sticky-feeling (not actually `position: sticky`, just top-of-page)
  header (`Header.tsx`) with the Findo wordmark on the left and a live API-health indicator
  on the right, followed by a `<main>` content area capped at `max-w-6xl`, centered, with
  responsive horizontal padding (`px-4 sm:px-6`).
- Content within `<main>` is a single vertical flow of sections (currently just Accounts,
  which nests Transactions) — no sidebar, no grid dashboard. This matches the brief: one
  page, not a multi-page app.
- Tested by inspection down to a 768px-wide viewport: forms collapse from a 4-column grid
  (`lg:grid-cols-4`) to 2-column (`sm:grid-cols-2`) to 1-column on narrower widths, and
  tables scroll within their card rather than force the page wider.

## Component patterns

Small, reusable presentational primitives live in `web/src/components/ui/`. Feature panels
(`AccountsPanel.tsx`, `TransactionsPanel.tsx`) and the app shell (`Header.tsx`) compose them.

- **Buttons** — `<Button>` (`components/ui/Button.tsx`). Props: standard `<button>` attributes
  plus `variant?: 'primary' | 'secondary' | 'danger' | 'ghost'` (default `'primary'`).
  - `primary`: solid indigo, white text — the one primary action per form (e.g. "Add Account").
  - `secondary`: white with a slate border — neutral actions (e.g. "View Transactions").
  - `danger`: white with a rose border/text — destructive-leaning actions (e.g. "Deactivate").
  - `ghost`: text-only, slate — low-emphasis actions (e.g. "Refresh" inside the health popover).
  All variants share a base of `rounded-md text-sm font-medium px-3 py-1.5` plus a focus ring
  (`focus-visible:outline-indigo-500`) and a disabled state (`disabled:opacity-50`).

- **Cards** — `<Card>` (`components/ui/Card.tsx`). A `div` with
  `rounded-lg border border-slate-200 bg-white shadow-sm`. Used as the container for the
  add-account form and the accounts table. Callers add their own padding/overflow via
  `className` (e.g. `p-4 sm:p-5` for a form card, `overflow-hidden` for a table card).

- **Badges** — `<Badge>` (`components/ui/Badge.tsx`). A `span` with
  `rounded-full px-2 py-0.5 text-xs font-medium` plus a `tone?: 'neutral' | 'success' | 'muted' | 'accent'`
  background/text pairing. Used for account type (`accent`), active/inactive status
  (`success`/`muted`), and transaction type (`success` for credit, `muted` for debit).

- **Status dot** — `<StatusDot>` (`components/ui/StatusDot.tsx`). A 2×2 filled circle,
  `tone: 'ok' | 'error' | 'unknown'` mapping to emerald/rose/slate. Used in the header's
  health indicator and in the expanded subsystem breakdown.

- **Form inputs** — no shared `<Input>` component yet (one page, not enough repetition to
  justify it); instead a single `inputClass` string constant is defined at the top of each
  panel file (`AccountsPanel.tsx`, `TransactionsPanel.tsx`) and applied to every
  `<input>`/`<select>`:
  `w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm ... focus:ring-1 focus:ring-indigo-500`.
  If a third form appears in a future feature, promote this to a real `<Input>`/`<Select>`
  component in `components/ui/`.

- **Tables** — both the accounts list and the transactions list use a plain `<table>` with a
  `bg-slate-50` header row (`text-xs uppercase tracking-wide text-slate-500`), `border-slate-100`
  row dividers, and right-aligned numeric/action columns. This is the pattern to reuse for any
  future tabular data instead of introducing a table library.

## What was intentionally not built

Per the brief's out-of-scope list: no new component-library dependency (no MUI/Chakra/shadcn),
no dark mode, no routing, no dashboard-level aggregation, and no changes to `api/` or to
`api/public/chat.html`.

## Judgment calls

- The original health check was a manual "Check API Health" button that dumped raw JSON into
  the page. The brief explicitly asks for a small status indicator in the header instead. To
  keep the same underlying behavior (an explicit `/health` call, same error handling) while
  fitting the "indicator" pattern, the header now fetches `/health` once on mount and shows a
  colored dot + label; clicking it opens a small popover with the same per-subsystem detail
  the old JSON dump had, plus a "Refresh" button that re-runs the same `/health` fetch. No new
  behavior was added — just a different trigger (mount + optional manual refresh) and a
  different presentation.
- Accounts are rendered as a table rather than cards. The brief allows either ("styled cards
  or a table"); a table reads as more "admin dashboard" and keeps nickname/institution/type/
  status/actions scannable in one row, which is the Stripe-dashboard-like feel the brief asks
  for.
