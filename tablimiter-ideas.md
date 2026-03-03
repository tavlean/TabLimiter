# TabLimiter — Feature Ideas

## Execution Status (2026-03-01)

- Implemented all **New Features (1-10)** in code (`background.js`, `options.js`, `options.html`, `options.css`, manifests).
- Implemented all **UX Improvements** listed in this file.
- Notes:
  - `tabGroups` support and permission are enabled in Chrome manifest.
  - Firefox build includes all non-`tabGroups` functionality; group card auto-disables when `tabGroups` API is unavailable.

> Current permissions: `storage`, `notifications`, `tabs`

---

## New Features

### 1. Tab Groups Awareness

Set limits per Chrome tab group, show group-level usage in the popup, and optionally exclude/include specific groups from counting toward the global limit. Users who organize by project (e.g., "Work", "Research", "Personal") get granular control instead of one flat number.

**Permissions:** `tabGroups` (new)
**UX:** Add a "Groups" card in the popup alongside Window/Domain, showing each group's name, color dot, tab count, and a per-group limit stepper. Groups without a custom limit inherit the global per-window limit.

### 2. Allowlist / Blocklist Domains

Let users define domains that are always allowed (never closed even when over limit) or always blocked (auto-closed immediately). Pairs with the existing per-domain limit — e.g., unlimited tabs for `docs.google.com` but cap `reddit.com` at 2.

**Permissions:** No new permissions needed.
**UX:** Add an "Exceptions" section in settings with two lists. Each entry has a domain input and a behavior dropdown (Allow / Block / Custom limit). Use the same stepper component for custom limits.

### 3. Close Strategy: Oldest / Least Recently Used

Currently the newly created tab gets closed when the limit is exceeded. Offer a strategy setting: close newest (current), close oldest, or close least recently active. Makes the limiter feel less punishing.

**Permissions:** No new permissions needed. (Tab last-accessed time is available from `chrome.tabs.query` results.)
**UX:** Add a "When limit is reached" dropdown in settings with three options. Show a brief tooltip explaining each strategy.

### 4. Scheduled / Time-Based Limits

Different limits for different times of day or days of the week. Stricter during work hours (Mon–Fri 9–5: max 15), relaxed on weekends.

**Permissions:** `alarms` (new) — for reliable schedule checking across service worker restarts.
**UX:** Add a "Schedules" section in settings. Each schedule has a name, days-of-week checkboxes, start/end time pickers, and limit overrides for window/total/domain. Active schedule shown as a subtle label in the popup header.

### 5. Session Snapshot & Restore

A "Save Session" button that stores all open tabs (URLs + titles) to storage. Users can restore saved sessions later. Useful when at the tab limit and needing to context-switch.

**Permissions:** No new permissions needed. (`storage` already granted, tab URLs available via `tabs`.)
**UX:** Add a "Sessions" view accessible from the popup header. List saved sessions with name, tab count, and date. Swipe-to-delete or long-press to rename. "Restore" opens all tabs from the session. Limit to ~10 saved sessions to stay within `storage.sync` quota, or use `storage.local` for more.

### 6. Quick-Close Duplicates

One-click action to find and close duplicate tabs (same URL open multiple times). Show count of duplicates before closing.

**Permissions:** No new permissions needed.
**UX:** Add a small "Duplicates" badge/button in the popup header area. Clicking it shows a confirmation: "Found 4 duplicate tabs. Close them?" with a list of which URLs are duplicated.

### 7. Per-Domain Limit Overrides

The current domain limit is a single global number. Allow custom limits for specific domains — e.g., `github.com` gets 8, `youtube.com` gets 3, everything else uses the default.

**Permissions:** No new permissions needed.
**UX:** In the Domain card, add a small "customize" icon next to each domain in the top domains list. Tapping it opens an inline stepper to set a custom limit for that domain. Domains with custom limits show a small indicator. Also accessible from settings as a full list.

### 8. Keyboard Shortcut to View Status

Register a Chrome command (keyboard shortcut) that opens the popup or shows a notification with current tab counts and remaining capacity.

**Permissions:** No new permissions needed. (Uses `commands` manifest key, not a permission.)
**UX:** Default shortcut like `Alt+T`. Shows a brief system notification with: "Window: 12/20 | Total: 34/50 | 16 left". Configurable via `chrome://extensions/shortcuts`.

### 9. "Soft Limit" Warning Mode

Instead of hard-closing tabs, offer a soft limit that shows a warning notification at N tabs and only hard-closes at a higher threshold. Warn at 40, close at 50.

**Permissions:** No new permissions needed. (`notifications` already granted.)
**UX:** Add two thresholds per limit type: "Warn at" and "Close at". The progress bar shows a subtle marker at the warning threshold. When the warning fires, the notification includes a "Got it" action button.

### 10. Export / Import Settings

Export full configuration (limits, toggles, domain overrides, schedules) as JSON. Import on another machine or browser.

**Permissions:** No new permissions needed.
**UX:** Two buttons in settings: "Export" (downloads a `.json` file) and "Import" (file picker). Show a confirmation diff before applying imported settings. Use `chrome.downloads` API or a Blob URL for the export — `downloads` permission would be needed only if using the downloads API; alternatively, use a data URI + `<a download>` trick which needs no extra permission.

---

## UX Improvements

### Progress Bar Accessibility

The progress bars rely solely on color. Add `role="progressbar"`, `aria-valuenow`, `aria-valuemax`, and `aria-label` attributes. Consider a small text percentage or fraction label (e.g., "12/20") visible to screen readers and optionally to sighted users.

### Badge Counter Options

The badge shows minimum remaining. Add options to show: open count, remaining count, or a fraction like "12/20". Color-code the badge background to match the progress bar color thresholds (purple → red).

### Domain List Interactions

The top domains list is read-only. Add:

- Click a domain → close all tabs for that domain (with confirmation)
- Small "×" button for quick bulk-close
- Mini progress bar next to each domain showing usage vs. per-domain limit

### Smarter "Balance Tabs" Window Selection

When moving excess tabs to another window, also consider which window has related content (same domain tabs) so the moved tab lands in a contextually relevant window, not just the emptiest one.

### Notification Message Enhancements

Add more template placeholders: `{currentCount}`, `{domain}`, `{windowCount}`, `{strategy}`. Also add an option to choose between system notifications and a less intrusive in-page toast overlay.

### Dark/Light Mode Support

The popup is dark-mode only. Add `prefers-color-scheme` media queries for a light mode variant, or at minimum respect the OS setting. The CSS already uses custom properties, so this is mostly defining a light-mode variable set.

### Popup Width on Different Platforms

The popup has `min-width: 720px` which is very wide for a browser popup. On smaller screens or when the browser window is narrow, this can cause overflow. Consider a responsive layout that works at ~400px width with a single-column card layout.

---

## Monetisation Ideas

### TabLimiter Pro — Workspace Profiles

Multiple named profiles (e.g., "Work", "Research", "Casual") each with their own complete set of limits, domain rules, and schedules. One-click profile switching from the popup. Sync profiles across devices. This is genuinely complex state management that's hard to vibe-code correctly — profile conflicts, migration, sync quota management, and a polished profile-switching UX with smooth transitions.

### TabLimiter Pro — Smart Tab Suspender Integration

Automatically suspend (unload from memory) tabs that are over the soft limit instead of closing them. Tabs stay visible in the tab bar but consume zero memory/CPU. When clicked, they reload. This requires careful lifecycle management — tracking suspended state, handling tab updates, preserving scroll position, and managing the suspend/resume cycle reliably. Combined with the existing limit system, this becomes a full tab management suite that's significantly more valuable than either feature alone.

### TabLimiter Pro — Analytics Dashboard

A full-page dashboard (options page or new tab override) showing:

- Tab usage over time (daily/weekly/monthly charts)
- Most-visited domains with time-on-site estimates
- Peak tab count trends and when limits were hit
- "Tab hygiene score" based on duplicate count, stale tabs, and limit adherence

This requires persistent data collection, chart rendering, data aggregation, and meaningful insight generation. The analytics pipeline alone (collecting events, storing efficiently within extension storage limits, aggregating on read) is non-trivial. Needs `history` permission for richer data.

### TabLimiter Pro — Team / Managed Mode

For IT admins or team leads: deploy TabLimiter with enforced limits via Chrome Enterprise policy or a shared configuration URL. Admins set limits, users can't override them. Useful for schools, corporate environments, or shared machines. Requires a configuration server or integration with Chrome's managed storage API (`storage.managed`). The policy schema definition, admin UI, and enforcement logic make this genuinely hard to replicate.

### TabLimiter Pro — Cross-Browser Sync with Cloud Backup

Sync tab sessions, settings, and profiles across Chrome and Firefox (and potentially Edge/Brave) via a lightweight cloud service. Not just `storage.sync` (which is per-browser-vendor) but actual cross-browser sync. Requires a backend service, authentication, conflict resolution, and encryption. This is a real product moat — no amount of vibe-coding produces a reliable cross-browser sync service.
