# Stage 5: Initial Zoom Out report

Reviewer: egm-zoom-out (fresh context). Target: mock-call-pilot.md, lines 1-581, plus
source_brief.md, concepts_brief.md, client_and_role_sources.md. Result: 0 Blocker, 5 Major,
7 Nit.

## Major

- **M1. Demo mode contradicts itself (lines 220-221, 275-277, 540-541, 434-435).** Demo mode is
  where the owner runs a test candidate, but demo also uses the fake picker. So the owner never
  sees the real AI stay on script, and CUJ 2 (objections) can't happen in demo. `STT=fake` and
  `PICKER=fake` appear only in the load test. Fix: demo = placeholder content + banner; fakes
  are a separate explicit switch listed in `.env.example`.
- **M2. 5-second chunked upload serves an undecided need (Q5).** Chunking only limits loss when
  the tab dies, but abandoned calls produce no link. It costs a cross-browser prototype,
  `compose`, 32-object batching, a route, and client ordering and retry. Fix: one upload at End;
  add chunking only if Q5 needs it.
- **M3. Concurrency proof runs only on fakes; "crossed audio" isn't checked on audio.** Real
  STT and picker under 10 concurrent sessions are never tested. The load test checks names, not
  audio or transcript content. Fix: deployed load check with real services, N≥10, asserting a
  per-session marker in transcript or audio.
- **M4. Retention has two sources of truth (lines 267, 280-281, 370-371 vs 534-537).** Live
  mode checks `retentionDays` in pilot.json; deploy.sh uses env `RETENTION_DAYS`. Live can pass
  with no deletion rule. Fix: deploy.sh reads pilot.json and refuses a live deploy without it.
- **M5. `callerReply` sits on the public, candidate-held page (D1; lines 253-254, 421).** Shared
  links become an answer key for later candidates. Fix: keep replies off the public page, or
  record that the owner accepts the exposure.

## Nit

- N1. SDK and flag detail (`output_config.format`, model id, Cloud Run flags, caching claim)
  belongs in item 8, not the Technical Plan.
- N2. Per-turn audio (`turns/*.webm`) is stored but never read.
- N3. `scripts/deploy.sh` (line 285) vs `deploy/deploy.sh` (534-536, 556).
- N4. `testteeth run --base main`, but the repo starts on `feat/mock-call-pilot` with no `main`.
- N5. Checks use `bash -n` and `pnpm test/lint/typecheck`, which the backend allow-list doesn't
  allow.
- N6. skein, skein.md, testteeth, genesis, "in-app browser", "main thread" are undefined for a
  fresh reader.
- N7. Mutation gate at 70 plus testteeth is heavy for a pilot; consider advisory.

## Not raised

Claims about forced tool choice and model suitability can't be verified from supplied files.
No vendor alternatives proposed.
