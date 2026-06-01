import { kinds } from "nostr-tools";
import { List, TagOperations, modifyPublicTags } from "applesauce-factory/operations";

const MY_CIRCLE_IDENTIFIER = "my-circle";
const MY_CIRCLE_TITLE = "My Circle";
const MY_CIRCLE_DESCRIPTION =
  "People you follow and the followers of those people.";

function replaceAllPubkeys(tags: string[][]) {
  return tags.filter((tag) => tag[0] !== "p");
}

export function SyncMyCircle(authors: string[]) {
  return async function* ({ events, factory, self }: any) {
    const uniqueAuthors = [...new Set(authors)].filter(
      (pubkey) => pubkey && pubkey !== self,
    );
    const existing = events.getReplaceable(
      kinds.Followsets,
      self,
      MY_CIRCLE_IDENTIFIER,
    );

    const listTags = modifyPublicTags(
      replaceAllPubkeys,
      ...uniqueAuthors.map((pubkey) => TagOperations.addPubkeyTag(pubkey)),
    );

    const draft = existing
      ? await factory.modify(
          existing,
          List.setTitle(MY_CIRCLE_TITLE),
          List.setDescription(MY_CIRCLE_DESCRIPTION),
          listTags,
        )
      : await factory.build(
          {
            kind: kinds.Followsets,
            tags: [["d", MY_CIRCLE_IDENTIFIER]],
          },
          List.setTitle(MY_CIRCLE_TITLE),
          List.setDescription(MY_CIRCLE_DESCRIPTION),
          listTags,
        );

    yield await factory.sign(draft);
  };
}

export const MY_CIRCLE_LIST_IDENTIFIER = MY_CIRCLE_IDENTIFIER;
