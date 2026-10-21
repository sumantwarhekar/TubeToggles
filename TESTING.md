# Testing TubeToggles

## Automated

```sh
npm test            # everything: unit tests + end-to-end tests on live YouTube (about 3 minutes)
npm run test:unit   # settings logic only, no browser
```

The end-to-end tests load `src/` into Playwright's Chromium and check, on real videos:

- stable volume, voice boost, quality and theater mode are applied, and the menu shows it
- an unavailable quality falls back to the next lower one; Auto hands quality back to YouTube
- ambient mode and annotations are set through the invisible menu, which ends closed
- an open menu is never closed by the extension
- the user's own changes (menu rows, quality, audio track, the T key) are saved and not reverted
- with voice boost on, stable volume is left alone (YouTube greys it out)
- the original audio track replaces YouTube's dub, in a Hindi browser
- annotations are found in a German browser, where the label is translated
- the master switch stops all changes; the popup lists every setting, always with a value, and saves choices

## Manual, before each release

Load `src/` unpacked in your own Chrome (`chrome://extensions` → Developer mode → Load unpacked) and go through this list. It covers what the automated tests can't: your account, your real browsing, and how it feels.

1. **Upgrade keeps your settings.** With the store version installed and set up, load the new version over it. Open the popup: your previous choices are still there.
2. **Nothing flashes.** Open a few videos. The settings menu never visibly opens, and the control bar doesn't pop up on its own.
3. **Settings apply.** Set each of the 7 settings in the popup and open a video; check the gear menu matches. Ambient mode only shows when YouTube's layout leaves room for it (often only in theater mode).
4. **Your changes stick.** Change a setting in YouTube's gear menu (or press T for theater). A short "TubeToggles saved" notice appears, the popup shows the new value, and the next video uses it.
5. **No fighting.** Open the gear menu and browse it for a while (Quality, Playback speed): it stays open and nothing changes underneath you.
6. **Several tabs.** With two YouTube tabs open, change a setting in the popup: both tabs follow.
7. **Other sites.** Open the popup on a non-YouTube tab and change a setting: no errors, and it applies once you open YouTube.
8. **Master switch.** Turn TubeToggles off: settings in YouTube stay as you leave them. Turn it back on: your settings return.
9. **Original audio.** On a video with dubbed audio tracks (many MrBeast videos), the original language plays.
10. **Ads.** Watch a video with an ad: nothing happens during the ad; settings apply once the video starts.
