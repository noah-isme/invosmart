/* Lightweight AI client adapter that prefers Gemini (Google Generative AI) when
   GEMINI_API_KEY is set, otherwise falls back to OpenAI using OPENAI_API_KEY.

   It exposes a minimal shape compatible with the project's existing usage:
   client.chat.completions.create({ model, messages, temperature }) -> { choices: [{ message: { content } }] }

   The Gemini implementation uses the public Generative Language REST endpoint and
   adapts the response to the expected shape. This keeps route files small and
   allows switching providers by setting environment variables.
*/

type Message = { role: string; content: string };

const buildGeminiPrompt = (messages: Message[]) => {
  // Convert chat-style messages into a single prompt. We keep role markers
  // so the model can understand system/user distinctions.
  return messages.map((m) => `<${m.role}>\n${m.content}`).join("\n\n");
};

export const createClient = () => {
  if (process.env.GEMINI_API_KEY) {
    const key = process.env.GEMINI_API_KEY;

    return {
      chat: {
        completions: {
          create: async ({ model, messages, temperature }: { model: string; messages: Message[]; temperature?: number }) => {
            // Prefer the v1beta2 generateText endpoint. We send a simple prompt
            // body; the actual Google API supports richer message formats but
            // this keeps integration lightweight.
            const prompt = buildGeminiPrompt(messages || []);

            const url = `https://generativelanguage.googleapis.com/v1beta2/models/${encodeURIComponent(model)}:generateText?key=${encodeURIComponent(key)}`;

            const body: Record<string, unknown> = {
              prompt: { text: prompt },
            };

            if (typeof temperature === "number") {
              (body as Record<string, unknown>).temperature = temperature;
            }

            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });

            if (!res.ok) {
              const text = await res.text();
              throw new Error(`Gemini API error ${res.status}: ${text}`);
            }

            const data = await res.json();

            // The generative API has changed shapes over time. Try a few common
            // locations for the generated text and fall back to a JSON dump.
            const candidateText =
              data?.candidates?.[0]?.content?.[0]?.text ||
              data?.candidates?.[0]?.content?.text ||
              data?.candidates?.[0]?.output ||
              data?.output?.[0]?.content?.text ||
              data?.candidates?.[0]?.text ||
              data?.text ||
              JSON.stringify(data);

            return { choices: [{ message: { content: String(candidateText) } }] };
          },
        },
      },
    };
  }

  // Fallback to OpenAI if OPENAI_API_KEY is configured. We return a lazy
  // adapter that dynamically imports the OpenAI client the first time it's
  // used. This keeps createClient synchronous while avoiding runtime
  // require/import at module load time.
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("GEMINI_API_KEY or OPENAI_API_KEY must be configured");
  }

  /* Minimal internal types to avoid allowing `any` while keeping the
     adapter lightweight. We only require a client with the shape
     `client.chat.completions.create(args)` that returns the expected
     choices array. */
  type ChatCompletionsCreateArgs = { model: string; messages: Message[]; temperature?: number };
  type ChatCompletionsResult = { choices: { message: { content: string } }[] };

  interface ChatCompletions {
    create(args: ChatCompletionsCreateArgs): Promise<ChatCompletionsResult>;
  }

  interface OpenAIClientLike {
    chat: { completions: ChatCompletions };
  }

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
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const instance = new (OpenAIClient as unknown as new (opts: { apiKey?: string }) => unknown)({ apiKey: process.env.OPENAI_API_KEY });
    realClient = instance as unknown as OpenAIClientLike;
    return realClient;
  };

  return {
    chat: {
      completions: {
        create: async (args: { model: string; messages: Message[]; temperature?: number }) => {
          const client = await getRealClient();
          return client.chat.completions.create(args);
        },
      },
    },
  };
};

export const DEFAULT_MODEL = process.env.GEMINI_API_KEY ? "gemini-2.5-flash" : "gpt-4o-mini";
