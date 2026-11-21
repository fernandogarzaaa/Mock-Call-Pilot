# Mock-call pilot

A browser page where a sales candidate runs one mock cold call against a scripted AI prospect.
The prospect's lines appear as text. The candidate speaks. The call is recorded and transcribed,
and the candidate gets a public recording link at the end.

This is a pilot, not a production system. The design and its review are in
[docs/designs/mock-call-pilot.md](docs/designs/mock-call-pilot.md). What still blocks real
candidates is in [PILOT_NOTES.md](PILOT_NOTES.md).

## Requirements

- Node 26 (type stripping runs the `.ts` files directly; there is no build step).
- pnpm 12.15.0 (`npm install -g pnpm@12.15.0`).

## Run locally

```sh
pnpm install
cp .env.example .env
pnpm dev
```

Open <http://localhost:3000/call?code=demo>. `pnpm dev` uses fake speech-to-text and a fake
prospect, so it needs no API keys. To use the real ElevenLabs and Claude services on placeholder
content, set `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY` in `.env` and run `pnpm dev:real`.

## Modes

- `MODE=demo` runs on placeholder content and shows a demo banner on every page.
- `MODE=live` is for real candidates. The server refuses to start, and lists every reason, while
  any value in `config/pilot.json` `gaps` or the script persona is unset, any line is not
  approved, or a fake adapter is selected.

## Checks

```sh
pnpm test        # unit, integration, boot and load tests
pnpm lint        # biome
pnpm typecheck   # tsc
pnpm mutate      # Stryker mutation testing (break threshold 70)
```

## Deploy

The pilot deploys to **Render (free plan) plus a Cloudflare R2 bucket (free tier)** from
`render.yaml`. See D2 and "Deploy" in [the design doc](docs/designs/mock-call-pilot.md).

### Render environment variables

Names only. Values go in the Render dashboard, never in the repo.

| Variable | Needed for | Notes |
|---|---|---|
| `R2_ACCOUNT_ID` | demo and live | Cloudflare account id; the endpoint is `https://<id>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | demo and live | private bucket name |
| `R2_ACCESS_KEY_ID` | demo and live | R2 API token with Object Read & Write on that bucket |
| `R2_SECRET_ACCESS_KEY` | demo and live | from the same R2 API token |
| `ACCESS_CODE` | demo and live | shared code in the call link (`/call?code=...`) |
| `GROQ_API_KEY` | when `STT=groq` | Whisper transcription on Groq's free tier (about 8 hours of audio a day) |
| `ELEVENLABS_API_KEY` | when `STT` is unset or `scribe` | Scribe transcription (paid) |
| `ANTHROPIC_API_KEY` | live only | line picker (`claude-opus-5-5`, effort `low`) |
| `MODE` | set in render.yaml | `demo` now; `live` once every gap is filled |
| `STT` | set in render.yaml | `fake`, `groq` (free) or `scribe`; `fake` is refused in live mode |
| `PICKER` | set in render.yaml | `fake` in demo; delete it for live |

No public R2 URL is needed: audio is served through presigned links that need no login.
Demo mode needs only the R2 variables and `ACCESS_CODE`. Recordings need R2 even in demo
mode, because Render's free disk is wiped on every restart and sleep.

`deploy/deploy.sh` (Google Cloud) is the superseded deploy path and is not used.

