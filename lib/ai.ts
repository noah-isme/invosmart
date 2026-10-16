/* Lightweight AI client adapter over Gemini (Google Generative AI) and OpenAI.

   It exposes a minimal shape compatible with the project's existing usage:
   client.chat.completions.create({ model, messages, temperature }) -> { choices: [{ message: { content } }] }

   Gemini is the primary provider when GEMINI_API_KEY is set, otherwise OpenAI
   (ADR 012). When both keys are set, a retryable failure of the primary
   (timeout, network error, HTTP 408/429/5xx) is retried once on the other
   provider, with the requested model swapped for that provider's default if
   it belongs to the primary. Every provider call is bounded by
   AI_REQUEST_TIMEOUT_MS (default 20000).

   The Gemini implementation uses the public Generative Language REST endpoint and
   adapts the response to the expected shape. This keeps route files small and
   allows switching providers by setting environment variables.
*/

type ChatMessagePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type Message = {
  role: "system" | "user" | "assistant";
  content: string | ChatMessagePart[];
};

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } };

type ChatCompletionsCreateArgs = { model: string; messages: Message[]; temperature?: number };
type ChatCompletionsResult = { choices: { message: { content: string } }[] };

export type AiProvider = "gemini" | "openai";

export type AiAdapter = {
  provider: AiProvider;
  chat: {
    completions: {
      create(args: ChatCompletionsCreateArgs): Promise<ChatCompletionsResult>;
    };
  };
};

/** Preference order when both keys are configured (Gemini first, ADR 012). */
export const AI_PROVIDER_ORDER: readonly AiProvider[] = ["gemini", "openai"];

export const PROVIDER_DEFAULT_MODELS: Record<AiProvider, string> = {
  gemini: "gemini-2.5-flash",
  openai: "gpt-4o-mini",
};

const DEFAULT_TIMEOUT_MS = 20_000;

const getTimeoutMs = () => {
  const parsed = Number.parseInt(process.env.AI_REQUEST_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
};

type AiProviderErrorKind = "timeout" | "network" | "http";

/**
 * A provider failure with enough context to decide on failover. `status` is
 * the HTTP status when the provider answered; `kind` says why it failed.
 */
export class AiProviderError extends Error {
  readonly provider: AiProvider;
  readonly kind: AiProviderErrorKind;
  readonly status?: number;

  constructor(
    message: string,
    options: { provider: AiProvider; kind: AiProviderErrorKind; status?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "AiProviderError";
    this.provider = options.provider;
    this.kind = options.kind;
    this.status = options.status;
  }
}

const isGeminiModel = (model: string) => /^(models\/)?gemini/i.test(model);

/** The requested model, or the provider's default when it names the other provider's model. */
export const resolveModelForProvider = (requestedModel: string, provider: AiProvider) => {
  const belongsToGemini = isGeminiModel(requestedModel);
  if (provider === "gemini" && !belongsToGemini) return PROVIDER_DEFAULT_MODELS.gemini;
  if (provider === "openai" && belongsToGemini) return PROVIDER_DEFAULT_MODELS.openai;
  return requestedModel;
};

/**
 * Run `call` with an AbortSignal that fires after AI_REQUEST_TIMEOUT_MS. The
 * race makes the timeout hold even if the underlying client ignores the signal.
 */
const withTimeout = async <T>(provider: AiProvider, call: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const timeoutMs = getTimeoutMs();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AiProviderError(`${provider} request timed out after ${timeoutMs} ms`, { provider, kind: "timeout" }));
    }, timeoutMs);
  });

  try {
    return await Promise.race([call(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
};

const toGeminiParts = (content: Message["content"]): GeminiPart[] => {
  if (typeof content === "string") {
    return [{ text: content }];
  }

  return content.flatMap((part): GeminiPart[] => {
    if (part.type === "text") {
      return [{ text: part.text }];
    }

    const dataUrl = part.image_url.url.match(/^data:([^;,]+);base64,(.+)$/);
    if (dataUrl) {
      return [{ inlineData: { mimeType: dataUrl[1], data: dataUrl[2] } }];
    }

    return [{ fileData: { mimeType: "image/*", fileUri: part.image_url.url } }];
  });
};

export const createGeminiAdapter = (apiKey: string): AiAdapter => ({
  provider: "gemini",
  chat: {
    completions: {
      create: ({ model, messages, temperature }) =>
        withTimeout("gemini", async (signal) => {
          // Use the v1beta generateContent endpoint (current stable API)
          const contents = messages.map((msg) => ({
            role: msg.role === "system" || msg.role === "user" ? "user" : "model",
            parts: toGeminiParts(msg.content),
          }));

          const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

          const body: Record<string, unknown> = {
            contents,
            generationConfig: {
              temperature: temperature ?? 0.7,
              maxOutputTokens: 2048,
            },
          };

          let res: Response;
          try {
            res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
              signal,
            });
          } catch (error) {
            // fetch rejects only on a network failure or an abort.
            throw new AiProviderError("Gemini API network error", { provider: "gemini", kind: "network", cause: error });
          }

          if (!res.ok) {
            const text = await res.text();
            throw new AiProviderError(`Gemini API error ${res.status}: ${text}`, {
              provider: "gemini",
              kind: "http",
              status: res.status,
            });
          }

          const data = await res.json();

          // Extract text from Gemini response format
          const candidateText =
            data?.candidates?.[0]?.content?.parts?.[0]?.text ||
            data?.candidates?.[0]?.text ||
            JSON.stringify(data);

          return { choices: [{ message: { content: String(candidateText) } }] };
        }),
    },
  },
});

/* Minimal internal types to avoid allowing `any` while keeping the adapter
   lightweight. We only require a client with the shape
   `client.chat.completions.create(args, options)` that returns the expected
   choices array. */
interface OpenAIClientLike {
  chat: {
    completions: {
      create(args: ChatCompletionsCreateArgs, options?: { signal?: AbortSignal }): Promise<ChatCompletionsResult>;
    };
  };
}

export const createOpenAiAdapter = (apiKey: string): AiAdapter => {
  // Lazy: the OpenAI package is imported the first time the adapter is used,
  // which keeps createClient synchronous and avoids a load-time import.
  let realClient: OpenAIClientLike | null = null;

  const getRealClient = async (): Promise<OpenAIClientLike> => {
    if (realClient) return realClient;
    const openaiModule = await import("openai");
    // The OpenAI package may export the client as default or named export.
    const OpenAIClient = (openaiModule as unknown as { default?: new (opts: { apiKey?: string }) => unknown }).default
      ?? (openaiModule as unknown);
    // Instantiate and coerce to our minimal client shape. We use `unknown` ->
    // `OpenAIClientLike` cast to avoid introducing `any` while acknowledging
    // the runtime shape may differ between package versions.
    const instance = new (OpenAIClient as unknown as new (opts: { apiKey?: string }) => unknown)({ apiKey });
    realClient = instance as unknown as OpenAIClientLike;
    return realClient;
  };

  return {
    provider: "openai",
    chat: {
      completions: {
        create: (args) =>
          withTimeout("openai", async (signal) => {
            const client = await getRealClient();
            return client.chat.completions.create(args, { signal });
          }),
      },
    },
  };
};

const TIMEOUT_ERROR_NAMES = new Set(["AbortError", "TimeoutError", "APIConnectionTimeoutError"]);

/** Why `error` is worth one retry on the other provider, or null when it is not. */
const failoverReason = (error: unknown): string | null => {
  if (error instanceof AiProviderError && (error.kind === "timeout" || error.kind === "network")) {
    return error.kind;
  }

  // AiProviderError (http) and OpenAI SDK APIError both carry `status`.
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") {
    return status === 408 || status === 429 || status >= 500 ? `http_${status}` : null;
  }

  const name = (error as { name?: unknown } | null)?.name;
  if (typeof name === "string") {
    if (TIMEOUT_ERROR_NAMES.has(name)) return "timeout";
    if (name === "APIConnectionError") return "network";
  }

  return null;
};

const configuredAdapter = (provider: AiProvider): AiAdapter | null => {
  if (provider === "gemini") {
    return process.env.GEMINI_API_KEY ? createGeminiAdapter(process.env.GEMINI_API_KEY) : null;
  }
  return process.env.OPENAI_API_KEY ? createOpenAiAdapter(process.env.OPENAI_API_KEY) : null;
};

export const createClient = () => {
  const adapters = AI_PROVIDER_ORDER.map(configuredAdapter).filter((adapter): adapter is AiAdapter => adapter !== null);
  const [primary, secondary] = adapters;

  if (!primary) {
    throw new Error("GEMINI_API_KEY or OPENAI_API_KEY must be configured");
  }

  return {
    chat: {
      completions: {
        create: async (args: ChatCompletionsCreateArgs): Promise<ChatCompletionsResult> => {
          try {
            return await primary.chat.completions.create(args);
          } catch (error) {
            const reason = secondary ? failoverReason(error) : null;
            if (!secondary || !reason) throw error;

            // No keys, prompts or provider messages in this log line.
            console.warn("ai provider failover", { from: primary.provider, to: secondary.provider, reason });
            return secondary.chat.completions.create({
              ...args,
              model: resolveModelForProvider(args.model, secondary.provider),
            });
          }
        },
      },
    },
  };
};

export const DEFAULT_MODEL = process.env.GEMINI_API_KEY ? PROVIDER_DEFAULT_MODELS.gemini : PROVIDER_DEFAULT_MODELS.openai;
