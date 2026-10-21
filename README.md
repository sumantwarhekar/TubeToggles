# TubeToggles

Chrome extension that keeps your preferred YouTube player settings applied on every video.

[Chrome Web Store](https://chromewebstore.google.com/detail/tubetoggles/kganjailpdkhfgaflnnjpjjldplnalcc)

## Project layout

| Path | What it is |
| --- | --- |
| `src/` | The extension itself: everything that ships to the store |
| `src/settings.js` | Every setting, its values and defaults, defined once |
| `src/page.js` | The engine: runs in YouTube's page and applies settings through the player |
| `src/content.js` | Bridge between extension storage and the engine |
| `scripts/build.mjs` | Packages `src/` into `dist/TubeToggles-<version>.zip` |
| `tests/unit/`, `tests/e2e/` | Unit tests, and end-to-end tests on live YouTube (see [TESTING.md](TESTING.md)) |
| `tests/helpers/` | Launches Chromium with the extension loaded, for automated checks |
| `tests/research/` | Probes that record what YouTube's player exposes; re-run when YouTube changes |

## Development

Load the extension: open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick the `src/` folder. Reload it there after each change.

```sh
npm install                      # Playwright, for tests and probes
npx playwright install chromium  # the browser Playwright drives
npm test                         # unit + end-to-end tests (needs a network connection)
npm run build                    # creates dist/TubeToggles-<version>.zip for upload
```

Research probes (they run without the extension, in a throwaway profile):

```sh
node tests/research/probe-player.mjs [videoId] [hl] [browserLocale] [waitMs]
node tests/research/probe-actions.mjs
```
