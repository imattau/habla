import { kinds } from "nostr-tools";

const MY_CIRCLE_IDENTIFIER = "my-circle";
const MY_CIRCLE_TITLE = "My Circle";
const MY_CIRCLE_DESCRIPTION =
  "People you follow and a selected set of accounts followed by more than one of them.";

export function normalizeMyCircleAuthors(authors: string[], self?: string) {
  return [...new Set(authors)]
    .filter((pubkey) => pubkey && pubkey !== self)
    .sort();
}

export function SyncMyCircle(authors: string[]) {
  return async function* ({ factory, self }: any) {
    const uniqueAuthors = normalizeMyCircleAuthors(authors, self);

    const draft = await factory.build(
      {
        kind: kinds.Followsets,
        tags: [
          ["d", MY_CIRCLE_IDENTIFIER],
          ["title", MY_CIRCLE_TITLE],
          ["description", MY_CIRCLE_DESCRIPTION],
          ...uniqueAuthors.map((pubkey) => ["p", pubkey]),
        ],
      }
    );

    yield await factory.sign(draft);
  };
}

export const MY_CIRCLE_LIST_IDENTIFIER = MY_CIRCLE_IDENTIFIER;
