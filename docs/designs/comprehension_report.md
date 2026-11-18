# Stage 6: Comprehension report

Reviewer: egm-comprehension (fresh context), Re-Implementation Standard. Target: mock-call-pilot.md
(FeatureRange 1-394, DetailedRange 395-581) plus linked files. Verdict: does not pass yet.
2 Blocker, 12 Major, 12 Nit.

## Blocker

- **B1. Stage machine undefined after objections and fallback, and for persona fill-in.**
  Objections have no `nextStage`. `fallbackLineId` has no stage and isn't in the allowed set,
  but `applyLine` throws on ids that aren't allowed. Unclear whether fallback or empty turns
  count toward `maxTurns`. Persona fields never reach the screen; no placeholder syntax.
- **B2. End reasons incomplete.** Only `booked` and `prospect_ended` exist. Pressing End Call
  has no reason. The type of `endsCall` and its mapping are ambiguous. Hitting a limit looks
  the same as a hang-up.

## Major

- M1. skein, "main thread", "in-app browser", model-role column undefined.
- M2. `testteeth --base main` with no `main`; testteeth/genesis undefined; where are
  surviving mutants justified?
- M3. Env and adapter selection contradict (demo = fakes?); `STT`/`PICKER`/Scribe model var
  missing from `.env.example`.
- M4. pilot.json value types undefined; the demo placeholder string breaks numeric keys and
  `accessCode`.
- M5. HTTP contracts: turn/chunk bodies, session response shape, status codes for a failed
  precondition and a TranscribeError, which route returns 403, name validation, `/r/` before
  end.
- M6. Object keys hard-code `.webm` despite Safari MP4; padding differs; chunk gaps and failed
  retries are unhandled.
- M7. Retention: `retentionDays` vs `RETENTION_DAYS`.
- M8. Deploy command omits the NFR flags, secrets, env vars, and the load-test mode.
- M9. On-script property test sits in `src/script` with random strings; the server display path
  (lookup + fallback) isn't proven end to end.
- M10. Picker details: fallbacks beta unnamed, user-message layout missing, persona in a
  "fixed" prompt conflicts with config, caching mechanism unnamed.
- M11. The brief's required short note has no build item.
- M12. Candidate screen order inconsistent (name entry missing from item 12).

## Nit

N1 Deadbolt, Paid Test, Rhieza defined only by link. N2 Open Questions numbering Q3, Q6, Q4, Q5.
N3 "real-candidate mode" vs `MODE=live`. N4 banner text differs. N5 seed list omits "This is a
bad time." N6 the point where `booked` fires is vague. N7 `atMs` origin and Scribe timeout
unspecified. N8 compose intermediate objects and multi-level compose for long calls.
N9 unsupported statements (forced tool choice, "already connected", sample recordings, "other
Rhino repos"). N10 load-test wording; names only. N11 "client summary" vs `clientDetails`.
N12 Node type stripping, Chrome fake-media flags, "EGM" undefined.
