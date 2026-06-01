import { firstValueFrom, lastValueFrom, map, timeout, toArray } from "rxjs";
import { completeOnEose } from "applesauce-relay/operators";
import {
  getProfileContent,
  getTagValue,
  safeParse,
  type ProfileContent,
} from "applesauce-core/helpers";
import { kinds } from "nostr-tools";
import Database from "better-sqlite3";
import { type NostrEvent } from "nostr-tools";
import { isReplaceableKind } from "nostr-tools/kinds";
import { getRelayURLs } from "../lib/url";
import type { Relay, Pubkey } from "~/types";
import pool from "./relay-pool";
import { AGGREGATOR_RELAYS, INDEX_RELAYS } from "../const";
import type {
  ProfilePointer,
  EventPointer,
  AddressPointer,
} from "nostr-tools/nip19";
import type { DataStore, Nip05Data, Nip05Pointer, User } from "./types";
import path from "path";

// ============================================================================
// SQLite Cache
// ============================================================================

const dbPath = process.env.SQLITE_PATH || path.resolve("cache.db");
let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS hash_cache (
        key TEXT NOT NULL,
        field TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (key, field)
      );
      CREATE TABLE IF NOT EXISTS set_cache (
        key TEXT NOT NULL,
        member TEXT NOT NULL,
        PRIMARY KEY (key, member)
      );
    `);
    console.log(`[sqlite] ${dbPath}`);
  }
  return db;
}

function isAvailable() {
  try {
    getDb();
    return true;
  } catch {
    return false;
  }
}

function getEventTimelineKey(event: NostrEvent) {
  if (isReplaceableKind(event.kind)) {
    const identifier = getTagValue(event, "d") || "";
    return `${event.kind}:${event.pubkey}:${identifier}`;
  }

  return event.id;
}

function dedupeEvents(events: NostrEvent[]) {
  const seen = new Set<string>();
  const deduped: NostrEvent[] = [];

  for (const event of events) {
    const key = getEventTimelineKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(event);
  }

  return deduped;
}

// ============================================================================
// Generic SQLite Cache Utilities
// ============================================================================

function cacheValue<T>(key: string, value: T, ttlSeconds?: number): boolean {
  try {
    const expires_at = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    getDb()
      .prepare(
        "INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)",
      )
      .run(key, JSON.stringify(value), expires_at);
    return true;
  } catch (e) {
    console.warn(`[cache] failed to cache ${key}:`, e);
    return false;
  }
}

function getCachedValue<T>(key: string): T | null {
  try {
    const row = getDb()
      .prepare("SELECT value, expires_at FROM cache WHERE key = ?")
      .get(key) as { value: string; expires_at: number | null } | undefined;
    if (!row) return null;
    if (row.expires_at && row.expires_at < Date.now()) {
      getDb().prepare("DELETE FROM cache WHERE key = ?").run(key);
      return null;
    }
    return safeParse(row.value) ?? null;
  } catch (e) {
    console.warn(`[cache] failed to get ${key}:`, e);
    return null;
  }
}

function cacheHashField<T>(key: string, field: string, value: T): boolean {
  try {
    getDb()
      .prepare(
        "INSERT OR REPLACE INTO hash_cache (key, field, value) VALUES (?, ?, ?)",
      )
      .run(key, field, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn(`[cache] failed to cache hash ${key}:${field}:`, e);
    return false;
  }
}

function getCachedHashField<T>(key: string, field: string): T | null {
  try {
    const row = getDb()
      .prepare("SELECT value FROM hash_cache WHERE key = ? AND field = ?")
      .get(key, field) as { value: string } | undefined;
    return row ? (safeParse(row.value) ?? null) : null;
  } catch (e) {
    console.warn(`[cache] failed to get hash ${key}:${field}:`, e);
    return null;
  }
}

function getAllHashFields(key: string): Record<string, string> {
  try {
    const rows = getDb()
      .prepare("SELECT field, value FROM hash_cache WHERE key = ?")
      .all(key) as { field: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.field, r.value]));
  } catch (e) {
    console.warn(`[cache] failed to get all hash fields ${key}:`, e);
    return {};
  }
}

function setAdd(key: string, member: string): boolean {
  try {
    getDb()
      .prepare("INSERT OR IGNORE INTO set_cache (key, member) VALUES (?, ?)")
      .run(key, member);
    return true;
  } catch (e) {
    console.warn(`[cache] failed to add to set ${key}:`, e);
    return false;
  }
}

function setMembers(key: string): string[] {
  try {
    const rows = getDb()
      .prepare("SELECT member FROM set_cache WHERE key = ?")
      .all(key) as { member: string }[];
    return rows.map((r) => r.member);
  } catch (e) {
    console.warn(`[cache] failed to get set members ${key}:`, e);
    return [];
  }
}

function cacheMulti(operations: () => void): boolean {
  try {
    getDb().transaction(operations)();
    return true;
  } catch (e) {
    console.warn(`[cache] transaction failed:`, e);
    return false;
  }
}

// ============================================================================
// Cache Key Helpers
// ============================================================================

const RELAYS_KEY_PREFIX = "relays";
const PROFILE_KEY_PREFIX = "profile";
const EVENT_KEY_PREFIX = "event";
const ADDRESS_KEY_PREFIX = "address";
const ARTICLES_KEY_PREFIX = "articles";
const HIGHLIGHTS_KEY_PREFIX = "highlights";
const NIP05_NAMES = "nip05:names";
const NIP05_RELAYS = "nip05:relays";

function relaysKey(pubkey: string): string {
  return `${RELAYS_KEY_PREFIX}:${pubkey}`;
}

function profileKey(pubkey: string): string {
  return `${PROFILE_KEY_PREFIX}:${pubkey}`;
}

function eventKey(pointer: EventPointer): string {
  return `${EVENT_KEY_PREFIX}:${pointer.kind ?? kinds.ShortTextNote}:${pointer.id}`;
}

function addressKey(pointer: AddressPointer): string {
  return `${ADDRESS_KEY_PREFIX}:${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`;
}

function articlesKey(pubkey: Pubkey): string {
  return `${ARTICLES_KEY_PREFIX}:${pubkey}`;
}

function highlightsKey(limit: number): string {
  return `${HIGHLIGHTS_KEY_PREFIX}:${limit}`;
}

// ============================================================================
// Relay Cache
// ============================================================================

async function cacheNostrRelays(
  pubkey: string,
  relays: string[],
  username?: string,
): Promise<boolean> {
  const key = relaysKey(pubkey);
  const success = await cacheHashField(key, pubkey, relays);
  if (username) {
    await cacheNip05Relays(username, pubkey, relays);
  }
  return success;
}

function uniqueRelays(relays: string[]): string[] {
  return [...new Set(relays.filter(Boolean))];
}

export async function fetchRelays(pubkey: string, username?: string) {
  const cached = await getCachedHashField<string[]>(relaysKey(pubkey), pubkey);
  if (cached !== null) {
    console.log(`[fetch] cached relay list ${pubkey}`);
    return uniqueRelays(cached);
  }
  console.log(`[fetch] getting ${pubkey} relay list from nostr`);
  const relays = uniqueRelays(await fetchNostrRelays(pubkey, username));
  await cacheNostrRelays(pubkey, relays, username);
  return relays;
}

export async function syncRelays(pubkey: string, username?: string) {
  const startTime = Date.now();
  console.log(
    `[sync:relays] Starting sync for pubkey: ${pubkey}, username: ${username || "none"}`,
  );

  try {
    console.log(`[sync:relays] Fetching relay list from nostr for ${pubkey}`);
    const relays = uniqueRelays(await fetchNostrRelays(pubkey, username));
    console.log(
      `[sync:relays] Retrieved ${relays.length} relays: ${JSON.stringify(relays)}`,
    );

    console.log(`[sync:relays] Caching relays for ${pubkey}`);
    const cacheResult = await cacheNostrRelays(pubkey, relays, username);
    console.log(
      `[sync:relays] Cache operation ${cacheResult ? "successful" : "failed"} for ${pubkey}`,
    );

    const duration = Date.now() - startTime;
    console.log(`[sync:relays] Completed sync for ${pubkey} in ${duration}ms`);
    return relays;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(
      `[sync:relays] Error syncing relays for ${pubkey} after ${duration}ms:`,
      error,
    );
    throw error;
  }
}

export async function syncProfile(
  pubkey: string,
  relays?: string[],
): Promise<ProfileContent | undefined> {
  const startTime = Date.now();
  console.log(`[sync:profile] Starting sync for pubkey: ${pubkey}`);
  console.log(
    `[sync:profile] Using ${relays?.length || 0} specific relays: ${relays ? JSON.stringify(relays) : "none, using INDEX_RELAYS"}`,
  );

  try {
    console.log(`[sync:profile] Fetching profile from nostr for ${pubkey}`);
    const profile = await fetchNostrProfile(pubkey, relays);

    if (profile) {
      console.log(
        `[sync:profile] Retrieved profile for ${pubkey}: ${JSON.stringify(profile)}`,
      );

      console.log(`[sync:profile] Caching profile for ${pubkey}`);
      await cacheNostrProfile(pubkey, profile);
      console.log(`[sync:profile] Cache operation successful for ${pubkey}`);

      const duration = Date.now() - startTime;
      console.log(
        `[sync:profile] Completed sync for ${pubkey} in ${duration}ms`,
      );
      return profile;
    } else {
      console.log(`[sync:profile] No profile found for ${pubkey}`);
      const duration = Date.now() - startTime;
      console.log(
        `[sync:profile] Completed sync for ${pubkey} in ${duration}ms (no data)`,
      );
      return undefined;
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(
      `[sync:profile] Error syncing profile for ${pubkey} after ${duration}ms:`,
      error,
    );
    throw error;
  }
}

// ============================================================================
// Profile Cache
// ============================================================================

async function cacheNostrProfile(
  pubkey: string,
  profile: ProfileContent,
): Promise<boolean> {
  return cacheValue(profileKey(pubkey), profile);
}

async function getCachedProfile(
  pubkey: string,
): Promise<ProfileContent | null> {
  return getCachedValue<ProfileContent>(profileKey(pubkey));
}

// ============================================================================
// NIP-05 Cache
// ============================================================================

const INVALID_USERNAMES = new Set([
  "faq",
  "write",
  "support",
  "bookmarks",
  "admin",
  "nostr",
  "wallet",
  "trending",
  "latest",
  "settings",
  "profile",
  "login",
  "logout",
  "signup",
  "signin",
  "register",
  "api",
  "help",
  "about",
  "contact",
  "terms",
  "privacy",
]);

export async function getUsername(username: string): Promise<string | null> {
  return getCachedHashField<string>(NIP05_NAMES, username);
}

export async function saveUser({
  pubkey,
  username,
  relays,
}: {
  pubkey: Pubkey;
  username: string;
  relays: Relay[];
}): Promise<boolean> {
  return cacheMulti(() => {
    cacheHashField(NIP05_NAMES, username, pubkey);
    cacheHashField(NIP05_RELAYS, pubkey, relays);
  });
}

async function cacheNip05Relays(
  _username: string,
  pubkey: string,
  relays: string[],
): Promise<boolean> {
  return cacheHashField(NIP05_RELAYS, pubkey, relays);
}

export async function getNip05(): Promise<Nip05Data> {
  if (!isAvailable()) return { names: {}, relays: {} };

  try {
    const namesRaw = getAllHashFields(NIP05_NAMES);
    const relaysRaw = getAllHashFields(NIP05_RELAYS);

    const names: Record<string, string> = {};
    for (const [field, value] of Object.entries(namesRaw)) {
      names[field] = safeParse(value) ?? value;
    }

    const relays: Record<string, string[]> = {};
    for (const [pubkey, relaysJson] of Object.entries(relaysRaw)) {
      relays[pubkey] = safeParse(relaysJson) ?? [];
    }

    return { names, relays };
  } catch (e) {
    console.warn("[cache] failed to get nip05 data:", e);
    return { names: {}, relays: {} };
  }
}

export async function getMembers(): Promise<Nip05Pointer[]> {
  const { names, relays } = await getNip05();

  return Object.entries(names).map((kv) => {
    const [nip05, pubkey] = kv;

    return { nip05, pubkey, relays: relays[pubkey] || [] };
  });
}

// TODO: get members with full profile info: { username, pubkey, profile }

export async function getUsers(): Promise<User[]> {
  if (!isAvailable()) return [];
  try {
    const raw = getAllHashFields(NIP05_NAMES);
    const results = await Promise.allSettled(
      Object.entries(raw).map(async ([username, pubkey]) => {
        pubkey = safeParse(pubkey) ?? pubkey;
        const profile = await fetchProfile({ pubkey });
        if (profile) return { username, pubkey, profile };
        throw new Error(
          `profile for ${username} with pubkey ${pubkey} not found`,
        );
      }),
    );
    return results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  } catch (e) {
    console.warn("[cache] failed to get users:", e);
    return [];
  }
}

export async function getArticles(
  pointer: Nip05Pointer,
): Promise<NostrEvent[]> {
  if (!isAvailable()) return [];
  try {
    const { pubkey } = pointer;
    const identifiers = setMembers(articlesKey(pubkey));
    if (identifiers.length === 0) return [];
    return identifiers
      .map((identifier) =>
        getCachedValue<NostrEvent>(
          addressKey({ pubkey, kind: kinds.LongFormArticle, identifier }),
        ),
      )
      .filter(Boolean) as NostrEvent[];
  } catch (e) {
    console.warn(`[cache] failed to get articles for ${pointer.pubkey}:`, e);
    return [];
  }
}

export async function fetchArticles({
  pubkey,
  nip05,
}: Nip05Pointer): Promise<NostrEvent[]> {
  const relays = uniqueRelays(await fetchRelays(pubkey, nip05));
  return fetchNostrArticles(
    pubkey,
    uniqueRelays(AGGREGATOR_RELAYS.concat(relays)),
  );
}

// ============================================================================
// Event/Address Cache
// ============================================================================

async function getCachedAddress(
  pointer: AddressPointer,
): Promise<NostrEvent | undefined> {
  const cached = await getCachedValue<NostrEvent>(addressKey(pointer));
  return cached ?? undefined;
}

async function cacheAddress(
  pointer: AddressPointer,
  event: NostrEvent,
): Promise<boolean> {
  return cacheValue(addressKey(pointer), event);
}

async function getCachedEvent(
  pointer: EventPointer,
): Promise<NostrEvent | undefined> {
  const cached = await getCachedValue<NostrEvent>(eventKey(pointer));
  return cached ?? undefined;
}

async function cacheEvent(
  pointer: EventPointer,
  event: NostrEvent,
): Promise<boolean> {
  return cacheValue(eventKey(pointer), event);
}

async function cacheArticle(
  pointer: AddressPointer,
  article: NostrEvent,
): Promise<boolean> {
  return cacheMulti(() => {
    cacheValue(addressKey(pointer), article);
    setAdd(articlesKey(article.pubkey), pointer.identifier);
  });
}

export async function syncArticles({
  pubkey,
  nip05,
}: Nip05Pointer): Promise<NostrEvent[]> {
  const startTime = Date.now();
  console.log(
    `[sync:articles] Starting sync for pubkey: ${pubkey}, nip05: ${nip05}`,
  );

  try {
    console.log(`[sync:articles] Fetching relays for ${pubkey}`);
    const relays = uniqueRelays(await fetchRelays(pubkey, nip05));
    console.log(
      `[sync:articles] Retrieved ${relays.length} relays: ${JSON.stringify(relays)}`,
    );

    const combinedRelays = uniqueRelays(AGGREGATOR_RELAYS.concat(relays));
    console.log(
      `[sync:articles] Using ${combinedRelays.length} total relays (${AGGREGATOR_RELAYS.length} aggregator + ${relays.length} user): ${JSON.stringify(combinedRelays)}`,
    );

    console.log(`[sync:articles] Fetching articles from nostr for ${pubkey}`);
    const articles = await fetchNostrArticles(pubkey, combinedRelays);
    console.log(
      `[sync:articles] Retrieved ${articles.length} articles for ${pubkey}`,
    );

    if (articles.length > 0) {
      console.log(`[sync:articles] Article details:`);
      articles.forEach((article, index) => {
        const identifier = getTagValue(article, "d") || "";
        const title = getTagValue(article, "title") || "Untitled";
        console.log(
          `  [${index + 1}] ID: ${article.id}, Identifier: ${identifier}, Title: ${title}, Created: ${new Date(article.created_at * 1000).toISOString()}`,
        );
      });
    }

    console.log(`[sync:articles] Caching ${articles.length} articles`);
    const cacheResults = await Promise.allSettled(
      articles.map(async (article, index) => {
        const address = {
          kind: kinds.LongFormArticle,
          pubkey: article.pubkey,
          identifier: getTagValue(article, "d"),
        };
        console.log(
          `[sync:articles] Caching article ${index + 1}/${articles.length}: ${address.identifier}`,
        );
        if (address.identifier && address.identifier.trim().length > 0) {
          return cacheArticle(
            { ...address, identifier: address.identifier as string },
            article,
          );
        }
      }),
    );

    const successful = cacheResults.filter(
      (result) => result.status === "fulfilled",
    ).length;
    const failed = cacheResults.filter(
      (result) => result.status === "rejected",
    ).length;
    console.log(
      `[sync:articles] Cache results: ${successful} successful, ${failed} failed`,
    );

    if (failed > 0) {
      const failures = cacheResults
        .map((result, index) => ({ result, index }))
        .filter(({ result }) => result.status === "rejected")
        .map(
          ({ result, index }) =>
            `Article ${index + 1}: ${(result as PromiseRejectedResult).reason}`,
        );
      console.warn(`[sync:articles] Cache failures:`, failures);
    }

    const duration = Date.now() - startTime;
    console.log(
      `[sync:articles] Completed sync for ${pubkey} in ${duration}ms - ${articles.length} articles processed`,
    );
    return articles;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(
      `[sync:articles] Error syncing articles for ${pubkey} after ${duration}ms:`,
      error,
    );
    throw error;
  }
}

async function fetchNostrRelays(
  pubkey: string,
  username?: string,
): Promise<string[]> {
  return lastValueFrom(
    pool
      .req(INDEX_RELAYS, {
        kinds: [kinds.RelayList],
        authors: [pubkey],
        limit: 1,
      })
      .pipe(
        timeout(10_000),
        completeOnEose(),
        map((ev) => getRelayURLs(ev).filter((r) => !r.startsWith("ws://"))),
      ),
    { defaultValue: [] },
  );
}

async function fetchNostrProfile(
  pubkey: string,
  relays?: string[],
): Promise<ProfileContent | undefined> {
  return lastValueFrom(
    pool
      .req(uniqueRelays(INDEX_RELAYS.concat(relays ?? [])), {
        kinds: [kinds.Metadata],
        authors: [pubkey],
        limit: 1,
      })
      .pipe(timeout(10_000), completeOnEose(), map(getProfileContent)),
    { defaultValue: undefined },
  );
}

function fetchNostrAddress(
  pointer: AddressPointer,
): Promise<NostrEvent | undefined> {
  const { kind, pubkey, relays, identifier } = pointer;
  return firstValueFrom(
    pool
      .req(uniqueRelays(AGGREGATOR_RELAYS.concat(relays || [])), {
        kinds: [kind],
        authors: [pubkey],
        "#d": [identifier],
      })
      .pipe(timeout(10_000), completeOnEose()),
    { defaultValue: undefined },
  );
}

function fetchNostrEvent(
  pointer: EventPointer,
): Promise<NostrEvent | undefined> {
  const { kind, author, id, relays } = pointer;
  return lastValueFrom(
    pool
      .req(uniqueRelays(AGGREGATOR_RELAYS.concat(relays || [])), {
        ids: [id],
        ...(kind ? { kinds: [kind] } : { kinds: [kinds.ShortTextNote] }),
        ...(author ? { authors: [author] } : {}),
      })
      .pipe(timeout(10_000), completeOnEose()),
    { defaultValue: undefined },
  );
}

function fetchNostrArticles(pubkey: string, relays: string[]) {
  return lastValueFrom(
    pool
      .req(uniqueRelays(relays), {
        kinds: [kinds.LongFormArticle],
        authors: [pubkey],
      })
      .pipe(timeout(10_000), completeOnEose(), toArray()),
  ).then(dedupeEvents);
}

function fetchNostrArticlesByTag(
  tag: string,
  relays: string[],
  limit: number = 50,
  until?: number,
) {
  return lastValueFrom(
    pool
      .req(uniqueRelays(relays), {
        kinds: [kinds.LongFormArticle],
        "#t": [tag],
        limit,
        until,
      })
      .pipe(timeout(10_000), completeOnEose(), toArray()),
  ).then(dedupeEvents);
}

function fetchNostrHighlights(limit: number = 12) {
  return lastValueFrom(
    pool
      .req(uniqueRelays(AGGREGATOR_RELAYS), {
        kinds: [kinds.Highlights],
        limit,
      })
      .pipe(timeout(10_000), completeOnEose(), toArray()),
    { defaultValue: [] },
  );
}

export async function fetchArticlesByTag(
  tag: string,
  limit: number = 50,
  until?: number,
): Promise<NostrEvent[]> {
  const cacheKey = `articles:tag:${tag}:limit:${limit}:until:${until || "latest"}`;
  const cached = getCachedValue<NostrEvent[]>(cacheKey);
  if (cached) return dedupeEvents(cached);

  const articles = dedupeEvents(
    await fetchNostrArticlesByTag(tag, AGGREGATOR_RELAYS, limit, until),
  );

  cacheValue(cacheKey, articles, 300);

  return articles;
}

export async function fetchHighlights(limit: number = 12): Promise<NostrEvent[]> {
  const cacheKey = highlightsKey(limit);
  const cached = getCachedValue<NostrEvent[]>(cacheKey);
  if (cached) return cached;

  const highlights = (await fetchNostrHighlights(limit)).sort(
    (a, b) => b.created_at - a.created_at,
  );
  cacheValue(cacheKey, highlights, 300);

  return highlights;
}

// Loader API

export async function fetchProfile(
  pointer: ProfilePointer,
): Promise<ProfileContent | undefined> {
  const { pubkey } = pointer;
  const cached = await getCachedProfile(pubkey);
  if (cached) {
    console.log(
      `[fetch] cached profile ${pubkey}} : ${JSON.stringify(cached)}`,
    );
    return cached;
  }
  console.log(`[fetch] getting ${pubkey} profile from nostr`);
  const profile = await fetchNostrProfile(pubkey);
  if (profile) {
    await cacheNostrProfile(pubkey, profile);
    return profile;
  }
}

export async function fetchAddress(pointer: AddressPointer) {
  const cached = await getCachedAddress(pointer);
  if (cached) {
    return cached;
  }
  const nostr = await fetchNostrAddress(pointer);
  if (nostr) {
    await cacheAddress(pointer, nostr);
    return nostr;
  }
}

export async function fetchEvent(pointer: EventPointer) {
  const cached = await getCachedEvent(pointer);
  if (cached) {
    return cached;
  }
  const event = await fetchNostrEvent(pointer);
  if (event) {
    await cacheEvent(pointer, event);
    return event;
  }
}

const store: DataStore = {
  getMembers,
  getUsers,
  fetchHighlights,
  fetchRelays,
  fetchProfile,
  fetchAddress,
  fetchEvent,
};

export default store;
