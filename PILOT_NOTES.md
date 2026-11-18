# Pilot notes

Date: 2026-11-19. Branch `feat/mock-call-pilot`. This is a pilot, not a production system.
The approved design is [docs/designs/mock-call-pilot.md](docs/designs/mock-call-pilot.md).

## What was built

- **Candidate call page** (`/call?code=<ACCESS_CODE>`). The candidate goes through these
  screens in order:
  1. Name.
  2. Client summary, task instructions and the recording notice, with a required tick.
  3. Microphone permission.
  4. Start.
  5. The call: the prospect's lines appear as text, and the candidate presses Speak, then Done,
     for each turn. A countdown runs, and End Call asks for confirmation.
  6. Upload, then the recording link with a Copy button. A failed upload keeps the recording in
     the page and offers Retry upload. If the recording is over 25 MB, the page offers Download
     recording instead.
- **Scripted prospect.** The prospect can only show lines from `config/script.json`.
  - Each turn, Claude chooses one allowed line id, and the server looks up its text.
  - Anything else falls back to one fixed line: an invalid id, a timeout, a refusal, or an
    empty or failed transcript.
  - A property test drives 1,000 random calls, each with a picker that misbehaves 30% of the
    time, and checks that no text outside the script ever reaches the screen. An HTTP-level
    test does the same through `/turn`.
- **Recording page** (`/r/<id>`, no login). It shows:
  - candidate name, start time and end reason;
  - the full audio;
  - every turn, with the candidate's transcript and the prospect's line, and turns that could
    not be understood marked as such;
  - for objections, the approved caller reply, for the reviewer (decision D1).
- **Concurrency without a coordinator.** Each session is a set of files in one bucket, with
  write preconditions. A 20-session concurrent test and an in-process load test pass. Turn
  retries are safe: a replayed turn returns its stored result.
- **Modes.**
  - `MODE=demo` runs on placeholder content with a banner on every page.
  - `MODE=live` refuses to start and lists every missing value. It is checked by a boot test
    and by hand on 2026-11-19; today it lists 7 gap keys, 3 persona fields, and every
    unapproved line.
- **Deploy.** `deploy/deploy.sh <project> <region> <mode>` targets Google Cloud: Cloud Run, a
  private Cloud Storage bucket, Secret Manager, and a dedicated service account. It finishes by
  checking that the service is reachable without a login. `deploy/load-test.ts` runs S
  sessions against a deployed URL, with fakes or with real recorded clips.

## Verification done

| Check | Result |
|---|---|
| Unit and integration tests | 355 passed, 16 files (`pnpm test`) |
| Lint and types | `biome check .` clean; `tsc --noEmit` clean (TypeScript 7.0.2) |
| Boot under Node 26 type stripping | Passes (spawns `src/server/main.ts`) |
| Docker image | Builds; container answers `/healthz` and `/call` with 200 |
| Browser end to end (Chrome 156, synthetic microphone, fakes) | Full call to `booked` in 5 turns. The link opens in a new tab, audio is 42.25 s for a 42.34 s call, seeking and playback work, and the transcript has all 5 turns. |
| Mutation testing, Stryker | 87.59% (break threshold 70) |
| Mutation testing, testteeth vs `main` | 81.9%, PASS at `--fail-under 70` |

## Not verified yet

- **Real speech-to-text and Claude.** `pnpm dev:real` was not run: this machine has no `.env`
  with `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY`. The request shapes were checked against
  the Anthropic SDK reference only.
- **Deployed run.** `deploy.sh` was syntax-checked only. Nothing was deployed, and the
  10-session `load-test --real` run and latency targets (median under 3 s, 95th percentile
  under 5 s) are untested.
- **Firefox and Safari** (desktop and iOS): see the browser recording check below.
- **Surviving mutants were not killed.** testteeth left 175 mutants surviving and 90 not covered.
  The follow-up round that should have killed them was run as skein agents, and every agent
  stopped immediately with "This request would exceed your account's monthly spend limit". No
  test changed. The per-unit briefs are in `mutation-briefs/`, ready to rerun.
  - Justified as is: `src/server/main.ts` (71 not covered). It runs only in the boot test's
    child process, which mutation tools cannot measure.
  - Justified as is: `src/script/fixture.ts` (27). It is test data, not code under test.
  - Still owed: `src/server/routes.ts` (78 survived, 8 not covered), `src/storage/fs.ts`
    (22 and 4), `src/picker/prompt.ts` (12), `src/picker/claude.ts` (9), `src/server/views.ts`
    (7 and 2), `src/script/machine.ts` (5 and 4), and a few in config, stt, gcs and app.

## Blocked on open items

Each item below is a config value. `MODE=live` refuses to start while it is unset.

| Open item | Config key | Who |
|---|---|---|
| Interview flow, booking to finish (gap 1) | `gaps.interviewFlow` | Client, via Rhieza |
| Test window: dates, slot length, candidate count, booking vs in-window (gap 2) | `gaps.testWindow` | Client |
| How long recordings are kept (gap 3) | `gaps.retentionDays` (also sets the bucket deletion rule) | Rhino Squad or client |
| Which live test the role copies, with permission (gap 4) | `gaps.sourceLiveTest` | Team |
| Task instructions for candidates (gap 5) | `gaps.taskInstructions` | Client or team |
| Company name the caller says, Can-Am Telematics vs Can-Am Wireless (Q2) | `gaps.callerCompanyName` | Client |
| When the prospect hangs up, and how many objections (Q3) | `gaps.maxCallMinutes` plus script lines | Client or team |
| Prospect persona: first name, company, fleet size 10 or more (Q1) | `persona.*` in `config/script.json` | Rhieza |
| Every prospect line after Deadbolt 1, the six objection lines and replies, the fallback line (Q1) | `config/script.json`, each with `approved: true` | An author, then client approval |

Also open, not blocking live mode:

- **Abandoned calls (Q4).** Today a closed tab loses the audio.
- **One call per candidate (Q5).** The access code is shared, so a candidate could start a
  second call.

## Values needed before the first real candidate

1. Everything in the table above, filled in, and every script line marked approved.
2. A Google Cloud project with billing, and an account allowed to deploy
   (`docs/designs/mock-call-pilot.md` item 15 lists the roles; a project Owner has them all).
3. `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, and an `ACCESS_CODE` for candidates.
4. Ten short clips, each a different spoken marker word, for `load-test --real`.
5. A Firefox and Safari recording check (below).
6. The mutation kill round rerun, once the account spend limit allows it.

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

Not yet checked: Firefox and Safari (desktop and iOS). On each, record 60 seconds, confirm the
bytes per minute, and play each file in the other browsers. The sandbox in this build session
cannot drive those browsers.

## Changes made during the build

- **The server binds `0.0.0.0` explicitly.** With the default dual-stack bind, a kernel-picked
  test port collided with another process's `127.0.0.1` socket, and the boot test failed during
  the parallel verify run.
- **Stryker config for this toolchain.** The vitest runner plugin is loaded explicitly, because
  pnpm hides it from discovery. Stryker's tsconfig step is skipped, because TypeScript 7 removed
  an API it calls. `stryker.testteeth.json` adds `vitest.related: false` for testteeth.
- **The demo banner is yellow, not red.** The text matches the design.

The design doc was updated for each of these.
