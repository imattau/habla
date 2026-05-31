import { kinds } from "nostr-tools";
import { buildBaseSeoTags } from "~/seo";
import ClientOnly from "~/ui/client-only";
import { useActiveAccount, useEventStore, useObservableMemo } from "applesauce-react/hooks";
import { useRelays, useTimeline } from "~/hooks/nostr";
import Bookmarks from "~/ui/nostr/bookmarks";

export function meta() {
  return buildBaseSeoTags({
    title: "Bookmarks",
    description: "Manage your bookmarks",
    url: "https://habla.news/bookmarks",
    type: "website",
  });
}

function BookmarksView() {
  const account = useActiveAccount();
  const eventStore = useEventStore();
  const relays = useRelays(account?.pubkey || "");
  const { isLoading } = useTimeline(
    `${account?.pubkey || "anonymous"}-bookmarks-page`,
    account?.pubkey
      ? {
          kinds: [kinds.BookmarkList],
          authors: [account.pubkey],
        }
      : {
          kinds: [kinds.BookmarkList],
          authors: [],
        },
    relays,
    {
      limit: 1,
    },
  );
  const bookmark = useObservableMemo(() => {
    if (!account?.pubkey) return undefined;
    return eventStore.replaceable(kinds.BookmarkList, account.pubkey);
  }, [account?.pubkey]);

  if (!account) {
    return (
      <div className="w-full max-w-3xl mx-auto flex flex-col gap-4 py-8">
        <h1 className="text-3xl font-light uppercase tracking-wide">
          Bookmarks
        </h1>
        <p className="text-muted-foreground">
          Connect your account to view and manage your bookmarks.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-6 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-light uppercase tracking-wide">
          Bookmarks
        </h1>
        <p className="text-muted-foreground">
          {isLoading && !bookmark
            ? "Loading your bookmark list..."
            : "Saved articles, notes, links, and tags."}
        </p>
      </div>
      <Bookmarks bookmark={bookmark} title="My Bookmarks" />
    </div>
  );
}

export default function BookmarksPage() {
  return <ClientOnly>{() => <BookmarksView />}</ClientOnly>;
}
