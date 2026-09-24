"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Search, ArrowRight, LoaderCircle } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  searchResponseSchema,
  userDetailPath,
  type SearchResult,
} from "@/lib/users/models";
import { operationMessage, ReadProblem } from "./presentation";

export function UserSearch(): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const current = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const channel = useRef<string | null>(null);
  useEffect(() => () => current.current?.abort(), []);

  async function search(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!query.trim()) return;
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    const version = ++sequence.current;
    channel.current ??= crypto.randomUUID();
    setPending(true);
    setResults(null);
    setError(null);
    setReauth(false);
    setSearched(query);
    try {
      const response = await fetch("/api/users/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          channelId: channel.current,
          sequence: version,
        }),
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (version !== sequence.current || controller.signal.aborted) return;
      if (!response.ok) {
        const parsed = z.object({ error: z.string() }).safeParse(payload);
        setReauth(response.status === 401);
        setError(operationMessage(parsed.success ? parsed.data.error : null));
        return;
      }
      setResults(searchResponseSchema.parse(payload).results);
    } catch {
      if (version === sequence.current && !controller.signal.aborted)
        setError(
          "Search could not be completed. Submit a new search when ready.",
        );
    } finally {
      if (version === sequence.current) setPending(false);
    }
  }
  const count =
    results?.reduce(
      (sum, result) =>
        sum + (result.state === "found" ? result.users.length : 0),
      0,
    ) ?? 0;
  return (
    <div className="space-y-7">
      <form onSubmit={(event) => void search(event)} className="space-y-3">
        <Label htmlFor="user-query">Email, name, or user ID</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="user-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={256}
            required
            autoComplete="off"
            placeholder="Search across your products…"
            className="min-w-0 flex-1 basis-64"
          />
          <Button type="submit" disabled={!query.trim()}>
            <Search className="size-4" aria-hidden="true" />
            {pending ? "Search again" : "Search users"}
          </Button>
          {pending && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                current.current?.abort();
                sequence.current++;
                setPending(false);
                setError("Search canceled.");
              }}
            >
              Cancel search
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Each enabled product searches its own records. Search terms and
          results are not saved in Control.
        </p>
      </form>
      {error && (
        <p role="alert" className="text-sm text-amber-300">
          {error}
          {reauth && (
            <>
              {" "}
              <Link className="underline" href="/login?next=%2Fusers">
                Sign in again
              </Link>
            </>
          )}
        </p>
      )}
      <div
        role="status"
        aria-live="polite"
        className="text-sm text-muted-foreground"
      >
        {pending ? (
          <span className="flex items-center gap-2">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            Searching enabled products…
          </span>
        ) : (
          results && (
            <span>
              {count} matching {count === 1 ? "user" : "users"} across{" "}
              {results.length} enabled{" "}
              {results.length === 1 ? "product" : "products"} for{" "}
              <span className="break-all text-foreground">“{searched}”</span>.
            </span>
          )
        )}
      </div>
      {results?.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-8 text-sm text-muted-foreground">
          No enabled products.{" "}
          <Link href="/products" className="text-primary underline">
            Manage products
          </Link>{" "}
          to connect one.
        </p>
      )}
      <div className="grid gap-5 xl:grid-cols-2">
        {results?.map((result) => (
          <section
            key={result.product.id}
            aria-label={`${result.product.name} search results`}
            className="min-w-0 rounded-lg border border-border bg-card"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <h2 className="min-w-0 break-words text-sm font-semibold">
                {result.product.name}
              </h2>
              <Link
                href={`/products/${result.product.id}`}
                className="text-xs text-muted-foreground hover:text-primary"
              >
                Connection details
              </Link>
            </div>
            {result.state === "found" ? (
              <>
                <ul className="divide-y divide-border">
                  {result.users.map((user, index) => (
                    <li key={`${user.id}:${index}`} className="px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-medium">
                            {user.name ?? user.email ?? user.id}
                          </p>
                          <p className="mt-1 break-all text-xs text-muted-foreground">
                            {user.email ?? "Email not reported"}
                          </p>
                          <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">
                            {user.id}
                          </p>
                        </div>
                        {user.banned !== undefined && (
                          <Badge variant="outline">
                            {user.banned ? "Banned" : "Not banned"}
                          </Badge>
                        )}
                      </div>
                      <Link
                        prefetch={false}
                        href={userDetailPath(result.product.id, user.id)}
                        className="mt-4 inline-flex items-center gap-2 text-xs text-primary"
                      >
                        View user{" "}
                        <ArrowRight className="size-3" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
                {result.limited && (
                  <p className="border-t border-border px-5 py-3 text-xs text-amber-300">
                    Showing the first 20 matches. Refine the search to narrow
                    the results.
                  </p>
                )}
              </>
            ) : (
              <div className="px-5 py-7">
                {result.state === "not_found" ? (
                  <p className="text-sm text-muted-foreground">
                    No matching user found in this product.
                  </p>
                ) : (
                  <ReadProblem result={result} />
                )}
              </div>
            )}
          </section>
        ))}
      </div>
      {!results && !pending && !error && (
        <div className="rounded-lg border border-dashed border-border px-6 py-14 text-center">
          <Search
            className="mx-auto mb-4 size-7 text-muted-foreground"
            aria-hidden="true"
          />
          <h2 className="text-base font-medium">
            Find a user across your SaaS products
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Results stay separate so you can choose the right product and
            account.
          </p>
        </div>
      )}
    </div>
  );
}
