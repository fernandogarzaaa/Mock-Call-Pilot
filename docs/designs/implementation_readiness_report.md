# Stage 9: Implementation Readiness report

Reviewers: egm-implementation-readiness and egm-codebase-details (implementation-readiness
standard), egm-style. Fresh contexts. Target: the Detailed Implementation Plan as of the
835-line version. Totals: 9 Blocker, 24 Major, 29 Nit (overlaps merged below).

## Blocker, all fixed in the plan rewrite

| # | Finding | Raised by | Fix applied |
|---|---|---|---|
| I1 | `turnStep` signature and fallback ownership contradict each other (STT errors can't reach it; the route calls `applyFallback`) | readiness B1 | Literal async signature with a `TurnInput` union; `turnStep` is the only caller of `applyFallback` and `applyLine` |
| I2 | Shared types are names only; five parallel units import them | readiness B2 | `src/types/index.ts` is written out as literal TypeScript, including `CallTurn` (one record per candidate turn, 0-based index), `FallbackCause`, `VENDOR_CAUSES`, `ResolvedConfig` |
| I3 | No seed stage graph; identical placeholder text makes the G1 test trivially true and FakePicker ambiguous | readiness B3 | Seed graph table, unique placeholder texts, `fixture.ts` for tests, exact FakePicker rule |
| I4 | `/end` can't express `limit_reached`; end-reason authority undefined | readiness B4 | The server decides; the client may send only `candidate_ended` or `limit_reached`; a repeated `/end` doesn't rewrite |
| I5 | Web check proves nothing; nothing serves `public/` | readiness B5, codebase B3 | `/static/*` route, stub files in scaffold, `call-core.js` pure module with its own vitest tests |
| I6 | Deploy check doesn't test deploy.sh or load-test.ts | readiness B6 | `load-check.ts` pure functions + tests, an in-process load test with S=3; `bash -n` and `docker build` done by the main thread |
| I7 | `corepack enable` fails on Node 26 images | codebase B1 (confirmed locally: Node 26.13.0 has no corepack) | `npm install -g pnpm@12.15.0` + `packageManager` pin |
| I8 | Deploy lacks `--allow-unauthenticated`; links would 403 | codebase B2 | Flag added; org-policy failure is detected and reported |
| I9 | (merged into I5) | | |

## Major, fixed

- tsconfig settings that match Node type stripping (`erasableSyntaxOnly`,
  `verbatimModuleSyntax`, `allowImportingTsExtensions`, `nodenext`), plus a boot test that starts
  `main.ts` for real.
- devDependencies listed, including fast-check; biome and Stryker configs spelled out.
- Persona/token substitution only in `loadConfig`, with demo values for nulls.
- fs storage serves audio through HMAC-signed `/files/*`; `STORAGE_DIR`; MIME → extension map;
  unknown MIME → 422.
- `VENDOR_CAUSES` defined; load test fixed at 4 turns, `--code`, reads
  `/r/<id>/transcript.json`.
- FakeTranscriber decodes UTF-8 bytes; works in tests, load runs and `pnpm dev`.
- Session created at Start; `clientMs` from the page; screen after 3 failed retries defined.
- Concurrent duplicate turns: re-read on `PreconditionFailed`, return the stored result or 409.
- Tests added for D1, 422, 409 gap, a repeated `/end`, `limit_reached`, "Call in progress",
  audio 302, the `ConfigError` exit, CUJ 5 on the real `config/`.
- Deploy: named service account and roles, APIs enabled, bucket name, secrets from env vars,
  demo-mode retention warning, no `PUBLIC_URL` (the request origin is used).
- GCS: metadata-then-download, `resumable: false`, 412 mapping, generation as a string.
- MediaRecorder: MIME preference list (MP4 first), WebM duration risk with a conditional
  `fix-webm-duration`, cross-browser playback check, 30 MB guard, Hono body limits.
- Scribe endpoint, header, fields, timeout; picker `maxRetries: 0`, fallback causes named.
- Chrome fake-audio file for the real-AI browser check; `--env-file-if-exists=.env`.
- Measurable pass conditions: 360 px layout, latency decided by load-test percentiles, browser
  steps with explicit pass criteria.

## Not adopted

- Removing the model-role column: kept, because the owner's build rules require it in the Work
  units table. A sentence now explains that every row uses the same role.
- "Drafted with EGM" footer: kept; it is the owner's workflow marker.
