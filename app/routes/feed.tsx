import { kinds } from "nostr-tools";
import { getTagValue } from "applesauce-core/helpers";
import type { Route } from "./+types/feed";
import { AGGREGATOR_RELAYS } from "~/const";
import { buildBaseSeoTags } from "~/seo";
import ClientOnly from "~/ui/client-only";
import Feed, { type FeedComponent } from "~/ui/nostr/feed";
import NostrCard from "~/ui/nostr/card";
import { PureHighlight } from "~/ui/nostr/highlight";
import ArticleCard from "~/ui/nostr/article-card";

const components: Record<number, FeedComponent> = {
  [kinds.Highlights]: ({ event }) => (
    <NostrCard className="border-none bg-transparent" noFooter event={event}>
      <PureHighlight event={event} />
    </NostrCard>
  ),
  [kinds.LongFormArticle]: ({ event }) => (
    <ArticleCard
      article={event}
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
    title: "Global Feed",
    description: "Recent articles and highlights across Habla",
    url: "https://habla.news/feed",
  });
}

function GlobalFeed() {
  return (
    <div className="flex flex-col gap-8 w-full py-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif font-light text-5xl">Global Feed</h1>
        <p className="text-muted-foreground">
          Recent articles and highlights across Habla.
        </p>
      </div>
      <Feed
        id="global-feed"
        relays={AGGREGATOR_RELAYS}
        filters={{
          kinds: [kinds.LongFormArticle, kinds.Highlights],
        }}
        components={components}
        className="grid-cols-1 gap-6 md:grid-cols-1 md:gap-8"
        showSeparator
      />
    </div>
  );
}

export default function FeedRoute() {
  return <ClientOnly>{() => <GlobalFeed />}</ClientOnly>;
}
