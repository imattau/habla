import { type NostrEvent, kinds } from "nostr-tools";
import { firstValueFrom, map } from "rxjs";
import {
  parseZap,
  useInboxRelays,
  useRelays,
  useTimeline,
  useZaps,
  type Zap,
} from "~/hooks/nostr";
import {
  getAddressPointerForEvent,
  getBookmarks,
  getReplaceableAddress,
} from "applesauce-core/helpers";
import { ZapButton } from "../zaps";
import { EventReply } from "./reply";
import { useEffect, useMemo, useState } from "react";
import {
  useActionHub,
  useActiveAccount,
  useEventStore,
  useObservableMemo,
} from "applesauce-react/hooks";
import { isReplaceableKind } from "nostr-tools/kinds";
import {
  Bookmark,
  BookmarkCheck,
  Highlighter,
  Loader2,
} from "lucide-react";
import { Button } from "../button";
import { BookmarkEvent, UnbookmarkEvent } from "applesauce-actions/actions";
import { HighlightSelection } from "~/nostr/actions";
import { publishToRelays } from "~/services/publish-article";
import { toast } from "sonner";

type HighlightBubbleState = {
  text: string;
  top: number;
  left: number;
};

function isReply(event: NostrEvent): boolean {
  return (
    event.kind === kinds.ShortTextNote &&
    event.tags.some((t) => t[0] === "e" && t[3] === "reply")
  );
}

export default function EventConversation({ event }: { event: NostrEvent }) {
  const account = useActiveAccount();
  const hub = useActionHub();
  const eventStore = useEventStore();
  const inboxRelays = useInboxRelays(event.pubkey);
  const userRelays = useRelays(account?.pubkey || "");
  useZaps(event);
  const [isBookmarking, setIsBookmarking] = useState(false);
  const [isHighlighting, setIsHighlighting] = useState(false);
  const [highlightBubble, setHighlightBubble] = useState<HighlightBubbleState | null>(null);
  const id = isReplaceableKind(event.kind)
    ? getReplaceableAddress(event)
    : event.id;
  const bookmarkFilters = account?.pubkey
    ? {
        kinds: [kinds.BookmarkList],
        authors: [account.pubkey],
      }
    : {
        kinds: [kinds.BookmarkList],
        authors: [],
      };
  useTimeline(`${account?.pubkey || "anonymous"}-bookmarks-loader`, bookmarkFilters, userRelays, {
    limit: 1,
  });
  const bookmarkEvent = useObservableMemo(() => {
    if (!account?.pubkey) return undefined;
    return eventStore.replaceable(kinds.BookmarkList, account.pubkey);
  }, [account?.pubkey]);
  const bookmarks = useMemo(() => {
    return bookmarkEvent ? getBookmarks(bookmarkEvent) : undefined;
  }, [bookmarkEvent?.id]);
  const isBookmarkable =
    event.kind === kinds.LongFormArticle || event.kind === kinds.ShortTextNote;
  const isBookmarked = useMemo(() => {
    if (!bookmarks || !isBookmarkable) return false;
    if (event.kind === kinds.LongFormArticle) {
      const address = getAddressPointerForEvent(event);
      return bookmarks.articles.some(
        (bookmark) =>
          bookmark.kind === address.kind &&
          bookmark.pubkey === address.pubkey &&
          bookmark.identifier === address.identifier,
      );
    }
    return bookmarks.notes.some((bookmark) => bookmark.id === event.id);
  }, [bookmarks, event.id, event.kind, isBookmarkable]);

  const filters = [
    {
      kinds: [1111],
      ...(isReplaceableKind(event.kind) ? { "#A": [id] } : { "#E": [id] }),
      "#K": [String(event.kind)],
    },
    {
      kinds: [kinds.Highlights, kinds.Zap, kinds.ShortTextNote],
      ...(isReplaceableKind(event.kind) ? { "#a": [id] } : { "#e": [id] }),
    },
  ];
  useTimeline(`${id}-comments`, filters, inboxRelays, {
    limit: 200,
  });
  const total = useObservableMemo(() => {
    return eventStore
      .timeline({
        kinds: [kinds.Zap],
        ...(isReplaceableKind(event.kind) ? { "#a": [id] } : { "#e": [id] }),
      })
      .pipe(
        map((events) => {
          return events
            .map(parseZap)
            .filter(Boolean)
            .reduce((acc, ev) => acc + (ev as Zap).amount, 0);
        }),
      );
  }, [id]);
  const eventsStored = useObservableMemo(() => {
    return eventStore.timeline(filters, false);
  }, [id]);

  useEffect(() => {
    if (!account || !isBookmarkable) {
      setHighlightBubble(null);
      return;
    }

    function updateHighlightBubble() {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        setHighlightBubble(null);
        return;
      }

      const text = selection.toString().trim();
      if (!text) {
        setHighlightBubble(null);
        return;
      }

      const root = document.querySelector('[data-article-content="true"]');
      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;
      if (!root || !anchorNode || !focusNode) {
        setHighlightBubble(null);
        return;
      }

      if (!root.contains(anchorNode) || !root.contains(focusNode)) {
        setHighlightBubble(null);
        return;
      }

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setHighlightBubble(null);
        return;
      }

      setHighlightBubble({
        text,
        top: Math.max(12, rect.top - 44),
        left: Math.max(12, Math.min(window.innerWidth - 160, rect.right + 8)),
      });
    }

    const onScroll = () => updateHighlightBubble();
    const onResize = () => updateHighlightBubble();

    document.addEventListener("selectionchange", updateHighlightBubble);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    updateHighlightBubble();

    return () => {
      document.removeEventListener("selectionchange", updateHighlightBubble);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [account, isBookmarkable]);

  async function toggleBookmark() {
    if (!account) {
      toast.error("Connect your account to bookmark articles.");
      return;
    }
    if (!isBookmarkable) return;
    if (userRelays.length === 0) {
      toast.error("No publish relays available", {
        description: "Add relays to your profile before bookmarking content.",
      });
      return;
    }

    setIsBookmarking(true);
    try {
      const action = isBookmarked ? UnbookmarkEvent : BookmarkEvent;
      const signed = await firstValueFrom(hub.exec(action, event));
      if (!signed) {
        throw new Error("Failed to sign bookmark event");
      }

      const publishResult = await publishToRelays(signed, userRelays, (progress) => {
        progress.statuses.forEach((status) => {
          if (status.status === "error" && status.message) {
            toast.error(`Failed to publish to ${status.relay}`, {
              description: status.message,
            });
          }
        });
      });

      if (publishResult.successCount === 0) {
        throw new Error("Failed to publish bookmark to any relay");
      }

      eventStore.add(signed);
      toast.success(isBookmarked ? "Bookmark removed" : "Bookmarked");
    } catch (error) {
      console.error("[article] Failed to toggle bookmark:", error);
      toast.error(isBookmarked ? "Failed to remove bookmark" : "Failed to bookmark", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setIsBookmarking(false);
    }
  }

  function getSelectedText() {
    if (highlightBubble?.text) return highlightBubble.text;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return "";

    const text = selection.toString().trim();
    if (!text) return "";

    const root = document.querySelector('[data-article-content="true"]');
    const anchorNode = selection.anchorNode;
    if (!root || !anchorNode || !root.contains(anchorNode)) {
      return "";
    }

    return text;
  }

  async function createHighlight(selectionText?: string) {
    if (!account) {
      toast.error("Connect your account to create highlights.");
      return;
    }
    if (!isBookmarkable) return;

    const selectedText = selectionText ?? getSelectedText();
    if (!selectedText) {
      toast.error("Select some text first.");
      return;
    }

    const publishRelays = Array.from(new Set([...userRelays, ...inboxRelays]));
    if (publishRelays.length === 0) {
      toast.error("No publish relays available", {
        description: "Add relays to your profile before creating highlights.",
      });
      return;
    }

    setIsHighlighting(true);
    try {
      const signed = await firstValueFrom(
        hub.exec(HighlightSelection, {
          event,
          content: selectedText,
          sourceRelays: inboxRelays,
        }),
      );

      if (!signed) {
        throw new Error("Failed to sign highlight");
      }

      const publishResult = await publishToRelays(signed, publishRelays, (
        progress,
      ) => {
        progress.statuses.forEach((status) => {
          if (status.status === "error" && status.message) {
            toast.error(`Failed to publish to ${status.relay}`, {
              description: status.message,
            });
          }
        });
      });

      if (publishResult.successCount === 0) {
        throw new Error("Failed to publish highlight to any relay");
      }

      eventStore.add(signed);
      toast.success("Highlight published");
    } catch (error) {
      console.error("[article] Failed to create highlight:", error);
      toast.error("Failed to create highlight", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setIsHighlighting(false);
    }
  }

  return (
    <div className="flex flex-col gap-12 pb-16 items-center w-full">
      {highlightBubble && account && isBookmarkable ? (
        <Button
          type="button"
          variant="outline"
          aria-label="Highlight selection"
          title="Highlight selection"
          className="fixed z-40 inline-flex size-9 items-center justify-center rounded-full border bg-background shadow-md"
          style={{
            top: `${highlightBubble.top}px`,
            left: `${highlightBubble.left}px`,
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            void createHighlight(highlightBubble.text);
          }}
          disabled={isHighlighting}
          >
            {isHighlighting ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <Highlighter className="size-4 text-muted-foreground" />
            )}
          </Button>
        ) : null}
      <div className="flex flex-row gap-2">
        <ZapButton pubkey={event.pubkey} event={event} total={total || 0} />
        {account && isBookmarkable ? (
          <>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              size="xl"
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleBookmark}
              disabled={isBookmarking}
            >
              {isBookmarking ? (
                <Loader2 className="size-12 animate-spin text-muted-foreground" />
              ) : isBookmarked ? (
                <BookmarkCheck className="size-12 text-muted-foreground" />
              ) : (
                <Bookmark className="size-12 text-muted-foreground" />
              )}
              <span className="text-2xl font-light">
                {isBookmarked ? "Bookmarked" : "Bookmark"}
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              size="xl"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                void createHighlight();
              }}
              disabled={isHighlighting}
            >
              {isHighlighting ? (
                <Loader2 className="size-12 animate-spin text-muted-foreground" />
              ) : (
                <Highlighter className="size-12 text-muted-foreground" />
              )}
              <span className="text-2xl font-light">Highlight</span>
            </Button>
          </>
        ) : null}
      </div>
      <div className="flex flex-col w-full gap-3">
        {eventsStored
          ?.filter((ev) => !isReply(ev))
          .map((ev) => (
            <EventReply key={ev.id} event={ev} includeReplies />
          ))}
      </div>
    </div>
  );
}

export function Conversation({ event }: { event: NostrEvent }) {
  return <EventConversation event={event} />;
}
