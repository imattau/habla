import { useEffect } from "react";
import { useEventStore, useObservableMemo } from "applesauce-react/hooks";
import { map } from "rxjs";
import { useRelays } from "~/hooks/nostr";
import { blossomServerListLoader } from "~/services/loaders";
import { BLOSSOM_SERVER_LIST_KIND } from "~/const";

const DEFAULT_BLOSSOM_SERVERS = [
  "https://blossom.band",
  "https://blossom.primal.net",
  "https://blossom.nostr.build",
  "https://nostrmedia.com",
  "https://blossom.azzamo.media",
];

function normalizeServer(server: string) {
  return server.replace(/\/$/, "");
}

function dedupeServers(servers: string[]) {
  return Array.from(new Set(servers.map(normalizeServer)));
}

/**
 * Hook to fetch the user's Blossom server list from kind:10063 events
 * Returns array of server URLs, with default server if none configured
 */
export function useBlossomServers(pubkey?: string) {
  const eventStore = useEventStore();
  const userRelays = useRelays(pubkey || "");

  // Get the replaceable event from the event store and extract servers
  const servers = useObservableMemo(() => {
    if (!pubkey) {
      return undefined;
    }

    return eventStore.replaceable(BLOSSOM_SERVER_LIST_KIND, pubkey).pipe(
      map((event) => {
        if (!event) {
          return DEFAULT_BLOSSOM_SERVERS;
        }

        // Extract server tags: ["server", "https://..."]
        const serverTags = event.tags
          .filter((tag) => tag[0] === "server" && tag[1])
          .map((tag) => normalizeServer(tag[1])); // Remove trailing slash

        // Return servers or default if none found
        return serverTags.length > 0
          ? dedupeServers(serverTags)
          : DEFAULT_BLOSSOM_SERVERS;
      }),
    );
  }, [pubkey]);

  // Load the event from relays
  useEffect(() => {
    if (!pubkey) return;

    const subscription = blossomServerListLoader({
      kind: BLOSSOM_SERVER_LIST_KIND,
      pubkey,
      relays: userRelays,
    }).subscribe();

    return () => subscription.unsubscribe();
  }, [pubkey, userRelays]);

  const normalizedServers = servers || DEFAULT_BLOSSOM_SERVERS;

  return {
    servers: normalizedServers,
    hasCustomServers:
      !!servers &&
      (normalizedServers.length !== DEFAULT_BLOSSOM_SERVERS.length ||
        normalizedServers.some(
          (server) => !DEFAULT_BLOSSOM_SERVERS.includes(server),
        )),
    isLoading: !servers && !!pubkey,
  };
}
