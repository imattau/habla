import { cn } from "~/lib/utils";
import {
  type ProfileContent,
  getDisplayName,
  getProfilePicture,
} from "applesauce-core/helpers";
import { Loading } from "~/ui/nostr/nip05";
import { UserCheck, Users } from "lucide-react";

export type UserRelationship = "direct" | "circle";

export function RelationshipIcon({
  relationship,
  className,
}: {
  relationship: UserRelationship;
  className?: string;
}) {
  const title =
    relationship === "direct"
      ? "You directly follow this author"
      : "This author is directly followed by someone you follow";
  return relationship === "direct" ? (
    <span aria-label={title} title={title} className="inline-flex">
      <UserCheck className={cn("size-4 text-emerald-400", className)} />
    </span>
  ) : (
    <span aria-label={title} title={title} className="inline-flex">
      <Users className={cn("size-4 text-sky-400", className)} />
    </span>
  );
}

export function Username({
  pubkey,
  profile,
  className,
}: {
  pubkey: string;
  profile?: ProfileContent;
  className?: string;
}) {
  const username = getDisplayName(profile) || pubkey.slice(0, 8);
  return <span className={cn("font-sans text-lg", className)}>{username}</span>;
}

export function Avatar({
  profile,
  className,
}: {
  profile?: ProfileContent;
  className?: string;
}) {
  const picture = getProfilePicture(profile) || "/favicon.ico";
  const fallback = profile?.name || profile?.display_name || "";
  return (
    <div
      className={cn(
        "relative flex shrink-0 overflow-hidden rounded-full",
        className,
      )}
    >
      <img
        src={picture}
        alt={fallback}
        className="aspect-square size-full object-cover"
      />
    </div>
  );
}

export default function User({
  pubkey,
  profile,
  className,
  img = "size-6",
  name,
  wrapper,
  withNip05,
  nip05,
  onlyAvatar,
  relationship,
}: {
  pubkey: string;
  profile?: ProfileContent;
  className?: string;
  img?: string;
  name?: string;
  wrapper?: string;
  withNip05?: boolean;
  nip05?: string;
  onlyAvatar?: boolean;
  relationship?: UserRelationship;
}) {
  const username = getDisplayName(profile) || pubkey.slice(0, 8);
  const picture = getProfilePicture(profile) || "/favicon.ico";
  return onlyAvatar ? (
    <Avatar profile={profile} className={img} />
  ) : (
    <div className={wrapper}>
      <div className={cn("flex flex-row items-center gap-2", className)}>
        <Avatar profile={profile} className={img} />
        <div className="flex flex-col gap-0">
          {profile?.nip05 && withNip05 ? (
            <Loading nip05={profile?.nip05} className={nip05} />
          ) : null}
          <div className="flex flex-row items-center gap-1">
            <Username pubkey={pubkey} profile={profile} className={name} />
            {relationship ? (
              <RelationshipIcon relationship={relationship} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
