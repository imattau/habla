import { Link } from "react-router";
import { type NostrEvent, nip19 } from "nostr-tools";
import { type AddressPointer } from "nostr-tools/nip19";
import { getArticleTitle } from "applesauce-core/helpers";
import type { ReactNode } from "react";

export function useArticleLink(article: NostrEvent, address: AddressPointer) {
  return `/a/${nip19.naddrEncode(address)}`;
}

export default function ArticleLink({
  article,
  address,
  children,
  className,
}: {
  article: NostrEvent;
  address: AddressPointer;
  children?: ReactNode;
  className?: string;
}) {
  const title = getArticleTitle(article);
  const link = useArticleLink(article, address);
  return (
    <Link className={className} to={link}>
      {children || title}
    </Link>
  );
}
