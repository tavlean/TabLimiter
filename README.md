# Tab Limiter

A cross-browser extension to limit the number of open tabs, globally and per-window. Supports Chrome and Firefox from one shared source layout.

## Features

- Limit total open tabs in the browser
- Limit open tabs per window
- Limit tabs per domain, with allow/block/custom exceptions
- Group-aware limits for Chrome tab groups, including include/exclude from global counting
- Close strategy options: newest, oldest, least recently used
- Soft-limit warnings with separate warning/close thresholds
- Scheduled limit profiles by day/time
- Session snapshot, restore, rename, delete
- One-click duplicate tab detection and cleanup
- Per-domain custom limit overrides directly from popup
- Export/import full settings JSON
- Keyboard shortcut status notifications (`Alt+T`)
- Show number of open tabs and remaining capacity
- Accessible progress bars with warning markers and fraction labels
- Option to count or ignore pinned tabs
- Optional badge modes (remaining, open, fraction) with severity color coding
- Option to open excess tabs in another window when per-window limits are reached

## Installation

### Chrome

#### Development (unpacked)

1. Clone this repository
2. Run `npm run dev:chrome`
3. Open `chrome://extensions/`
4. Enable Developer mode
5. Click Load unpacked and select `dist/chrome-dev`

#### Production build

1. Run `npm run build:chrome`
2. Use `dist/tablimiter-chrome.zip`

### Firefox

#### Development (temporary add-on)

1. Clone this repository
2. Run `npm run dev:firefox`
3. Open `about:debugging#/runtime/this-firefox`
4. Click Load Temporary Add-on
5. Select `dist/firefox-dev/manifest.json`

#### Production build

1. Run `npm run build:firefox`
2. Use `dist/tablimiter-firefox.zip`

## Development

```bash
npm install

# Prepare dev folders
npm run dev
npm run dev:chrome
npm run dev:firefox

# Produce store zip files
npm run build
npm run build:chrome
npm run build:firefox

# Remove generated artifacts
npm run clean
```

## Project Structure

```
TabLimiter/
├── README.md
├── LICENSE
├── package.json
├── .gitignore
├── docs/
├── assets/              # Store/marketing assets
├── shared-assets/       # Shared extension icons/assets (source)
├── src/
│   ├── common/          # Shared extension runtime files
│   │   ├── background.js
│   │   ├── options.html
│   │   ├── options.css
│   │   └── options.js
│   ├── chrome/          # Chrome shell
│   │   └── manifest.json
│   └── firefox/         # Firefox shell
│       └── manifest.json
└── dist/                # Generated dev/build artifacts
```

## Credits

Originally created by Matthias Vogt (2016). Modernized, redesigned, developed and maintained by Tavlean now.

## License

MIT
