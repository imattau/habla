import { useMemo } from "react";
import type { Route } from "./+types/tags";
import { buildBaseSeoTags } from "~/seo";
import { TagCloud } from "~/ui/tag-cloud";
import { getFeaturedArticles } from "~/featured";

export function meta() {
  return buildBaseSeoTags({
    title: "Tags",
    description: "Browse the tag cloud across featured Habla articles",
    url: "https://habla.news/tags",
  });
}

export async function loader() {
  const featured = await getFeaturedArticles();
  return { featured };
}

export default function TagsPage({ loaderData }: Route.ComponentProps) {
  const tags = useMemo(() => {
    return loaderData.featured.reduce(
      (acc, ev) => {
        const articleTags = [
          ...new Set(ev.tags.filter((t) => t[0] === "t" && t[1]).map((t) => t[1])),
        ];
        for (const tag of articleTags) {
          acc[tag] = (acc[tag] || 0) + 1;
        }
        return acc;
      },
      {} as Record<string, number>,
    );
  }, [loaderData.featured]);

  return (
    <div className="flex flex-col gap-8 w-full py-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif font-light text-5xl">Tags</h1>
        <p className="text-muted-foreground">
          Browse the featured tag cloud. Click any tag to open the normal tag feed.
        </p>
      </div>

      <div className="rounded-lg border border-dashed p-8">
        <TagCloud tags={tags} />
      </div>
    </div>
  );
}
