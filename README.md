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

```sh
ANTHROPIC_API_KEY=... ELEVENLABS_API_KEY=... ACCESS_CODE=... deploy/deploy.sh <project> <region> demo
```

The script creates the bucket, secrets and service account it needs, deploys to Cloud Run, and
checks that the service is reachable without a login.
