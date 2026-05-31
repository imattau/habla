"use client";

import { useState } from "react";
import { firstValueFrom } from "rxjs";
import { Loader2, UserPlus, UserMinus } from "lucide-react";
import { useActionHub, useActiveAccount } from "applesauce-react/hooks";
import { useContacts, useRelays } from "~/hooks/nostr";
import { Button } from "~/ui/button";
import { publishToRelays } from "~/services/publish-article";
import { FollowUser, UnfollowUser } from "applesauce-actions/actions";
import { toast } from "sonner";

export default function FollowButton({ pubkey }: { pubkey: string }) {
  const account = useActiveAccount();
  const hub = useActionHub();
  const contacts = useContacts(account?.pubkey || "");
  const relays = useRelays(account?.pubkey || "");
  const [isUpdating, setIsUpdating] = useState(false);

  const isOwnProfile = account?.pubkey === pubkey;
  const isFollowing =
    contacts?.some((contact) => contact.pubkey === pubkey) || false;

  async function toggleFollow() {
    if (!account || isOwnProfile || isUpdating) return;

    if (relays.length === 0) {
      toast.error("No publish relays available", {
        description: "Add relays to your profile before following users.",
      });
      return;
    }

    setIsUpdating(true);
    try {
      const signedEvent = await firstValueFrom(
        hub.exec(isFollowing ? UnfollowUser : FollowUser, pubkey),
      );

      if (!signedEvent) {
        throw new Error("Failed to sign follow list update");
      }

      const publishResult = await publishToRelays(signedEvent, relays);

      if (publishResult.successCount === 0) {
        throw new Error("Failed to publish follow list");
      }

      toast.success(isFollowing ? "Unfollowed" : "Following");
    } catch (error) {
      console.error(error);
      toast.error(isFollowing ? "Failed to unfollow" : "Failed to follow", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setIsUpdating(false);
    }
  }

  if (!account || isOwnProfile) return null;

  return (
    <Button
      type="button"
      variant={isFollowing ? "outline" : "default"}
      size="sm"
      onClick={toggleFollow}
      disabled={isUpdating}
      className="shrink-0"
    >
      {isUpdating ? (
        <Loader2 className="size-4 animate-spin" />
      ) : isFollowing ? (
        <UserMinus className="size-4" />
      ) : (
        <UserPlus className="size-4" />
      )}
      <span>{isFollowing ? "Unfollow" : "Follow"}</span>
    </Button>
  );
}
