import { useEffect, useMemo, useRef, useState } from "react";
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
  normalizeMyCircleAuthors,
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
type RefreshPhase = "idle" | "checking-updates" | "signing" | "publishing";
type RefreshState = {
  isRefreshing: boolean;
  phase: RefreshPhase;
};

function FeedState({
  title,
  description,
  actionLabel,
  onAction,
  actionDisabled,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
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
            {actionLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function summarizePublishFailures(
  statuses: Array<{ relay: string; message?: string; status: string }>,
) {
  const failures = statuses.filter((status) => status.status === "error");
  if (failures.length === 0) return "";
  return failures
    .map((status) =>
      status.message
        ? `${status.relay}: ${status.message}`
        : status.relay,
    )
    .join("; ");
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
      showRelationshipBadges
    />
  );
}

function CircleFeedView() {
  const account = useActiveAccount();
  const hub = useActionHub();
  const eventStore = useEventStore();
  const relays = useRelays(account?.pubkey || "");
  const [graphRefreshKey, setGraphRefreshKey] = useState(0);
  const circleReadRelays = useMemo(() => {
    const merged = [...relays, ...INDEX_RELAYS];
    return [...new Set(merged)];
  }, [relays]);
  const circleGraph = useMyCircleAuthors(account?.pubkey, graphRefreshKey);
  const [refreshState, setRefreshState] = useState<RefreshState>({
    isRefreshing: false,
    phase: "idle",
  });

  const circleListTimeline = useTimeline(
    `${account?.pubkey || "anon"}-${MY_CIRCLE_LIST_IDENTIFIER}`,
    {
      kinds: [kinds.Followsets],
      authors: account?.pubkey ? [account.pubkey] : [],
      "#d": [MY_CIRCLE_LIST_IDENTIFIER],
    },
    circleReadRelays,
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
      .filter((pubkey) => pubkey !== account?.pubkey)
      .sort();
  }, [account?.pubkey, circleList]);

  async function refreshCircle() {
    if (!account) return;
    if (relays.length === 0) {
      toast.error("No publish relays available", {
        description: "Add relays to your profile before refreshing My Circle.",
      });
      return;
    }

    setRefreshState({ isRefreshing: true, phase: "checking-updates" });
    setGraphRefreshKey((current) => current + 1);

    const pubkey = account.pubkey;
    const startedAt = Date.now();
    const timeoutMs = 30_000;

    try {
      while (true) {
        if (!circleGraph.isLoading) break;
        if (Date.now() - startedAt >= timeoutMs) {
          throw new Error("My Circle graph is still loading. Try again in a moment.");
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      setRefreshState({ isRefreshing: true, phase: "signing" });
      const circleAuthorsToPublish = normalizeMyCircleAuthors(
        circleGraph.authors,
        pubkey,
      );

      if (circleAuthorsToPublish.length === 0) {
        throw new Error("My Circle is empty");
      }

      const signedEvent = await firstValueFrom(
        hub.exec(SyncMyCircle, circleAuthorsToPublish),
      );

      if (!signedEvent) {
        throw new Error("Failed to sign My Circle list");
      }

      eventStore.add(signedEvent);

      setRefreshState({ isRefreshing: true, phase: "publishing" });
      const publishResult = await publishToRelays(signedEvent, relays);
      if (publishResult.successCount === 0) {
        const failureSummary = summarizePublishFailures(publishResult.statuses);
        throw new Error(
          failureSummary
            ? `Failed to publish My Circle list: ${failureSummary}`
            : "Failed to publish My Circle list",
        );
      }

      toast.success("My Circle refreshed");
    } catch (error) {
      console.error(error);
      toast.error("Failed to refresh My Circle", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setRefreshState({ isRefreshing: false, phase: "idle" });
    }
  }

  const refreshButtonLabel = (() => {
    switch (refreshState.phase) {
      case "checking-updates":
        return "Checking for updates...";
      case "signing":
        return "Preparing My Circle...";
      case "publishing":
        return "Publishing...";
      default:
        return "Refresh My Circle";
    }
  })();

  if (!account) {
    return (
      <FeedState
        title="Log in to use My Circle"
        description="My Circle is built from the people you follow and a selected set of accounts followed by more than one of them."
      />
    );
  }

  if (circleListTimeline.isLoading && !circleList) {
    return (
      <FeedState
        title="Loading My Circle"
        description="Checking for your published My Circle list."
        actionLabel={refreshButtonLabel}
        onAction={refreshCircle}
        actionDisabled={refreshState.isRefreshing}
      />
    );
  }

  if (circleAuthors.length === 0) {
    return (
      <FeedState
        title="My Circle is empty"
        description="Refresh the list after you follow a few people, or after the people you follow change who they follow."
        actionLabel={refreshButtonLabel}
        onAction={refreshCircle}
        actionDisabled={refreshState.isRefreshing}
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
          disabled={refreshState.isRefreshing}
        >
          {refreshButtonLabel}
        </Button>
      </div>
      <Feed
        id={`${account.pubkey}-${circleList?.id || MY_CIRCLE_LIST_IDENTIFIER}`}
        relays={circleReadRelays}
        filters={{
          authors: circleAuthors,
          kinds: [kinds.LongFormArticle, kinds.Highlights],
      }}
      components={components}
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
            ? "People you follow, plus a selected set of accounts followed by more than one of them."
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
