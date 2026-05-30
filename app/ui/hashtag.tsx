import { type ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "~/lib/utils";

export function HashtagLink({
  hashtag,
  className,
  children,
}: {
  hashtag: string;
  children: ReactNode;
  className?: string;
}) {
  const encodedTag = encodeURIComponent(hashtag);
  return (
    <Link
      reloadDocument
      to={`/t/${encodedTag}`}
      className={cn(
        "text-primary hover:underline hover:decoration-dotted",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export default function Hashtags({
  name,
  hashtag,
}: {
  name: string;
  hashtag: string;
}) {
  const encodedTag = encodeURIComponent(hashtag);
  return (
    <Link
      reloadDocument
      to={`/t/${encodedTag}`}
      className="text-primary hover:underline hover:decoration-dotted"
    >
      #{name}
    </Link>
  );
}
