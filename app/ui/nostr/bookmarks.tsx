import type { ReactNode } from "react";
import { Hash, Link as LinkIcon, Newspaper, StickyNote, Bookmark } from "lucide-react";
import { kinds, type NostrEvent } from "nostr-tools";
import { getBookmarks, getTagValue } from "applesauce-core/helpers";
import NEvent from "./nevent";
import NAddr from "./naddr";
import Url from "~/ui/url";
import Hashtag from "~/ui/hashtag";
import { cn } from "~/lib/utils";

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="text-muted-foreground">{icon}</div>
        <h3 className="text-lg font-light uppercase tracking-wide">{title}</h3>
        <span className="text-sm text-muted-foreground">({count})</span>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export default function Bookmarks({
  bookmark,
  title,
  className,
}: {
  bookmark?: NostrEvent;
  title?: string;
  className?: string;
}) {
  if (!bookmark) {
    return (
      <div className="w-full border border-dashed rounded-sm p-6 text-muted-foreground">
        No bookmark list loaded.
      </div>
    );
  }

  const bookmarks = getBookmarks(bookmark);
  const heading =
    title ||
    getTagValue(bookmark, "title") ||
    (bookmark.kind === kinds.Bookmarksets ? "Bookmark set" : "Bookmarks");
  const description = getTagValue(bookmark, "description");
  const total =
    bookmarks.notes.length +
    bookmarks.articles.length +
    bookmarks.urls.length +
    bookmarks.hashtags.length;

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Bookmark className="size-5 text-muted-foreground" />
          <h2 className="text-2xl font-light uppercase tracking-wide">
            {heading}
          </h2>
          <span className="text-sm text-muted-foreground">({total})</span>
        </div>
        {description ? (
          <p className="text-muted-foreground text-sm max-w-2xl">
            {description}
          </p>
        ) : null}
      </header>

      <Section icon={<Newspaper className="size-4" />} title="Articles" count={bookmarks.articles.length}>
        {bookmarks.articles.map((address) => (
          <NAddr key={`${address.kind}:${address.pubkey}:${address.identifier}`} {...address} />
        ))}
      </Section>

      <Section icon={<StickyNote className="size-4" />} title="Notes" count={bookmarks.notes.length}>
        {bookmarks.notes.map((event) => (
          <NEvent key={`${event.id}`} {...event} />
        ))}
      </Section>

      <Section icon={<LinkIcon className="size-4" />} title="Links" count={bookmarks.urls.length}>
        {bookmarks.urls.map((url) => (
          <div key={url} className="flex items-center gap-2">
            <LinkIcon className="size-4 text-muted-foreground shrink-0" />
            <Url href={url} className="break-all" />
          </div>
        ))}
      </Section>

      <Section icon={<Hash className="size-4" />} title="Tags" count={bookmarks.hashtags.length}>
        <div className="flex flex-wrap gap-2">
          {bookmarks.hashtags.map((tag) => (
            <Hashtag key={tag} name={tag} hashtag={tag} />
          ))}
        </div>
      </Section>
    </div>
  );
}
