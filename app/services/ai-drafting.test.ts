import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NostrEvent } from "nostr-tools";
import { of } from "rxjs";

const publishMock = vi.hoisted(() =>
  vi.fn(async () => [{ ok: true, from: "mock-relay" }]),
);
const requestMock = vi.hoisted(() => vi.fn(() => of("EOSE")));
const profileLoaderMock = vi.hoisted(() => vi.fn(() => of(undefined)));

vi.mock("~/services/relay-pool", () => ({
  default: {
    publish: publishMock,
    request: requestMock,
  },
}));

vi.mock("~/services/loaders", () => ({
  profileLoader: profileLoaderMock,
}));

type LocalStorageMock = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

function createLocalStorageMock(): LocalStorageMock {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

function installWindowMock() {
  const localStorage = createLocalStorageMock();
  (globalThis as any).window = {
    localStorage,
  };
  return localStorage;
}

function createAccount() {
  const cipher = {
    encrypt: async (_pubkey: string, plaintext: string) => `enc:${plaintext}`,
    decrypt: async (_pubkey: string, ciphertext: string) => {
      if (!ciphertext.startsWith("enc:")) {
        throw new Error("Unexpected ciphertext");
      }
      return ciphertext.slice(4);
    },
  };

  return {
    pubkey: "a".repeat(64),
    nip04: cipher,
    nip44: cipher,
    signEvent: async (template: {
      kind: number;
      created_at: number;
      tags: string[][];
      content: string;
    }) =>
      ({
        ...template,
        id: "signed-event",
        sig: "signature",
        pubkey: "a".repeat(64),
      }) as NostrEvent,
  };
}

describe("ai drafting settings persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    publishMock.mockClear();
    requestMock.mockClear();
    profileLoaderMock.mockClear();
    installWindowMock();
  });

  it("round-trips encrypted settings through local cache and hydrate", async () => {
    const { saveAIDraftingSettings, hydrateAIDraftingSettings, loadAIDraftingSettings } =
      await import("./ai-drafting");
    const account = createAccount();
    const settings = {
      provider: "groq" as const,
      apiKey: "sk-test-123",
      model: "llama-3.3-70b-versatile",
    };

    await saveAIDraftingSettings(account, settings);
    expect(loadAIDraftingSettings(account.pubkey)).toEqual(settings);
    expect(publishMock).toHaveBeenCalledTimes(1);

    vi.resetModules();
    const reloaded = await import("./ai-drafting");
    const hydrated = await reloaded.hydrateAIDraftingSettings(account);

    expect(hydrated).toEqual(settings);
    expect(reloaded.loadAIDraftingSettings(account.pubkey)).toEqual(settings);
  });

  it("clears settings by publishing and caching defaults", async () => {
    const {
      saveAIDraftingSettings,
      clearAIDraftingSettings,
      hydrateAIDraftingSettings,
      loadAIDraftingSettings,
      getDefaultAIDraftingSettings,
    } = await import("./ai-drafting");
    const account = createAccount();

    await saveAIDraftingSettings(account, {
      provider: "groq",
      apiKey: "sk-test-123",
      model: "llama-3.3-70b-versatile",
    });
    expect(publishMock).toHaveBeenCalledTimes(1);
    await clearAIDraftingSettings(account);
    expect(publishMock).toHaveBeenCalledTimes(2);

    vi.resetModules();
    const reloaded = await import("./ai-drafting");
    const hydrated = await reloaded.hydrateAIDraftingSettings(account);

    expect(hydrated).toEqual(getDefaultAIDraftingSettings());
    expect(reloaded.loadAIDraftingSettings(account.pubkey)).toEqual(
      getDefaultAIDraftingSettings(),
    );
  });
});
