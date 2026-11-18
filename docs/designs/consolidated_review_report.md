# Consolidated review report: mock-call-pilot.md

Date: 2026-11-19. Mode: consolidated (all five EGM stages). Every reviewer ran in a fresh context
with only the doc and its linked files.

## Result

The design is ready for approval. Every blocker found has an edit in the doc. The edits made
after the Stage 9 re-audit were applied but not re-reviewed, because EGM allows one re-audit
per stage. Each open item below is either a question
for the client or team (listed in the doc's Open Questions and the `gaps` table) or a check the
build itself runs.

| Stage | Reviewers | Blocker | Major | Nit | Report |
|---|---|---|---|---|---|
| 5 Initial zoom out | zoom-out | 0 | 5 | 7 | [zoom_out_report.md](zoom_out_report.md) |
| 6 Comprehension | comprehension | 2 | 12 | 12 | [comprehension_report.md](comprehension_report.md) |
| 7 Critic | design, structural, style | 0 | 25 | 40 | [critic_report.md](critic_report.md) |
| 8 Intermediate zoom out | zoom-out | 0 | 5 | 11 | [intermediate_zoom_out_report.md](intermediate_zoom_out_report.md) |
| 9 Implementation readiness | readiness, codebase details, style | 9 | 24 | 29 | [implementation_readiness_report.md](implementation_readiness_report.md) |
| 9 re-audit (1 allowed) | readiness, codebase details | 5 | 27 | 16 | this file, below |

Resolution of Stages 5 to 8: [goldfish_review_report.md](goldfish_review_report.md).

## Owner decisions taken during review

*   **D1 kept.** The caller replies stay on the public recording page, and Fernando accepts that
    shared links can work as an answer key.
*   **Vendor sentence approved for the notice (R9).** The notice also gained the retention
    sentence the brief requires.

## Largest changes the review caused

1.  **One upload of the full recording at End**, not 5-second chunks. This removed the
    compose/concatenation design, its prototype, and about eight findings.
2.  **A fully specified stage machine**: objections keep the stage, the fallback line changes
    nothing, there are four end reasons, the time limit is the only limit, and fallback turns
    never end the call.
3.  **A `gaps` / `settings` split in `pilot.json`**, with one list of everything `MODE=live`
    blocks on. That list now includes the persona, the caller company name (Q2), and every
    `approved` flag.
4.  **Shared contracts written out as literal TypeScript** in the scaffold, so parallel units
    can't diverge. The build runs in four waves.
5.  **Checks that can actually fail**:
    *   the G1 property test runs on a distinct-text fixture;
    *   a boot test runs `main.ts` under Node's type stripping;
    *   `call-core.js` has unit tests;
    *   an in-process load test;
    *   biome runs in every unit.
6.  **A deploy that works on a fresh project**:
    *   pnpm is installed without corepack (Node 26 has none; checked locally);
    *   the Docker `COPY` lines keep the directory layout;
    *   secrets are created before they are granted;
    *   a named service account with listed roles;
    *   `--allow-unauthenticated`, plus a curl check that detects a blocked public binding;
    *   links use `https` from `X-Forwarded-Proto`.

## Stage 9 re-audit: what it found and what was done

| Finding | Action (applied, not re-reviewed) |
|---|---|
| The picker never received the candidate's current words (`PickInput`) | Fixed: `candidateText` field; `userMessage` ends with it; a test asserts it |
| Docker `COPY src config public ./` flattens directories | Fixed: one `COPY` per directory |
| Secret IAM grants before the secrets exist | Fixed: deploy steps reordered; env values added as new versions |
| `import type` vs runtime exports | Fixed: the import rule names the four values |
| `ClaudePicker` and `FakePicker` constructors; unbound `pick` | Fixed: classes with constructors; `turnStep` takes the picker object |
| Replay of the call-ending turn returned 409; page had no 409 handling | Fixed: replay check comes first; `onTurnError` mapping, with tests |
| D1 test impossible with the fake picker | Fixed: stub picker for that test |
| `transcript.json` shape and marker matching | Fixed: `Transcript` type; exact match on normalized text |
| fs storage couldn't serve `/files/*` | Fixed: `verify` and `read`, with the HMAC payload defined |
| Call-page config block contract; `html` escaping breaks JSON | Fixed: `#cfg` keys, `raw()` with `<` escaped, a parse test |
| Biome not run by units; verify failures had no route | Fixed: biome in every check; any verify failure goes back to its unit |
| 30 MB page guard vs 12 MB server limit | Fixed: 25 MB on both sides; a **Download recording** fallback |
| Dependent worktrees lacked upstream code | Fixed: four build waves with `skein ship` between them |
| `http://` links behind Cloud Run | Fixed: `X-Forwarded-Proto` rule and a test |
| Expired signed URL on a long-open page | Fixed: `<audio>` error handler re-requests once |
| The G1 property failed on limit turns | Fixed: limit turns asserted separately |
| GCS 404 on a generation download | Fixed: `getJson` restarts up to 3 times |
| Org-policy check never fires | Fixed: unauthenticated curl after deploy |
| `--source` build permissions on new projects | Fixed: `roles/run.builder` grant; deployer roles listed |
| tsconfig accepts `.js` specifiers for `.ts` files | Fixed: biome `useImportExtensions` |
| Biome 2 config shape; vitest `test:` key; `.stryker-tmp` | Fixed: explicit `files.includes` list and corrected keys |
| pnpm build approval key | Fixed: `allowBuilds` in `pnpm-workspace.yaml` |
| Stale cross-references; token rules per field; `turnBase` type; `endedAt` owner; beta endpoint; per-turn bitrate; Stryker globs; fake-audio clip timing; demo-limit label | Fixed |

## Residual, checked during the build rather than on paper

*   **Anthropic request fields:** these were checked on 2026-11-19 against the bundled SDK
    reference: `output_config.format` as `json_schema`, and `client.beta.messages.create` with
    `betas: ["server-side-fallback-2026-07-01"]` and `fallbacks: "default"`. The first
    `pnpm dev:real` run checks them against the live API.
*   **`scribe_v1` model id:** checked on the first real transcription.
*   **Browser recording formats and WebM seeking:** scaffold item 7, before any unit starts.
*   **Turn latency and vendor limits at 10 sessions:** the deployed `load-test --real` run with
    Fernando.

## Open for the client or team (not design defects)

*   **Q1** prospect persona and lines (Rhieza and an author).
*   **Q2** Can-Am Telematics vs Can-Am Wireless.
*   **Q3** when the prospect hangs up, and how many objections.
*   **Q4** abandoned calls.
*   **Q5** one call per candidate.
*   **Demo-call content:** after Deadbolt 1, every prospect line is a placeholder until Q1 is
    answered.
*   **Gaps:** interview flow, test window, retention days, source live test, task instructions.
