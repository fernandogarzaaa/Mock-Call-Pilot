# Pilot notes

Status: in progress. The main thread finishes this file at the end of the build.

## What was built

(filled at the end of the build)

## Blocked on open items

(filled at the end of the build)

## Values needed before the first real candidate

(filled at the end of the build)

## Browser recording check (scaffold item 7)

Run on 2026-11-19 in the in-app browser (Chromium, Chrome 156 on macOS), using a synthetic
220 Hz oscillator stream instead of a microphone.

| Check | Result |
|---|---|
| `isTypeSupported` | `audio/mp4` yes, `audio/webm;codecs=opus` yes, `audio/ogg;codecs=opus` no |
| Type picked by the preference list | `audio/mp4;codecs=opus` |
| Bytes per minute at `audioBitsPerSecond: 32000` | about 184 KB (MP4) and 180 KB (WebM). The hint is honoured. |
| Longest call under the 25 MB upload limit | about 2 hours at that rate |
| Two recorders on one stream at once | Works |
| Duration readable in `<audio>` | Yes for both MP4 and WebM |

Decision: Chrome records MP4, so `fix-webm-duration` is not vendored.

Not yet checked, and needed before the first real candidate: Firefox and Safari (desktop and
iOS). Record 60 seconds on each, confirm the bytes per minute, and play each file in the other
browsers. The sandbox in this build session cannot drive those browsers.

## Surviving mutants

(filled after the mutation run)
