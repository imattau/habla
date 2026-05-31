export type AIProvider = "openai" | "groq";

export interface AIDraftingSettings {
  provider: AIProvider;
  apiKey: string;
  model: string;
}

export type AIDraftAction = "draft" | "rewrite" | "concise" | "expand";

export interface AIDraftScope {
  from: number;
  to: number;
  markdown: string;
  label: string;
  anchor?: number;
}

export interface GenerateDraftInput {
  provider: AIProvider;
  apiKey: string;
  model: string;
  action: AIDraftAction;
  sectionScoped?: boolean;
  prompt: string;
  currentMarkdown?: string;
  currentTitle?: string;
  includeCurrentDraft?: boolean;
}

export interface GenerateDraftResult {
  markdown: string;
  provider: AIProvider;
  model: string;
}

const STORAGE_PREFIX = "habla:ai-drafting";

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: "gpt-4.1-mini",
  groq: "llama-3.3-70b-versatile",
};

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: "OpenAI",
  groq: "Groq",
};

function storageKey(pubkey: string): string {
  return `${STORAGE_PREFIX}:${pubkey}`;
}

export function getDefaultAIDraftingSettings(
  provider: AIProvider = "openai",
): AIDraftingSettings {
  return {
    provider,
    apiKey: "",
    model: DEFAULT_MODELS[provider],
  };
}

export function loadAIDraftingSettings(pubkey: string): AIDraftingSettings {
  if (typeof window === "undefined") {
    return getDefaultAIDraftingSettings();
  }

  const raw = window.localStorage.getItem(storageKey(pubkey));
  if (!raw) return getDefaultAIDraftingSettings();

  try {
    const parsed = JSON.parse(raw) as Partial<AIDraftingSettings>;
    return {
      provider:
        parsed.provider === "groq" || parsed.provider === "openai"
          ? parsed.provider
          : "openai",
      apiKey: parsed.apiKey || "",
      model:
        parsed.model || DEFAULT_MODELS[parsed.provider === "groq" ? "groq" : "openai"],
    };
  } catch (error) {
    console.error("[ai-drafting] Failed to load settings:", error);
    return getDefaultAIDraftingSettings();
  }
}

export function saveAIDraftingSettings(
  pubkey: string,
  settings: AIDraftingSettings,
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(pubkey), JSON.stringify(settings));
}

export function clearAIDraftingSettings(pubkey: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storageKey(pubkey));
}

function providerEndpoint(provider: AIProvider): string {
  return provider === "groq"
    ? "https://api.groq.com/openai/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
}

function actionInstruction(action: AIDraftAction): string {
  switch (action) {
    case "rewrite":
      return "Rewrite the provided text while preserving meaning and voice.";
    case "concise":
      return "Make the provided text more concise without losing important meaning.";
    case "expand":
      return "Expand the provided text with useful detail, examples, and clearer transitions.";
    case "draft":
    default:
      return "Write a fresh article draft from the user's request.";
  }
}

function buildSystemPrompt(
  includeCurrentDraft: boolean,
  action: AIDraftAction,
  sectionScoped: boolean,
): string {
  const scopeInstructions = sectionScoped
    ? [
        "Rewrite only the provided section.",
        "Return only Markdown for that section.",
        "Do not add a title, heading, or preamble.",
      ]
    : [
        "The first line must be a single H1 title.",
        "Return a complete article draft in Markdown.",
      ];

  return [
    "You are an expert article drafting assistant for a long-form publishing app.",
    "Return only Markdown.",
    "Do not wrap the response in code fences.",
    "Do not add commentary or preambles.",
    actionInstruction(action),
    includeCurrentDraft
      ? "Use the provided draft as context and improve it while preserving the author's intent."
      : "Use only the prompt and supplied excerpt as needed.",
    ...scopeInstructions,
  ].join(" ");
}

function buildUserPrompt({
  prompt,
  currentMarkdown,
  currentTitle,
  includeCurrentDraft,
}: GenerateDraftInput): string {
  const parts = [
    `Writer request:\n${prompt.trim()}`,
  ];

  if (includeCurrentDraft && currentMarkdown?.trim()) {
    parts.push(`Source markdown:\n${currentMarkdown.trim()}`);
  }

  if (currentTitle) {
    parts.push(`Current title:\n${currentTitle.trim()}`);
  }

  parts.push(
    "Output a polished article in Markdown with a clear title, structured sections, and no extraneous explanation.",
  );

  return parts.join("\n\n");
}

export async function generateAIDraft(
  input: GenerateDraftInput,
): Promise<GenerateDraftResult> {
  const response = await fetch(providerEndpoint(input.provider), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 0.7,
      max_tokens: 1200,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(
            Boolean(input.includeCurrentDraft),
            input.action,
            Boolean(input.sectionScoped),
          ),
        },
        {
          role: "user",
          content: buildUserPrompt(input),
        },
      ],
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        error?: { message?: string };
        choices?: Array<{ message?: { content?: string | null } }>;
      }
    | null;

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        `AI request failed with status ${response.status}`,
    );
  }

  const markdown = payload?.choices?.[0]?.message?.content?.trim();
  if (!markdown) {
    throw new Error("AI provider returned no draft content");
  }

  return {
    markdown,
    provider: input.provider,
    model: input.model,
  };
}

export async function testAIDraftingConnection(
  provider: AIProvider,
  apiKey: string,
  model: string,
): Promise<void> {
  await generateAIDraft({
    provider,
    apiKey,
    model,
    action: "draft",
    prompt: "Reply with a short Markdown draft titled 'Connection test'.",
    sectionScoped: false,
    includeCurrentDraft: false,
  });
}
