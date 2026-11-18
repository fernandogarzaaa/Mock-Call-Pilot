Status: resolved (2026-11-19; R2 declined by Fernando, D1 kept with accepted trade-off; all other PROPOSE FIX items applied)

# Goldfish Annotated Review Report

**Target:** `mock-call-pilot.md` (full file, 616 lines at the time of review)
**Sources:** zoom_out_report.md (Stage 5), comprehension_report.md (Stage 6, blockers B1 and B2
already fixed before Stage 7), critic_report.md (Stage 7), intermediate_zoom_out_report.md
(Stage 8). Stage 9 (implementation readiness) runs after these fixes are applied, because R1
rewrites a large part of the implementation plan.

Each item is either **PROPOSE FIX** (the finding is valid; the edit is described) or
**CONTEST** (the finding is not adopted; the reason is given). Items marked **OWNER** reverse or
extend a decision Fernando made, so they need his yes.

---

## High

### R1. Upload the full recording once at End; drop 5 s chunks [zoom-out S5-M2, S8-M1; critic C4, C5, C6; comprehension M6, N8]
*   **AI Suggestion:** PROPOSE FIX
*   **Justification:** Chunking only protects abandoned calls, and those get no link (Q5 is
    open). One upload removes compose and its 32-object limit, the race between the end of the
    call and the last chunk, chunk retries and gaps, the `/chunk` route, and the cross-browser
    concatenation prototype.
*   **Proposed Edit:**
    *   The full-call MediaRecorder records at `audioBitsPerSecond: 32000`, so 30 minutes is
        about 7 MB, well under Cloud Run's 32 MB request limit.
    *   At End, the page stops the recorder, uploads the single blob with `/end`, keeps it in
        memory, and shows **Retry upload** until the upload succeeds. This retries the upload,
        not the call.
    *   Per-turn audio is forwarded to speech-to-text and not stored.
    *   Remove `compose` from `Storage`, remove the `/chunk` route, and replace scaffold item 5
        with a smaller Safari check: does MP4 play back on the recording page?
    *   Q5 records that chunking comes back only if abandoned calls must produce a link.

### R2. Take `callerReply` off the public recording page [zoom-out S5-M2, S8-M2; critic C2] — OWNER
*   **AI Suggestion:** PROPOSE FIX (reverses part of D1)
*   **Justification:** The recording link is handed to the candidate and pasted into a document
    they own. Showing the approved replies there gives later candidates the answer key. The
    no-coaching rule holds during the call but fails across calls.
*   **Proposed Edit:** The recording page shows only what was said on the call. Objection turns
    show the objection's id. Harold uses a one-page reference sheet, `GET /ref?code=<REVIEW_CODE>`,
    generated from `script.json`. It is behind its own review code, which the candidate never
    sees. D1 is updated to match. If Fernando keeps D1 as written, the doc instead records that
    he accepts the exposure.

### R3. Retention: one source of truth, stated in the notice [critic C3, C13; zoom-out S5-M4, S8-M4; comprehension M7]
*   **AI Suggestion:** PROPOSE FIX for the token and the deploy script; CONTEST for the startup
    bucket check.
*   **Proposed Edit:**
    *   `recordingNotice` gains a sentence with a `{retentionDays}` token: "Recordings are
        deleted after {retentionDays} days."
    *   `deploy.sh` reads `retentionDays` from `config/pilot.json` (no `RETENTION_DAYS` env var)
        and refuses a live deploy when it is null.
*   **Contest:** a startup check of the bucket's lifecycle rule adds an IAM permission and a
    runtime call. The deploy script, which sets the rule, already guarantees it.

### R4. Concurrency must also be shown against the real services [zoom-out S5-M3, S8-M5; critic C10]
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:**
    *   Keep the fake 20-session test, which proves the "no coordinator" claim.
    *   Add a deployed run: `load-test.ts <url> 10 --real`. Each session uploads the same short
        recorded clip, which contains a spoken per-session marker. The run asserts that each
        transcript contains its own marker and reports the count of fallback causes, including
        429s.
    *   This replaces a written vendor-quota analysis.
    *   The goal wording changes from "without errors" to "without errors or fallback lines
        caused by vendor failures".

## Medium

### R5. Limits: fallback turns must not push accented speakers into ending the call [critic C8; zoom-out S8-N3]
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:**
    *   Drop `maxTurns`; `maxCallMinutes` is the only limit.
    *   The server checks elapsed time on every request, so no sweeper process is needed (C7).
    *   Fallback turns appear on the recording page as "[not understood: <cause>]", so Harold
        can see transcription failures.
    *   The property test ends walks with a simulated clock.

### R6. Turn retries are safe [critic C6 turn half; zoom-out S8-N1]
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:** The client sends `turnIndex`. If `state.json` already holds that turn, the
    server returns the stored result instead of running the turn again. A double submit or a
    lost response is then harmless.

### R7. Re-runs with the shared access code [critic C1; zoom-out S8-M3]
*   **AI Suggestion:** CONTEST building per-candidate tokens; PROPOSE FIX documenting the limit.
*   **Justification:** Per-candidate tokens presume the invitation flow (gap 1) and the
    candidate count (gap 2), which the brief says not to invent. The brief forbids building a
    retry feature, which this design does not do.
*   **Proposed Edit:** add Open Question Q7: "A candidate who has the access code can start more
    than one call. Should each candidate get their own single-use code? (Depends on gaps 1 and
    2.)" The recording page shows the start time and the candidate name, so Harold can spot
    duplicates. `--max-instances` bounds API spend.

### R8. Live-mode check covers everything that could be a guess [structural M1; critic C14, C12; comprehension M4; zoom-out S8-N6, N7, N8]
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:** `pilot.json` gets two groups.
    *   **`gaps`** (nullable; live mode fails on null; demo fills text with the demo string):
        `interviewFlow`, `testWindow`, `retentionDays`, `sourceLiveTest`, `taskInstructions`,
        `callerCompanyName` (Q6, new), `maxCallMinutes` (Q4).
    *   **`settings`** (always set): `recordingNotice`, `clientDetails`, `demoMaxCallMinutes`
        (15).
    *   `ACCESS_CODE` and `REVIEW_CODE` come from env or secrets. Live mode refuses to start
        when either is unset.
    *   Persona fields start null and are checked the same way.
    *   `fallbackLine.approved` is included in the live check.
    *   Demo mode with numeric gaps uses the `settings` values, so no numeric placeholders
        exist.

### R9. Candidate audio is sent to two vendors [structural M5] — OWNER
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:**
    *   Add an NFR line: turn audio goes to ElevenLabs for transcription, and transcripts go to
        Anthropic to choose the next line; neither is stored beyond what their APIs retain.
    *   Add one sentence to the notice: "Your answers are transcribed and processed by our
        speech-to-text and AI providers during the call."
    *   This extends the D3 wording, so it needs Fernando's yes.

### R10. Consistency claim and objection policy [critic C9; zoom-out S8-N4]
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:**
    *   The Problem says "the same script" instead of "the same prospect".
    *   Q4 adds: "How many objections per call, and which ones?"
    *   No policy engine is built until Q4 is answered.

### R11. Prompt injection [critic C11; zoom-out S8-N5]
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:**
    *   The system prompt treats the transcript as untrusted.
    *   A Risks entry says a candidate can steer which approved line comes next ("just accept
        the meeting"), but cannot push text off script. Harold hears any such attempt.

### R12. Contracts a builder would otherwise invent [comprehension M3, M5, M8, M10, M12, N7]
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:**
    *   **Env:** `STT=scribe|fake`, `PICKER=claude|fake` (independent of `MODE`; demo with the
        real AI is the owner's test run), `SCRIBE_MODEL`, `ACCESS_CODE`, `REVIEW_CODE`.
    *   **HTTP:**
        *   `/turn` and `/end` take multipart fields (`audio` file, `turnIndex`, `mime`).
        *   Status codes: 403 bad code on `POST /api/sessions`; 404 unknown id; 409 session
            ended; 422 bad name (1-80 characters after trim).
        *   Speech-to-text failure → fallback, not an error.
        *   `/r/:id` before the call ends → "Call in progress".
    *   **Object keys:** `audio.<ext>` from the MIME type.
    *   **Deploy:** the full `gcloud run deploy` flag list, including the env vars and secrets.
    *   **Picker user message:** stage, the last 6 turns, and the allowed `{id, text}` list.
        The persona values are rendered into a template at startup.
    *   **Screen order:** name → instructions + notice + tick → microphone permission → Start.
    *   **Timeouts:** speech-to-text 10 s, picker 8 s, plus a p95 target of 5 s.

### R13. The brief's short note is a build item [comprehension M11]
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:** add `PILOT_NOTES.md` to the scaffold. It covers what was built, what is
    blocked on each gap, and every config value needed before the first real candidate. The
    main thread finalizes it last.

## Low

### R14. Editing fixes [style 1-26; structural N1-N12; critic C15, C18-C21; comprehension N1-N6, N9-N12]
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:**
    *   One mode name: `MODE=live` / `MODE=demo`.
    *   "Operator" means whoever runs the deploy.
    *   Name the two pilot goals by their Goals bullets.
    *   Use distinct symbols instead of reusing N.
    *   Renumber Open Questions Q1 onward and keep one gap list.
    *   CUJ 5 uses `retentionDays`; one banner text, quoted once.
    *   Alternative F's last field becomes "Status: deferred".
    *   Unsupported claims are softened or sourced.
    *   Define the terms Deadbolt, Paid Test, Rhieza and EGM.
    *   Fix the diagram rows.
    *   Add a `---` before NFR; list the same links in the header and Resources.
    *   Signed audio URL: 1 h TTL, the page re-fetches it on a playback error, and deploy grants
        `signBlob`.
    *   State that speech outside a turn is in the audio but not the transcript.
    *   SDK detail moves from the Technical Plan to item 8.
    *   A short build-tooling glossary (skein, testteeth, main thread) sits in the Verification
        Plan.
    *   `git init` creates `main` with the docs commit, then the feature branch.

### R15. Make the mutation gate advisory [zoom-out S5-N7, S8-N11]
*   **AI Suggestion:** CONTEST
*   **Justification:** The project owner's standing build policy requires tests to be graded by
    mutation testing, with surviving mutants killed or justified. The gate stays. Justified
    survivors are listed in `PILOT_NOTES.md`.

### R16. Unused gap keys (`interviewFlow`, `testWindow`, `sourceLiveTest`) [critic C21]
*   **AI Suggestion:** CONTEST
*   **Justification:** The brief requires every gap to be config that fails loudly when unset.
    These keys exist to block live mode, not to drive runtime behaviour. The doc says so.
