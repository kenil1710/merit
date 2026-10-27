/** Submission source types and their names. No runtime dependencies, so client code can import it cheaply. */

export const SOURCE_TYPES = ["x_post", "github_pr", "github_commit", "article"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Plural names, as used in lists ("This program pays for X posts and Articles"). */
export const SOURCE_LABELS: Record<SourceType, string> = {
  x_post: "X posts",
  github_pr: "GitHub pull requests",
  github_commit: "GitHub commits",
  article: "Articles",
};

/** Singular names, as used on one item ("X post", "GitHub pull request"). */
export const SOURCE_LABEL: Record<SourceType, string> = {
  x_post: "X post",
  github_pr: "GitHub pull request",
  github_commit: "GitHub commit",
  article: "Article",
};

/** Join source names into a sentence fragment: "X posts, GitHub pull requests and Articles". */
export function listSources(types: readonly SourceType[]): string {
  const names = types.map((t) => SOURCE_LABELS[t]);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
