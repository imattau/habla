import { useMemo, useState } from "react";
import { firstValueFrom } from "rxjs";
import { kinds } from "nostr-tools";
import { getProfilePointersFromList, getTagValue } from "applesauce-core/helpers";
import type { Route } from "./+types/feed";
import { INDEX_RELAYS } from "~/const";
import { buildBaseSeoTags } from "~/seo";
import {
  useActionHub,
  useActiveAccount,
  useEventStore,
} from "applesauce-react/hooks";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import ClientOnly from "~/ui/client-only";
import { Button } from "~/ui/button";
import Feed, { type FeedComponent } from "~/ui/nostr/feed";
import NostrCard from "~/ui/nostr/card";
import { PureHighlight } from "~/ui/nostr/highlight";
import ArticleCard from "~/ui/nostr/article-card";
import { useMyCircleAuthors, useRelays, useTimeline } from "~/hooks/nostr";
import { publishToRelays } from "~/services/publish-article";
import {
  SyncMyCircle,
  MY_CIRCLE_LIST_IDENTIFIER,
} from "~/nostr/my-circle";

const components: Record<number, FeedComponent> = {
  [kinds.Highlights]: ({ event, relationship }) => (
    <NostrCard
      className="border-none bg-transparent"
      noFooter
      event={event}
      relationship={relationship}
    >
      <PureHighlight event={event} relationship={relationship} />
    </NostrCard>
  ),
  [kinds.LongFormArticle]: ({ event, relationship }) => (
    <ArticleCard
      article={event}
      relationship={relationship}
      address={{
        kind: event.kind,
        pubkey: event.pubkey,
        identifier: getTagValue(event, "d") || "",
      }}
    />
  ),
};

export function meta() {
  return buildBaseSeoTags({
    title: "Feed",
    description: "Recent articles and highlights across Habla",
    url: "https://habla.news/feed",
  });
}

type FeedView = "global" | "circle";

function FeedState({
  title,
  description,
  actionLabel,
  onAction,
  actionDisabled,
  actionLoading,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  actionLoading?: boolean;
}) {
  return (
    <div className="rounded-lg border border-dotted border-muted-foreground/40 p-6 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="font-serif font-light text-3xl">{title}</h2>
        <p className="text-muted-foreground">{description}</p>
      </div>
      {onAction && actionLabel ? (
        <div>
          <Button type="button" onClick={onAction} disabled={actionDisabled}>
            {actionLoading ? "Refreshing..." : actionLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function GlobalFeedView() {
  return (
    <Feed
      id="global-feed"
      relays={INDEX_RELAYS}
      filters={{
        kinds: [kinds.LongFormArticle, kinds.Highlights],
      }}
      components={components}
      className="grid-cols-1 gap-6 md:grid-cols-1 md:gap-8"
      showSeparator
      showRelationshipBadges
    />
  );
}

function CircleFeedView() {
  const account = useActiveAccount();
  const hub = useActionHub();
  const eventStore = useEventStore();
  const relays = useRelays(account?.pubkey || "");
  const circleGraph = useMyCircleAuthors(account?.pubkey);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const circleListTimeline = useTimeline(
    `${account?.pubkey || "anon"}-${MY_CIRCLE_LIST_IDENTIFIER}`,
    {
      kinds: [kinds.Followsets],
      authors: account?.pubkey ? [account.pubkey] : [],
      "#d": [MY_CIRCLE_LIST_IDENTIFIER],
    },
    INDEX_RELAYS,
    { limit: 1 },
  );

  const circleList = circleListTimeline.timeline?.[0];
  const circleAuthors = useMemo(() => {
    if (!circleList) return [];
    return [...new Set(
      getProfilePointersFromList(circleList, "public").map(
        (pointer) => pointer.pubkey,
      ),
    )]
      .filter(Boolean)
      .filter((pubkey) => pubkey !== account?.pubkey);
  }, [account?.pubkey, circleList]);

  async function refreshCircle() {
    if (!account) return;
    if (circleGraph.isLoading) {
      toast.info("Still loading your follow graph", {
        description: "Try refreshing My Circle again in a moment.",
      });
      return;
    }
    if (relays.length === 0) {
      toast.error("No publish relays available", {
        description: "Add relays to your profile before refreshing My Circle.",
      });
      return;
    }

    setIsRefreshing(true);
    try {
      const signedEvent = await firstValueFrom(
        hub.exec(SyncMyCircle, circleGraph.authors),
      );

      if (!signedEvent) {
        throw new Error("Failed to sign My Circle list");
      }

      eventStore.add(signedEvent);

      const publishResult = await publishToRelays(signedEvent, relays);
      if (publishResult.successCount === 0) {
        throw new Error("Failed to publish My Circle list");
      }

      toast.success("My Circle refreshed");
    } catch (error) {
      console.error(error);
      toast.error("Failed to refresh My Circle", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setIsRefreshing(false);
    }
  }

  if (!account) {
    return (
      <FeedState
        title="Log in to use My Circle"
        description="My Circle is built from the people you follow and the people they directly follow."
      />
    );
  }

  if (circleListTimeline.isLoading && !circleList) {
    return (
      <FeedState
        title="Loading My Circle"
        description="Checking for your published My Circle list."
        actionLabel="Refresh My Circle"
        onAction={refreshCircle}
        actionDisabled={isRefreshing || circleGraph.isLoading}
        actionLoading={isRefreshing}
      />
    );
  }

  if (circleAuthors.length === 0) {
    return (
      <FeedState
        title="My Circle is empty"
        description="Refresh the list after you follow a few people, or after the people you follow change who they follow."
        actionLabel="Refresh My Circle"
        onAction={refreshCircle}
        actionDisabled={isRefreshing || circleGraph.isLoading}
        actionLoading={isRefreshing}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-row items-center justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={refreshCircle}
          disabled={isRefreshing || circleGraph.isLoading}
        >
          {isRefreshing ? "Refreshing..." : "Refresh My Circle"}
        </Button>
      </div>
      <Feed
        id={`${account.pubkey}-${circleList?.id || MY_CIRCLE_LIST_IDENTIFIER}`}
        relays={INDEX_RELAYS}
        filters={{
          authors: circleAuthors,
          kinds: [kinds.LongFormArticle, kinds.Highlights],
      }}
      components={components}
      className="grid-cols-1 gap-6 md:grid-cols-1 md:gap-8"
      showSeparator
      showRelationshipBadges
    />
  </div>
  );
}

function FeedPage() {
  const [searchParams] = useSearchParams();
  const view = (searchParams.get("view") === "circle"
    ? "circle"
    : "global") as FeedView;

  return (
    <div className="flex flex-col gap-8 w-full py-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif font-light text-5xl">
          {view === "circle" ? "My Circle" : "Global Feed"}
        </h1>
        <p className="text-muted-foreground">
          {view === "circle"
            ? "People you follow, plus the people they directly follow."
            : "Recent articles and highlights across Habla."}
        </p>
      </div>

      {view === "circle" ? <CircleFeedView /> : <GlobalFeedView />}
    </div>
  );
}

export default function FeedRoute() {
  return <ClientOnly>{() => <FeedPage />}</ClientOnly>;
}
