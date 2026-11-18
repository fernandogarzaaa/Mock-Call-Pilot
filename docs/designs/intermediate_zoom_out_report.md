# Stage 8: Intermediate Zoom Out report

Reviewer: egm-zoom-out (fresh context). Target: mock-call-pilot.md (616-line version) plus the
linked files and the Stage 5, 6 and 7 reports. 0 Blocker, 5 Major, 11 Nit.

## Major

- **M1. Replace 5 s chunk uploads with one upload at End.** Chunking pays for Q5 (abandoned
  calls), which is undecided. One upload removes C4, C5, the chunk half of C6, Risk 1 and the
  prototype, compose and batching, the `/chunk` route, client sequencing, and most of
  comprehension M6 and N8. It adds one risk: a failed upload at End. Cover it by keeping the
  blob in the page and offering "Retry upload". That retries the upload, not the call. Check the
  Cloud Run request-size limit against `maxCallMinutes`; if needed, upload to a signed GCS URL.
  Also drop per-turn audio storage (never read).
- **M2. Take `callerReply` off the public page (C2).** Harold uses `script.json` or a
  reference sheet. This reverses D1, so it needs Fernando's sign-off, or a record that he
  accepts the exposure.
- **M3. Don't build per-candidate tokens or session caps (C1).** They presume gaps 1 and 2.
  The brief forbids building retry, not every possible re-run. Record the limitation; the start
  time on the recording page lets Harold spot duplicates.
- **M4. One retention source, stated in the notice (C3, C13).** Add a `{retentionDays}` token
  in `recordingNotice`. `deploy.sh` reads `pilot.json` and refuses a live deploy without it.
  Reject the startup lifecycle check.
- **M5. The concurrency proof never touches the real services.** Keep the fake load test for
  the architecture claim. Add one deployed run with real adapters (a recorded clip per session)
  and count fallback causes. That replaces a written quota analysis (C10).

## Nit

N1 turn idempotency: the client sends a turn index, and the server returns the stored line if
it already has it. N2 no sweeper: the limit is checked on every request; idle sessions = Q5.
N3 fallback vs `maxTurns`: drop `maxTurns` (keep `maxCallMinutes`) or count only picker turns
plus a cap on consecutive fallbacks. N4 soften "same prospect" to "same script"; add the
objection count to Q4. N5 prompt injection: one Risks sentence, no code. N6 company name:
make it a null key until Q6. N7 persona fields start null; include `fallbackLine` in the live
check. N8 split pilot.json into gap keys (nullable) and operational settings (defaults). N9 NFR
line on third-party processing + a note to Fernando about the notice. N10 editing fixes (C15,
C18-C21). N11 make the mutation gate advisory; move SDK detail to item 8.

## Kept as is

state.json + generation precondition; the three interfaces; enum + lookup + one fallback line;
signed audio URLs.
