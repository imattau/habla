import { kinds, type NostrEvent } from "nostr-tools";
import type { AddressPointer } from "nostr-tools/nip19";
import { getAddressPointerForEvent } from "applesauce-core/helpers";
import eventFactory from "~/services/event-factory";

export interface DeleteArticleParams {
  event: NostrEvent;
  address?: AddressPointer;
  reason?: string;
}

export async function createDeleteArticleEvent({
  event,
  address,
  reason,
}: DeleteArticleParams): Promise<NostrEvent> {
  const resolvedAddress = address ?? getAddressPointerForEvent(event);
  const tags: string[][] = [["e", event.id]];

  if (resolvedAddress) {
    tags.push([
      "a",
      `${resolvedAddress.kind}:${resolvedAddress.pubkey}:${resolvedAddress.identifier}`,
    ]);
  }

  const draft = await eventFactory.build({
    kind: kinds.EventDeletion,
    content: reason?.trim() || "",
    tags,
  });

  return await eventFactory.sign(draft);
}
