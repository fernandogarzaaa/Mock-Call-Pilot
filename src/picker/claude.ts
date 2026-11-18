import type Anthropic from "@anthropic-ai/sdk";
import type { LinePicker, PickInput } from "../types/index.ts";
import { PickerError } from "../types/index.ts";
import { userMessage } from "./prompt.ts";

interface ContentBlock {
  type: string;
  text?: string;
}
interface PickerResponse {
  stop_reason: string | null;
  content: ContentBlock[];
}
interface RequestOptions {
  timeout: number;
  maxRetries: number;
}

/**
 * The slice of the Anthropic SDK client the picker uses. Declared here so tests stub it
 * without the SDK; the real client satisfies it structurally.
 */
type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Effort = NonNullable<NonNullable<CreateParams["output_config"]>["effort"]>;

export interface PickerClient {
  beta: {
    messages: {
      create(params: CreateParams, options: RequestOptions): Promise<PickerResponse>;
    };
  };
}

const PICK_TIMEOUT_MS = 8000;

function isTimeout(err: unknown): boolean {
  let cur: unknown = err;
  // The SDK names its timeout class APIConnectionTimeoutError; a bare abort is a timeout too.
  for (let depth = 0; depth < 4 && cur instanceof Error; depth++) {
    if (
      cur.name === "APIConnectionTimeoutError" ||
      cur.name === "TimeoutError" ||
      cur.name === "AbortError"
    ) {
      return true;
    }
    cur = cur.cause;
  }
  return false;
}

export class ClaudePicker implements LinePicker {
  readonly #client: PickerClient;
  readonly #model: string;
  readonly #effort: string;
  readonly #systemPrompt: string;

  constructor(client: PickerClient, model: string, effort: string, systemPrompt: string) {
    this.#client = client;
    this.#model = model;
    this.#effort = effort;
    this.#systemPrompt = systemPrompt;
  }

  async pick(input: PickInput): Promise<{ lineId: string }> {
    let response: PickerResponse;
    try {
      response = await this.#client.beta.messages.create(
        {
          model: this.#model,
          max_tokens: 256,
          system: [
            { type: "text", text: this.#systemPrompt, cache_control: { type: "ephemeral" } },
          ],
          messages: [{ role: "user", content: userMessage(input) }],
          output_config: {
            effort: this.#effort as Effort,
            format: {
              type: "json_schema",
              schema: {
                type: "object",
                properties: { lineId: { type: "string", enum: input.allowed.map((a) => a.id) } },
                required: ["lineId"],
                additionalProperties: false,
              },
            },
          },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { timeout: PICK_TIMEOUT_MS, maxRetries: 0 },
      );
    } catch (err) {
      throw new PickerError(isTimeout(err) ? "picker_timeout" : "picker_error");
    }

    if (response.stop_reason === "refusal") throw new PickerError("picker_refusal");

    // thinking and fallback blocks can precede the answer.
    const block = response.content.find((b) => b.type === "text");
    if (block === undefined || typeof block.text !== "string") {
      throw new PickerError("picker_error");
    }
    let parsed: { lineId?: unknown } | null;
    try {
      parsed = JSON.parse(block.text);
    } catch {
      throw new PickerError("picker_error");
    }
    const lineId = parsed?.lineId;
    if (typeof lineId !== "string") throw new PickerError("picker_error");
    return { lineId };
  }
}
