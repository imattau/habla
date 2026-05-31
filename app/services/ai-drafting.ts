import { safeParse } from "applesauce-core/helpers/json";
import { firstValueFrom, toArray } from "rxjs";
import { kinds, type NostrEvent } from "nostr-tools";
import { AGGREGATOR_RELAYS } from "~/const";
import { getRelayURLs } from "~/lib/url";
import { profileLoader } from "~/services/loaders";
import pool from "~/services/relay-pool";

export type AIProvider = "openai" | "groq";

export interface AIDraftingSettings {
  provider: AIProvider;
  apiKey: string;
  model: string;
}

export type AIDraftAction =
  | "draft"
  | "rewrite"
  | "concise"
  | "expand"
  | "summary";

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
  generateTags?: boolean;
  tagCount?: number;
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

export interface AvailableModel {
  id: string;
  ownedBy?: string;
}

type AIDraftingSettingsEnvelope = {
  version: 1;
  settings: AIDraftingSettings;
  updatedAt: number;
};

type EncryptedAIDraftingSettingsEvent = NostrEvent;

type EncryptedSigner = {
  pubkey: string;
  nip04?: {
    encrypt: (pubkey: string, plaintext: string) => Promise<string>;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
  };
  nip44?: {
    encrypt: (pubkey: string, plaintext: string) => Promise<string>;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
  };
  signEvent: (template: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }) => Promise<NostrEvent>;
};

export type AIDraftingAccount = EncryptedSigner;

const SETTINGS_KIND = 30_078;
const SETTINGS_IDENTIFIER = "ai-drafting";
const SETTINGS_CACHE_KEY = "habla:ai-drafting:encrypted";

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: "gpt-4.1-mini",
  groq: "llama-3.3-70b-versatile",
};

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: "OpenAI",
  groq: "Groq",
};

const settingsCache = new Map<string, AIDraftingSettings>();
const hydrationInFlight = new Map<string, Promise<AIDraftingSettings>>();

function encryptedStorageKey(pubkey: string): string {
  return `${SETTINGS_CACHE_KEY}:${pubkey}`;
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

function normalizeAIDraftingSettings(
  settings: Partial<AIDraftingSettings> | null | undefined,
): AIDraftingSettings {
  const provider =
    settings?.provider === "groq" || settings?.provider === "openai"
      ? settings.provider
      : "openai";

  return {
    provider,
    apiKey: settings?.apiKey?.trim() || "",
    model: settings?.model?.trim() || DEFAULT_MODELS[provider],
  };
}

function getEncryptionMethods(account: EncryptedSigner) {
  return account.nip44 ?? account.nip04 ?? null;
}

function getDefaultEnvelope(
  settings: AIDraftingSettings = getDefaultAIDraftingSettings(),
): AIDraftingSettingsEnvelope {
  return {
    version: 1,
    settings,
    updatedAt: Date.now(),
  };
}

function readEncryptedSettingsEvent(
  pubkey: string,
): EncryptedAIDraftingSettingsEvent | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(encryptedStorageKey(pubkey));
  if (!raw) return null;

  const parsed = safeParse(raw) as EncryptedAIDraftingSettingsEvent | null;
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.kind !== SETTINGS_KIND) return null;
  return parsed;
}

function saveEncryptedSettingsEvent(
  pubkey: string,
  event: EncryptedAIDraftingSettingsEvent,
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(encryptedStorageKey(pubkey), JSON.stringify(event));
}

function clearEncryptedSettingsEvent(pubkey: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(encryptedStorageKey(pubkey));
}

function storeCachedSettings(
  pubkey: string,
  settings: AIDraftingSettings,
): AIDraftingSettings {
  const normalized = normalizeAIDraftingSettings(settings);
  settingsCache.set(pubkey, normalized);
  return normalized;
}

export function loadAIDraftingSettings(pubkey: string): AIDraftingSettings {
  return settingsCache.get(pubkey) || getDefaultAIDraftingSettings();
}

export function hasLoadedAIDraftingSettings(pubkey: string): boolean {
  return settingsCache.has(pubkey);
}

async function fetchUserRelays(pubkey: string): Promise<string[]> {
  try {
    const event = await firstValueFrom(profileLoader({ kind: kinds.RelayList, pubkey }));
    return event ? getRelayURLs(event) : [];
  } catch (error) {
    console.warn("[ai-drafting] Failed to load relay list:", error);
    return [];
  }
}

async function fetchSettingsEvent(pubkey: string): Promise<NostrEvent | null> {
  const relays = [...new Set([...AGGREGATOR_RELAYS, ...(await fetchUserRelays(pubkey))])];
  try {
    const events = await firstValueFrom(
      pool
        .request(relays, {
          kinds: [SETTINGS_KIND],
          authors: [pubkey],
          "#d": [SETTINGS_IDENTIFIER],
          limit: 10,
        })
        .pipe(toArray()),
    );

    const latest = [...events].sort((a, b) => b.created_at - a.created_at)[0];
    return latest || null;
  } catch (error) {
    console.warn("[ai-drafting] Failed to fetch remote settings:", error);
    return null;
  }
}

async function getSettingsRelays(pubkey: string): Promise<string[]> {
  return [...new Set([...AGGREGATOR_RELAYS, ...(await fetchUserRelays(pubkey))])];
}

async function decryptSettingsEvent(
  account: EncryptedSigner,
  event: EncryptedAIDraftingSettingsEvent,
): Promise<AIDraftingSettings | null> {
  const methods = [];
  if (account.nip44) methods.push(account.nip44);
  if (account.nip04) methods.push(account.nip04);

  for (const method of methods) {
    try {
      const plaintext = await method.decrypt(account.pubkey, event.content);
      const parsed = safeParse(plaintext) as AIDraftingSettingsEnvelope | null;
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.version === 1 &&
        parsed.settings
      ) {
        return normalizeAIDraftingSettings(parsed.settings);
      }
    } catch (error) {
      // Try the next cipher.
      console.debug("[ai-drafting] Failed to decrypt settings event:", error);
    }
  }

  return null;
}

function getCachedEncryptedSettings(
  pubkey: string,
): EncryptedAIDraftingSettingsEvent | null {
  return readEncryptedSettingsEvent(pubkey);
}

export async function hydrateAIDraftingSettings(
  account: EncryptedSigner,
  options: { force?: boolean } = {},
): Promise<AIDraftingSettings> {
  const existing = settingsCache.get(account.pubkey);
  if (existing && !options.force) return existing;

  const inFlight = hydrationInFlight.get(account.pubkey);
  if (inFlight) return inFlight;

  const task = (async () => {
    let cachedSettings: AIDraftingSettings | null = null;
    const cachedEvent = getCachedEncryptedSettings(account.pubkey);
    if (cachedEvent) {
      const decrypted = await decryptSettingsEvent(account, cachedEvent);
      if (decrypted) {
        cachedSettings = storeCachedSettings(account.pubkey, decrypted);
        if (!options.force) {
          return cachedSettings;
        }
      }
    }

    const remoteEvent = await fetchSettingsEvent(account.pubkey);
    if (remoteEvent) {
      const decrypted = await decryptSettingsEvent(account, remoteEvent);
      if (decrypted) {
        saveEncryptedSettingsEvent(account.pubkey, remoteEvent);
        return storeCachedSettings(account.pubkey, decrypted);
      }
    }

    return (
      cachedSettings ||
      storeCachedSettings(account.pubkey, getDefaultAIDraftingSettings())
    );
  })();

  hydrationInFlight.set(account.pubkey, task);
  try {
    return await task;
  } finally {
    hydrationInFlight.delete(account.pubkey);
  }
}

async function publishSettingsEvent(
  account: EncryptedSigner,
  settings: AIDraftingSettings,
): Promise<NostrEvent> {
  const envelope = JSON.stringify(getDefaultEnvelope(normalizeAIDraftingSettings(settings)));
  const cipher = getEncryptionMethods(account);
  if (!cipher) {
    throw new Error("Your account does not support encrypted settings sync");
  }

  const content = await cipher.encrypt(account.pubkey, envelope);
  const event = await account.signEvent({
    kind: SETTINGS_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", SETTINGS_IDENTIFIER]],
    content,
  });
  const relays = await getSettingsRelays(account.pubkey);
  const publishResults = await pool.publish(relays, event);
  if (!publishResults.some((result) => result.ok)) {
    throw new Error("Failed to publish AI draft settings to relays");
  }
  return event;
}

export async function saveAIDraftingSettings(
  account: EncryptedSigner,
  settings: AIDraftingSettings,
): Promise<void> {
  const normalized = normalizeAIDraftingSettings(settings);
  const event = await publishSettingsEvent(account, normalized);
  saveEncryptedSettingsEvent(account.pubkey, event);
  storeCachedSettings(account.pubkey, normalized);
}

export async function clearAIDraftingSettings(
  account: EncryptedSigner,
): Promise<void> {
  const defaults = getDefaultAIDraftingSettings();
  const event = await publishSettingsEvent(account, defaults);
  clearEncryptedSettingsEvent(account.pubkey);
  saveEncryptedSettingsEvent(account.pubkey, event);
  storeCachedSettings(account.pubkey, defaults);
}

function providerEndpoint(provider: AIProvider): string {
  return provider === "groq"
    ? "https://api.groq.com/openai/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
}

function providerModelsEndpoint(provider: AIProvider): string {
  return provider === "groq"
    ? "https://api.groq.com/openai/v1/models"
    : "https://api.openai.com/v1/models";
}

function actionInstruction(action: AIDraftAction): string {
  switch (action) {
    case "rewrite":
      return "Rewrite the provided text while preserving meaning and voice.";
    case "concise":
      return "Make the provided text more concise without losing important meaning.";
    case "expand":
      return "Expand the provided text with useful detail, examples, and clearer transitions.";
    case "summary":
      return "Write a short summary of the provided article.";
    case "draft":
    default:
      return "Write a fresh article draft from the user's request.";
  }
}

function buildSystemPrompt(
  includeCurrentDraft: boolean,
  action: AIDraftAction,
  sectionScoped: boolean,
  generateTags: boolean,
  tagCount: number,
): string {
  const scopeInstructions = sectionScoped
    ? [
        "Rewrite only the provided section.",
        "Return only Markdown for that section.",
        "Do not add a title, heading, or preamble.",
        "Do not add hashtags or article-level tags.",
      ]
    : [
        action === "summary"
          ? "Return a short summary only, as plain prose without Markdown formatting."
          : "The first line must be a single H1 title.",
        action === "summary"
          ? "Keep the summary concise, accurate, and grounded in the source article."
          : "Return a complete article draft in Markdown.",
      ];

  const tagInstructions =
    generateTags && !sectionScoped
      ? [
          `Append ${tagCount} relevant hashtags at the very end of the article.`,
          "Use lowercase hashtags that are directly relevant to the article.",
          "Place the hashtags on their own final line, separated by spaces.",
          "Do not add any explanation around the hashtags.",
        ]
      : [];

  return [
    "You are an expert article drafting assistant for a long-form publishing app.",
    action === "summary"
      ? "Return only plain text."
      : "Return only Markdown.",
    "Do not wrap the response in code fences.",
    "Do not add commentary or preambles.",
    actionInstruction(action),
    includeCurrentDraft
      ? "Use the provided draft as context and improve it while preserving the author's intent."
      : "Use only the prompt and supplied excerpt as needed.",
    ...scopeInstructions,
    ...tagInstructions,
  ].join(" ");
}

function buildUserPrompt({
  action,
  prompt,
  currentMarkdown,
  currentTitle,
  includeCurrentDraft,
  generateTags,
  tagCount,
  sectionScoped,
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
    action === "summary"
      ? "Output a single short summary paragraph with no bullets, no title, and no extra explanation."
      : "Output a polished article in Markdown with a clear title, structured sections, and no extraneous explanation.",
  );

  if (generateTags && !sectionScoped) {
    parts.push(
      `Add exactly ${tagCount} relevant hashtags at the end of the article.`,
      "Keep the hashtags lowercase, concise, and directly related to the article content.",
    );
  }

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
      temperature: input.action === "summary" ? 0.3 : 0.7,
      max_tokens: input.action === "summary" ? 160 : 1200,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(
            Boolean(input.includeCurrentDraft),
            input.action,
            Boolean(input.sectionScoped),
            Boolean(input.generateTags),
            input.tagCount ?? 5,
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

export async function fetchAvailableModels(
  provider: AIProvider,
  apiKey: string,
): Promise<AvailableModel[]> {
  const response = await fetch(providerModelsEndpoint(provider), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        error?: { message?: string };
        data?: Array<{ id?: string; owned_by?: string }>;
      }
    | null;

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        `Failed to load models with status ${response.status}`,
    );
  }

  const models: AvailableModel[] = [];
  for (const model of payload?.data || []) {
    if (!model.id) continue;
    models.push({
      id: model.id,
      ownedBy: model.owned_by,
    });
  }

  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
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
