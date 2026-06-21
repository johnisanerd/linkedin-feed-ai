import { revalidatePath } from "next/cache";
import { addSource, deleteSource, getSources, getSourceArticleCounts } from "./actions";
import { ingestArticle, getArticlesPage } from "./ingest-actions";
import { syncRSSFeed, syncAllRSSFeeds } from "./rss-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
// Sources + articles are mutated by the RSS sync cron. Force dynamic to avoid stale lists.
export const dynamic = "force-dynamic";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Newspaper,
  Trash2,
  Rss,
  Link2,
  Download,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  FileText,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const PAGE_SIZE = 100;

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ syncResult?: string; page?: string }>;
}) {
  const params = await searchParams;
  const sources = await getSources();
  const articleCounts = await getSourceArticleCounts();
  const totalArticles = Object.values(articleCounts).reduce((a, b) => a + b, 0);

  const currentPage = Math.max(1, parseInt(params.page || "1", 10));
  const { articles, totalCount } = await getArticlesPage(currentPage, PAGE_SIZE);
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const rssSources = sources.filter((s) => s.type === "rss");
  const syncResultJson = params.syncResult;
  let syncResult:
    | { sourceName: string; ingested: number; skipped: number; failed: number }[]
    | null = null;
  if (syncResultJson) {
    try {
      syncResult = JSON.parse(decodeURIComponent(syncResultJson));
    } catch {
      syncResult = null;
    }
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-4xl font-bold tracking-tight">Sources</h1>
        <p className="text-muted-foreground mt-1 text-lg">
          Manage newsletter feeds and article ingestion
        </p>
      </div>

      {/* Sync Results Banner */}
      {syncResult && syncResult.length > 0 && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:bg-green-950 dark:border-green-800">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-green-800 dark:text-green-200">
                RSS Sync Complete
              </p>
              <div className="text-sm text-green-700 dark:text-green-300 space-y-0.5">
                {syncResult.map((r) => (
                  <p key={r.sourceName}>
                    <span className="font-medium">{r.sourceName}</span>:{" "}
                    {r.ingested} new, {r.skipped} already known
                    {r.failed > 0 && (
                      <span className="text-red-600">, {r.failed} failed</span>
                    )}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-10 lg:grid-cols-3">
        {/* Add Source Form */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-xl">Add Source</CardTitle>
            <CardDescription>
              Paste a URL or add an RSS feed
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={async (formData) => {
                "use server";
                await addSource(formData);
                revalidatePath("/sources");
              }}
              className="space-y-5"
            >
              <div className="space-y-2">
                <label className="text-base font-medium">Name</label>
                <Input
                  name="name"
                  placeholder="e.g., TLDR AI Newsletter"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-base font-medium">Type</label>
                <Select name="type" defaultValue="manual">
                  <SelectTrigger className="w-full text-base">
                    <SelectValue placeholder="Select source type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">
                      <div className="flex items-center gap-2 text-base">
                        <Link2 className="h-5 w-5" />
                        Single Article URL
                      </div>
                    </SelectItem>
                    <SelectItem value="rss">
                      <div className="flex items-center gap-2 text-base">
                        <Rss className="h-5 w-5" />
                        RSS Feed
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-base font-medium">URL</label>
                <Input
                  name="url"
                  type="url"
                  placeholder="https://example.com/article or feed.xml"
                  required
                />
              </div>

              <Button type="submit" className="w-full text-base">
                <Newspaper className="h-5 w-5 mr-2" />
                Add Source
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Sources List */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl">Your Sources</CardTitle>
                <CardDescription>
                  {sources.length} source{sources.length !== 1 ? "s" : ""} ·{" "}
                  {totalArticles} article{totalArticles !== 1 ? "s" : ""} total
                </CardDescription>
              </div>
              {rssSources.length > 0 && (
                <form
                  action={async () => {
                    "use server";
                    const results = await syncAllRSSFeeds();
                    revalidatePath("/sources");
                  }}
                >
                  <Button
                    variant="outline"
                    size="sm"
                    type="submit"
                    className="text-base"
                  >
                    <RefreshCw className="h-4 w-4 mr-1.5" />
                    Sync All RSS
                  </Button>
                </form>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {sources.length === 0 ? (
              <div className="flex items-center gap-3 text-muted-foreground text-base">
                <AlertCircle className="h-6 w-6" />
                <p>
                  No sources yet. Add one to start ingesting articles.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {sources.map((source) => {
                  const count = articleCounts[source.id] || 0;
                  const isRss = source.type === "rss";
                  return (
                    <div
                      key={source.id}
                      className="rounded-lg border p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-base truncate">
                              {source.name}
                            </span>
                            <Badge variant="secondary">
                              {isRss ? (
                                <span className="flex items-center gap-1 text-sm">
                                  <Rss className="h-4 w-4" /> RSS
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-sm">
                                  <Link2 className="h-4 w-4" /> Manual
                                </span>
                              )}
                            </Badge>
                          </div>
                          {source.url && (
                            <p className="text-xs text-muted-foreground truncate max-w-[400px]">
                              {source.url}
                            </p>
                          )}
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <FileText className="h-3.5 w-3.5" />
                              {count} article{count !== 1 ? "s" : ""}
                            </span>
                            {source.lastFetchedAt && (
                              <span>
                                Last fetched:{" "}
                                {new Date(
                                  source.lastFetchedAt
                                ).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          {isRss && source.url && (
                            <form
                              action={async () => {
                                "use server";
                                await syncRSSFeed(source.id, source.url!);
                                revalidatePath("/sources");
                              }}
                            >
                              <Button
                                variant="ghost"
                                size="sm"
                                type="submit"
                                title="Sync RSS feed"
                              >
                                <RefreshCw className="h-5 w-5 text-muted-foreground" />
                              </Button>
                            </form>
                          )}
                          {!isRss && source.url && (
                            <form
                              action={async () => {
                                "use server";
                                await ingestArticle(source.id, source.url!);
                                revalidatePath("/sources");
                              }}
                            >
                              <Button
                                variant="ghost"
                                size="sm"
                                type="submit"
                                title="Ingest article"
                              >
                                <Download className="h-5 w-5 text-muted-foreground" />
                              </Button>
                            </form>
                          )}
                          <form
                            action={async () => {
                              "use server";
                              await deleteSource(source.id);
                              revalidatePath("/sources");
                            }}
                          >
                            <Button
                              variant="ghost"
                              size="icon"
                              type="submit"
                              title="Delete source"
                            >
                              <Trash2 className="h-5 w-5 text-muted-foreground" />
                            </Button>
                          </form>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Articles List with Pagination */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl">Articles</CardTitle>
              <CardDescription>
                {totalCount} article{totalCount !== 1 ? "s" : ""} ingested
                {totalPages > 1 && (
                  <span className="ml-1">
                    · Page {currentPage} of {totalPages}
                  </span>
                )}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {articles.length === 0 ? (
            <div className="flex items-center gap-3 text-muted-foreground text-base">
              <AlertCircle className="h-6 w-6" />
              <p>No articles ingested yet. Add a source and click the ingest button.</p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {articles.map((article: any) => (
                  <div
                    key={article.id}
                    className="rounded-lg border p-4 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-base truncate max-w-[500px]">
                        {article.title}
                      </span>
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {article.char_count?.toLocaleString() ?? "?"} chars
                      </Badge>
                    </div>
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:text-blue-800 hover:underline truncate block"
                    >
                      {article.url}
                    </a>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {article.site_name && (
                        <span>{article.site_name}</span>
                      )}
                      {article.author && (
                        <span>by {article.author}</span>
                      )}
                      {article.published_at && (
                        <span>
                          {new Date(article.published_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {article.excerpt && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                        {article.excerpt}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-6 pt-4 border-t">
                  <a
                    href={`/sources?page=${currentPage - 1}`}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-md border text-base font-medium transition-colors ${
                      currentPage <= 1
                        ? "pointer-events-none opacity-50 text-muted-foreground"
                        : "hover:bg-muted"
                    }`}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </a>

                  <div className="flex items-center gap-2">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                      (page) => (
                        <a
                          key={page}
                          href={`/sources?page=${page}`}
                          className={`inline-flex items-center justify-center w-10 h-10 rounded-md text-sm font-medium transition-colors ${
                            page === currentPage
                              ? "bg-primary text-primary-foreground"
                              : "border hover:bg-muted"
                          }`}
                        >
                          {page}
                        </a>
                      )
                    )}
                  </div>

                  <a
                    href={`/sources?page=${currentPage + 1}`}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-md border text-base font-medium transition-colors ${
                      currentPage >= totalPages
                        ? "pointer-events-none opacity-50 text-muted-foreground"
                        : "hover:bg-muted"
                    }`}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </a>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
