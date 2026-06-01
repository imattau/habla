import { firstValueFrom, lastValueFrom, toArray, timeout } from "rxjs";
import type { NostrEvent } from "nostr-tools";
import { kinds } from "nostr-tools";
import type {
  ProfilePointer,
  EventPointer,
  AddressPointer,
} from "nostr-tools/nip19";
import type { ProfileContent } from "applesauce-core/helpers";
import { profileLoader, eventLoader, addressLoader } from "./loaders";
import { getProfileContent } from "applesauce-core/helpers";
import { type DataStore } from "./types";
import { getUsers, getMembers } from "~/lib/api";
import type { Pubkey, Relay } from "~/types";
import { getRelayURLs } from "~/lib/url";
import { AGGREGATOR_RELAYS } from "~/const";
import { completeOnEose } from "applesauce-relay/operators";
import pool from "~/services/relay-pool";

function fetchProfile(
  pointer: ProfilePointer,
): Promise<ProfileContent | undefined> {
  return firstValueFrom(
    profileLoader({ kind: kinds.Metadata, ...pointer }),
  ).then(getProfileContent);
}

function fetchRelays(pubkey: Pubkey): Promise<Relay[]> {
  return firstValueFrom(profileLoader({ kind: kinds.RelayList, pubkey })).then(
    getRelayURLs,
  );
}

function fetchEvent(pointer: EventPointer): Promise<NostrEvent | undefined> {
  return firstValueFrom(eventLoader(pointer));
}

function fetchAddress(
  pointer: AddressPointer,
): Promise<NostrEvent | undefined> {
  return firstValueFrom(addressLoader(pointer));
}

function fetchHighlights(limit: number = 12): Promise<NostrEvent[]> {
  return lastValueFrom(
    pool
      .req(AGGREGATOR_RELAYS, {
        kinds: [kinds.Highlights],
        limit,
      })
      .pipe(timeout(10_000), completeOnEose(), toArray()),
    { defaultValue: [] },
  ).then((highlights) => highlights.sort((a, b) => b.created_at - a.created_at));
}

const store: DataStore = {
  getMembers,
  getUsers,
  fetchHighlights,
  fetchRelays,
  fetchProfile,
  fetchEvent,
  fetchAddress,
};

export default store;
