import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { loadConfig } from "../config/load.ts";
import { ClaudePicker } from "../picker/claude.ts";
import { FakePicker } from "../picker/fake.ts";
import { systemPrompt } from "../picker/prompt.ts";
import { FsStorage } from "../storage/fs.ts";
import { GcsStorage } from "../storage/gcs.ts";
import { R2Storage } from "../storage/r2.ts";
import { FakeTranscriber } from "../stt/fake.ts";
import { GroqTranscriber } from "../stt/groq.ts";
import { ScribeTranscriber } from "../stt/scribe.ts";
import { FakeSynthesizer } from "../tts/fake.ts";
import { GroqSynthesizer } from "../tts/groq.ts";
import type {
  LinePicker,
  ResolvedConfig,
  Storage,
  Synthesizer,
  Transcriber,
} from "../types/index.ts";
import { ConfigError } from "../types/index.ts";
import { buildApp } from "./app.ts";

type Env = Record<string, string | undefined>;

function requireEnv(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new ConfigError([`env.${name}: not set`]);
  return value;
}

async function buildStorage(env: Env): Promise<Storage> {
  if (env.STORAGE === "r2") {
    const { AwsClient } = await import("aws4fetch");
    const client = new AwsClient({
      accessKeyId: requireEnv(env, "R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv(env, "R2_SECRET_ACCESS_KEY"),
      service: "s3",
      region: "auto",
      retries: 2,
    });
    const endpoint = `https://${requireEnv(env, "R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
    return new R2Storage(client, endpoint, requireEnv(env, "R2_BUCKET"));
  }
  if ((env.STORAGE ?? "fs") === "gcs") {
    const { Storage: CloudStorage } = await import("@google-cloud/storage");
    return new GcsStorage(new CloudStorage().bucket(requireEnv(env, "BUCKET")));
  }
  // Signed fs URLs only need to survive one process, so a random secret is fine without one.
  const secret = env.URL_SIGNING_SECRET || randomBytes(32).toString("hex");
  return new FsStorage(env.STORAGE_DIR || "./.data", secret);
}

function buildTranscriber(env: Env): Transcriber {
  if (env.STT === "fake") return new FakeTranscriber();
  if (env.STT === "groq") {
    return new GroqTranscriber(
      requireEnv(env, "GROQ_API_KEY"),
      env.GROQ_STT_MODEL || "whisper-large-v3-turbo",
    );
  }
  return new ScribeTranscriber(
    requireEnv(env, "ELEVENLABS_API_KEY"),
    env.SCRIBE_MODEL || "scribe_v1",
  );
}

function buildSynthesizer(env: Env): Synthesizer {
  if (env.TTS === "groq") {
    return new GroqSynthesizer(
      requireEnv(env, "GROQ_API_KEY"),
      env.GROQ_TTS_MODEL || "canopylabs/orpheus-v1-english",
      env.GROQ_TTS_VOICE || "troy",
      env.GROQ_TTS_VOICE_FEMALE || "autumn",
    );
  }
  return new FakeSynthesizer();
}

async function buildPicker(env: Env, config: ResolvedConfig): Promise<LinePicker> {
  if (env.PROSPECT === "generative") {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { ClaudeGenerator } = await import("../prospect/claude.ts");
    const { generatorSystemPrompt } = await import("../prospect/prompt.ts");
    const client = new Anthropic({ apiKey: requireEnv(env, "ANTHROPIC_API_KEY") });
    return new ClaudeGenerator(
      client,
      env.PICKER_MODEL || "claude-opus-5-5",
      env.PICKER_EFFORT || "low",
      generatorSystemPrompt(config.script),
    );
  }
  if (env.PICKER === "fake") return new FakePicker(config.script);
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: requireEnv(env, "ANTHROPIC_API_KEY") });
  return new ClaudePicker(
    client,
    env.PICKER_MODEL || "claude-opus-5-5",
    env.PICKER_EFFORT || "low",
    systemPrompt(config.script),
  );
}

async function main(): Promise<void> {
  const env: Env = process.env;
  const config = loadConfig("./config", env);
  const speechSecret = env.SPEECH_SECRET || randomBytes(32).toString("hex");
  const app = buildApp({
    config,
    storage: await buildStorage(env),
    transcriber: buildTranscriber(env),
    synthesizer: buildSynthesizer(env),
    picker: await buildPicker(env, config),
    speechSecret,
  });
  // Bind IPv4 explicitly: with the default dual-stack "::" bind, a port 0 the kernel picks can
  // already be held on 127.0.0.1 by another process, and IPv4 clients then reach that process.
  const server = serve(
    { fetch: app.fetch, port: Number(env.PORT ?? 8080), hostname: "0.0.0.0" },
    (info) => {
      console.log(`listening on ${info.port}`);
    },
  );
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`Cannot start:\n${error.problems.map((problem) => `  ${problem}`).join("\n")}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
