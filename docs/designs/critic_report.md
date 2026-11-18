# Stage 7: Critic report

Reviewers: egm-design (feature-spec standard), egm-structural (feature-spec standard + template),
egm-style. Fresh contexts. Target: mock-call-pilot.md lines 1-418 plus linked files.
Totals: 0 Blocker, 25 Major, 40 Nit. The table below merges overlapping findings.

## Major (deduplicated)

| # | Finding | Raised by | Lines |
|---|---|---|---|
| C1 | One shared access code lets a candidate rerun calls and submit the best link. That is retry, which the brief forbids. The code can also leak in URLs, and starts are uncapped. Suggests per-candidate single-use tokens plus a session cap. | design | 256-258, 38, 121 |
| C2 | `callerReply` on the public, candidate-held page becomes an answer key for later candidates. | design (also Stage 5 M5) | 72-74, 278 |
| C3 | The notice names no retention period, but the brief requires it, and the design has no way to insert one. | design | 82-86, 293 |
| C4 | GCS compose limit of 32 objects per request = about 160 s of 5 s chunks. Multi-pass compose and cleanup are unspecified, and this is not in Risks. | design, structural | 250-252, 315-319 |
| C5 | Race between the end of the call and the last chunk: `/end` can compose before the final chunk arrives. | design | 178, 277 |
| C6 | No idempotency: a lost chunk breaks the recording; a turn whose response is lost is rejected on retry (stale generation). | design | 171, 259-261 |
| C7 | `maxCallMinutes` can't fire on an idle session (no request arrives); the auto-end runs on the client. | design | 263, 274 |
| C8 | Fallback turns count toward `maxTurns`, so candidates whose speech-to-text fails get pushed into `limit_reached`. | design | 216-222, 263 |
| C9 | "Every candidate gets the same prospect" is undermined: the picker decides which objections come up, how many, and when to hang up. There is no objection policy. | design | 26-30, 202, 108 |
| C10 | No external API quota or rate-limit analysis; 429s fall into the fallback loop; max-instances is hard-coded. | design, structural | 49-51, 396-402 |
| C11 | Prompt injection: the candidate can steer the picker ("just accept the meeting"). Not listed as a limit. | design | 228-235 |
| C12 | `clientDetails` passes live mode while the company name (Q6) is unresolved. | design | 293, 105 |
| C13 | Retention set at deploy vs config key; live mode doesn't check the bucket rule. | design (also Stage 5 M4, Stage 6 M7) | 303-310 |
| C14 | The live check misses persona values (they have no approved flag) and `fallbackLine`. | structural, design | 103, 187, 205, 296 |
| C15 | CUJ 5 uses `recordingNotice`, which now ships filled; the banner text differs between two places. | structural, style, design | 152-157, 299-300 |
| C16 | Demo mode for non-text null keys (`maxTurns`, `maxCallMinutes`, `retentionDays`, `accessCode`) is undefined. | structural (also Stage 6 M4) | 290-305 |
| C17 | Candidate voice goes to ElevenLabs and transcripts to Anthropic; neither the notice nor the NFRs say so. | structural | 82-86, 390-395 |
| C18 | Terminology: one mode has four names; "operator" vs "owner"; "the two goals" vs six Goals bullets; "N" means three different things. | style, structural | 21, 52-53, 104, 155, 296, 334, 386, 49, 168 |
| C19 | Claims stated as fact without support: chunk concatenation, "adding lines fixes it", forced tool choice, caching. | style, design | 251, 322-336, 229-235 |
| C20 | Alternative F: pros and cons contradict each other; "Reason for Rejection: Not rejected outright". | style, structural, design | 372-379 |
| C21 | Open Questions order (Q3, Q6, Q4, Q5) and the gap list duplicated in D3 and Open Questions. | style, structural, design | 94-115 |

## Nit (selection)

Wording: "falls over", "promises things", "small interfaces", "typical wording", "dozens",
"anyway", contractions, the "Shape" heading. Speech verbs used for a text-only prospect. Diagram
arrows point at the wrong rows. `.webm` keys vs Safari MP4. Missing `---` before NFRs. The Source
header and Additional Resources list different links. Signed URL expires mid-review, and signing
needs the `signBlob` permission. The latency target has no p95 and no timeout values. Speech
outside a turn is not in the transcript. `interviewFlow`, `testWindow`, `sourceLiveTest` are
required but unused. `approved: true` has no record of who approved it.
