import { type ReactNode, useEffect, useMemo, useState } from "react";
import { CircleSlash2 } from "lucide-react";
import { type NostrEvent, type Filter } from "nostr-tools";
import { type ProfileContent } from "applesauce-core/helpers";
import {
  useContacts,
  useMyCircleAuthors,
  useTimeline,
} from "~/hooks/nostr";
import { useActiveAccount } from "applesauce-react/hooks";
import { Button } from "../button";
import { Card as SkeletonCard } from "../skeleton";
import Grid from "../grid";
import Debug from "../debug";
import type { UserRelationship } from "./user";

export interface FeedComponentProps {
  event: NostrEvent;
  profile?: ProfileContent;
  relationship?: UserRelationship;
}

export type FeedComponent = (props: FeedComponentProps) => ReactNode;

export function PureFeed({
  feed,
  profile,
  isLoading,
  components,
  className,
  showSeparator = false,
  relationships,
}: {
  feed?: NostrEvent[];
  profile?: ProfileContent;
  isLoading: boolean;
  components: Record<number, FeedComponent>;
  className?: string;
  showSeparator?: boolean;
  relationships?: Record<string, UserRelationship>;
}) {
  if (isLoading) {
    return <SkeletonCard />;
  }

  const isEmpty = feed ? feed.length === 0 : true;
  if (isEmpty) {
    return (
      <div className="w-full border border-4 border-dotted rounded-sm h-32 flex flex-col gap-2 items-center justify-center">
        <CircleSlash2 className="text-muted-foreground" />
        <span className="font-light text-sm text-muted-foreground">
          Nothing found
        </span>
      </div>
    );
  }

  return (
    <Grid className={className}>
      {feed?.map((event) => {
        const Component = components[event.kind];
        return Component ? (
          <>
            <Component
              key={event.id}
              event={event}
              profile={profile}
              relationship={relationships?.[event.pubkey]}
            />
            {showSeparator ? <hr /> : null}
          </>
        ) : (
          <Debug>{event}</Debug>
        );
      })}
      {isLoading ? <SkeletonCard /> : null}
    </Grid>
  );
}

function FeedWindow({
  id,
  profile,
  relays,
  filters,
  components,
  className,
  showSeparator,
  pageSize = 20,
  directSet,
  circleSet,
}: {
  id: string;
  profile?: ProfileContent;
  relays: string[];
  filters: Filter | Filter[];
  components: Record<number, FeedComponent>;
  className?: string;
  showSeparator?: boolean;
  pageSize?: number;
  directSet?: Set<string>;
  circleSet?: Set<string>;
}) {
  const [page, setPage] = useState(1);
  const limit = pageSize * page;
  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    setPage(1);
  }, [id, filterKey, relays.join(",")]);

  const { timeline, isLoading } = useTimeline(id, filters, relays, {
    limit,
  });
  const hasMore = timeline ? timeline.length >= limit : false;
  const relationships = useMemo(() => {
    if (!directSet && !circleSet) return undefined;
    const map: Record<string, UserRelationship> = {};
    for (const event of timeline || []) {
      if (directSet?.has(event.pubkey)) {
        map[event.pubkey] = "direct";
      } else if (circleSet?.has(event.pubkey)) {
        map[event.pubkey] = "circle";
      }
    }
    return map;
  }, [circleSet, directSet, timeline]);

  return (
    <div className="flex flex-col gap-4">
      <PureFeed
        profile={profile}
        feed={timeline}
        isLoading={isLoading}
        components={components}
        className={className}
        showSeparator={showSeparator}
        relationships={relationships}
      />
      {timeline && timeline.length > 0 && hasMore ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={() => setPage((current) => current + 1)}
            disabled={isLoading}
          >
            {isLoading ? "Loading..." : "Load More"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function RelationshipAwareFeed({
  id,
  profile,
  relays,
  filters,
  components,
  className,
  showSeparator,
  pageSize,
}: {
  id: string;
  profile?: ProfileContent;
  relays: string[];
  filters: Filter | Filter[];
  components: Record<number, FeedComponent>;
  className?: string;
  showSeparator?: boolean;
  pageSize?: number;
}) {
  const account = useActiveAccount();
  const contacts = useContacts(account?.pubkey || "");
  const circleAuthors = useMyCircleAuthors(account?.pubkey).authors;

  const directSet = useMemo(
    () => new Set((contacts || []).map((contact) => contact.pubkey)),
    [contacts],
  );
  const circleSet = useMemo(
    () => new Set(circleAuthors),
    [circleAuthors],
  );

  return (
    <FeedWindow
      id={id}
      profile={profile}
      relays={relays}
      filters={filters}
      components={components}
      className={className}
      showSeparator={showSeparator}
      pageSize={pageSize}
      directSet={directSet}
      circleSet={circleSet}
    />
  );
}

export default function Feed({
  id,
  profile,
  relays,
  filters,
  components,
  className,
  showSeparator,
  pageSize = 20,
  showRelationshipBadges = false,
}: {
  id: string;
  profile?: ProfileContent;
  relays: string[];
  filters: Filter | Filter[];
  components: Record<number, FeedComponent>;
  className?: string;
  showSeparator?: boolean;
  pageSize?: number;
  showRelationshipBadges?: boolean;
}) {
  if (showRelationshipBadges) {
    return (
      <RelationshipAwareFeed
        id={id}
        profile={profile}
        relays={relays}
        filters={filters}
        components={components}
        className={className}
        showSeparator={showSeparator}
        pageSize={pageSize}
      />
    );
  }

  return (
    <FeedWindow
      id={id}
      profile={profile}
      relays={relays}
      filters={filters}
      components={components}
      className={className}
      showSeparator={showSeparator}
      pageSize={pageSize}
    />
  );
}
