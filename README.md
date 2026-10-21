# TubeToggles

Chrome extension that keeps your preferred YouTube player settings applied on every video.

[Chrome Web Store](https://chromewebstore.google.com/detail/tubetoggles/kganjailpdkhfgaflnnjpjjldplnalcc)

## Project layout

| Path | What it is |
| --- | --- |
| `src/` | The extension itself: everything that ships to the store |
| `scripts/build.mjs` | Packages `src/` into `dist/TubeToggles-<version>.zip` |
| `tests/helpers/` | Launches Chromium with the extension loaded, for automated checks |
| `tests/research/` | Probes that record what YouTube's player exposes; re-run when YouTube changes |

## Development

Load the extension: open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick the `src/` folder. Reload it there after each change.

```sh
npm install                      # Playwright, for tests and probes
npx playwright install chromium  # the browser Playwright drives
npm run build                    # creates dist/TubeToggles-<version>.zip for upload
```

Research probes (they run without the extension, in a throwaway profile):

```sh
node tests/research/probe-player.mjs [videoId] [hl] [browserLocale] [waitMs]
node tests/research/probe-actions.mjs
```
