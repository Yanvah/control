"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MutationPanel } from "@/components/actions/mutation-panel";
import {
  detailResponseSchema,
  userDetailPath,
  type ProductSummary,
  type UserDetail,
} from "@/lib/users/models";
import { operationMessage, ReadProblem } from "./presentation";

export function UserDetailView({
  product,
  userId,
  initialDetail,
}: {
  product: ProductSummary;
  userId?: string;
  initialDetail: UserDetail;
}): React.JSX.Element {
  const [detail, setDetail] = useState<UserDetail | null>(initialDetail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<AbortController | null>(null);
  const version = useRef(0);
  const destination = userId
    ? userDetailPath(product.id, userId)
    : `/products/${product.id}/actions`;
  const load = useCallback(async (): Promise<boolean> => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    const attempt = ++version.current;
    try {
      const response = await fetch(`/api/products/${product.id}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userId ? { userId } : {}),
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (controller.signal.aborted || attempt !== version.current)
        return false;
      if (!response.ok) {
        const problem = z.object({ error: z.string() }).safeParse(payload);
        setError(operationMessage(problem.success ? problem.data.error : null));
        return false;
      }
      const result = detailResponseSchema.parse(payload);
      setDetail(result);
      return (
        Boolean(result.capabilities) &&
        (!userId || result.user.state === "ready")
      );
    } catch {
      if (!controller.signal.aborted && attempt === version.current) {
        setError("The remote record could not be loaded.");
      }
      return false;
    } finally {
      if (attempt === version.current) setLoading(false);
    }
  }, [product.id, userId]);
  const refresh = useCallback((): Promise<boolean> => {
    setLoading(true);
    setError(null);
    return load();
  }, [load]);
  useEffect(() => () => current.current?.abort(), []);
  return (
    <div className="space-y-7">
      <div>
        <Link
          href={userId ? "/users" : `/products/${product.id}`}
          className="mb-6 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {userId ? "User search" : "Product connection"}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-2 text-xs text-primary">{product.name}</p>
            <h1 className="break-words text-[28px] font-semibold tracking-tight">
              {userId ? "User details" : "Product actions"}
            </h1>
            {userId && (
              <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                {userId}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Refresh record
          </Button>
        </div>
      </div>
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading current product data…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-amber-300">
          {error}{" "}
          <Link
            href={`/login?next=${encodeURIComponent(destination)}`}
            className="underline"
          >
            Sign in again
          </Link>
        </p>
      )}
      {detail && (
        <>
          {userId && (
            <div className="grid gap-5 lg:grid-cols-2">
              <section
                aria-labelledby="user-record-heading"
                className="min-w-0 rounded-lg border border-border bg-card p-5"
              >
                <h2
                  id="user-record-heading"
                  className="mb-5 text-sm font-semibold"
                >
                  User record
                </h2>
                {detail.user.state !== "ready" ? (
                  <ReadProblem result={detail.user} />
                ) : detail.user.data === null ? (
                  <p className="text-sm text-muted-foreground">
                    User not found in this product.
                  </p>
                ) : (
                  <dl className="space-y-4 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Name</dt>
                      <dd className="mt-1 break-words">
                        {detail.user.data.name ?? "Not reported"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Email</dt>
                      <dd className="mt-1 break-all">
                        {detail.user.data.email ?? "Not reported"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Access</dt>
                      <dd className="mt-2">
                        <Badge variant="outline">
                          {detail.user.data.banned === undefined
                            ? "Not reported"
                            : detail.user.data.banned
                              ? "Banned"
                              : "Not banned"}
                        </Badge>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Created</dt>
                      <dd className="mt-1 break-all font-mono text-xs">
                        {detail.user.data.createdAt ?? "Not reported"}
                      </dd>
                    </div>
                  </dl>
                )}
              </section>
              <section
                aria-labelledby="subscription-heading"
                className="min-w-0 rounded-lg border border-border bg-card p-5"
              >
                <h2
                  id="subscription-heading"
                  className="mb-5 text-sm font-semibold"
                >
                  Subscription
                </h2>
                {detail.subscription.state !== "ready" ? (
                  <ReadProblem result={detail.subscription} />
                ) : detail.subscription.data === null ? (
                  <p className="text-sm text-muted-foreground">
                    No subscription found.
                  </p>
                ) : (
                  <dl className="space-y-4 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Plan ID</dt>
                      <dd className="mt-1 break-all font-mono">
                        {detail.subscription.data.planId}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Status</dt>
                      <dd className="mt-1">
                        {detail.subscription.data.status}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Subscription ID
                      </dt>
                      <dd className="mt-1 break-all font-mono text-xs">
                        {detail.subscription.data.id}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Current period ends
                      </dt>
                      <dd className="mt-1 break-all font-mono text-xs">
                        {detail.subscription.data.currentPeriodEnd ??
                          "Not reported"}
                      </dd>
                    </div>
                  </dl>
                )}
              </section>
            </div>
          )}
          {!userId && !detail.capabilities && (
            <ReadProblem
              result={
                detail.user.state === "ready"
                  ? { state: "failed", code: "INVALID_RESPONSE" }
                  : detail.user
              }
            />
          )}
          <div
            aria-busy={loading}
            className={loading ? "pointer-events-none opacity-60" : ""}
          >
            <MutationPanel
              detail={detail}
              userId={userId}
              destination={destination}
              refresh={refresh}
              disabled={loading || Boolean(error)}
            />
          </div>
        </>
      )}
    </div>
  );
}
