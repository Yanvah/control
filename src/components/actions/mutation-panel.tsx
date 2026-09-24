"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { ActionCapability } from "@yanvah/control";
import { z } from "zod";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  mutationRequestSchema,
  mutationResultSchema,
  type MutationRequest,
  type MutationResult,
  type UserDetail,
} from "@/lib/users/models";
import { JsonResult } from "./json-result";
import { operationMessage } from "@/components/users/presentation";

type Choice = {
  operation: MutationRequest["operation"];
  label: string;
  consequence: string;
  action?: ActionCapability;
};
const standard: Choice[] = [
  {
    operation: "users.ban",
    label: "Ban user",
    consequence:
      "Prevent this user from accessing the product, according to its ban policy.",
  },
  {
    operation: "users.unban",
    label: "Unban user",
    consequence: "Remove this user's ban in the selected product.",
  },
  {
    operation: "users.revokeSessions",
    label: "Revoke sessions",
    consequence: "End this user's active sessions in the selected product.",
  },
  {
    operation: "subscriptions.changePlan",
    label: "Change plan",
    consequence:
      "Change this user's subscription plan. The SaaS applies its own billing and access rules.",
  },
];
const textareaClass =
  "min-h-28 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function MutationPanel({
  detail,
  userId,
  destination,
  refresh,
  disabled = false,
}: {
  detail: UserDetail;
  userId?: string;
  destination: string;
  disabled?: boolean;
  refresh: () => Promise<boolean>;
}): React.JSX.Element {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [reason, setReason] = useState("");
  const [planId, setPlanId] = useState("");
  const [parameters, setParameters] = useState("{}");
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [result, setResult] = useState<MutationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const capabilities = detail.capabilities;
  if (!capabilities || !detail.capabilityVersion)
    return (
      <p className="text-xs text-muted-foreground">
        Refresh a successful capability lookup before running operations.
      </p>
    );
  const userUnavailable =
    detail.user.state !== "ready" && detail.user.state !== "unsupported";
  const commands =
    userId &&
    !userUnavailable &&
    !(detail.user.state === "ready" && detail.user.data === null)
      ? standard.filter((item) =>
          capabilities.operations.includes(item.operation),
        )
      : [];
  const actions: Choice[] = capabilities.actions.map((action) => ({
    operation: "actions.invoke",
    label: action.label,
    consequence: action.description,
    action,
  }));
  const dangerous =
    choice?.operation === "users.ban" || choice?.action?.risk === "dangerous";
  const expected =
    choice?.operation === "users.ban" ? (userId ?? "") : detail.product.name;

  function open(next: Choice): void {
    setChoice(next);
    setConfirmation("");
    setAcknowledged(false);
    setReason("");
    setPlanId("");
    setParameters("{}");
    setError(null);
    setReauth(false);
  }
  async function acceptOutcome(outcome: MutationResult): Promise<void> {
    setResult(outcome);
    setNeedsReview(outcome.state === "unknown" || outcome.state === "pending");
    if (outcome.state === "succeeded") setRefreshFailed(!(await refresh()));
  }
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (
      !choice ||
      submitting.current ||
      disabled ||
      !acknowledged ||
      (dangerous && confirmation !== expected)
    )
      return;
    const attemptId = crypto.randomUUID();
    let input: unknown;
    try {
      input =
        choice.operation === "actions.invoke"
          ? { actionId: choice.action?.id, input: JSON.parse(parameters) }
          : choice.operation === "subscriptions.changePlan"
            ? { userId, planId }
            : choice.operation === "users.ban"
              ? { userId, ...(reason.trim() ? { reason } : {}) }
              : { userId };
    } catch {
      setError("Enter valid JSON parameters before continuing.");
      return;
    }
    const parsed = mutationRequestSchema.safeParse({
      attemptId,
      operation: choice.operation,
      input,
      capabilityVersion: detail.capabilityVersion,
      confirmed: true,
      confirmation,
    });
    if (!parsed.success) {
      setError("Check the parameters and required fields before continuing.");
      return;
    }
    submitting.current = true;
    setPending(true);
    setResult(null);
    setError(null);
    setReauth(false);
    setRefreshFailed(false);
    try {
      const response = await fetch(
        `/api/products/${detail.product.id}/operations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );
      const payload: unknown = await response.json();
      setChoice(null);
      if (!response.ok) {
        const problem = z.object({ error: z.string() }).safeParse(payload);
        const code = problem.success ? problem.data.error : null;
        // Unrecognized server failures may follow dispatch or receipt storage failure.
        if (response.status >= 500) {
          await acceptOutcome({
            attemptId,
            state: "unknown",
            code,
            requestId: null,
          });
          return;
        }
        setReauth(
          response.status === 401 || code === "RECENT_AUTHENTICATION_REQUIRED",
        );
        setError(operationMessage(code));
        return;
      }
      await acceptOutcome(mutationResultSchema.parse(payload));
    } catch {
      setChoice(null);
      await acceptOutcome({
        attemptId,
        state: "unknown",
        code: null,
        requestId: null,
      });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  async function checkOutcome(): Promise<void> {
    if (!result || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/operations/${result.attemptId}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        setError(
          response.status === 401
            ? "Sign in again to check the recorded outcome."
            : "The outcome could not be confirmed. Refresh the remote record before considering another operation.",
        );
        return;
      }
      await acceptOutcome(mutationResultSchema.parse(await response.json()));
    } catch {
      setError("The recorded outcome could not be reached.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  return (
    <section aria-labelledby="operation-heading" className="space-y-5">
      <div>
        <h2 id="operation-heading" className="text-lg font-medium">
          Supported operations
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Review each operation before sending it to {detail.product.name}.
        </p>
      </div>
      {commands.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {commands.map((item) => (
            <Button
              key={item.operation}
              variant="outline"
              disabled={pending || needsReview || disabled}
              onClick={() => open(item)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      )}
      {actions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Product actions</h3>
          <p className="text-xs leading-5 text-muted-foreground">
            These actions target the product. Check their parameters carefully;
            an open user record does not automatically limit their scope.
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            {actions.map((item) => (
              <div
                key={item.action?.id}
                className="min-w-0 rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <h4 className="min-w-0 break-words text-sm font-medium">
                    {item.label}
                  </h4>
                  <Badge variant="outline">{item.action?.risk}</Badge>
                </div>
                <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">
                  {item.consequence}
                </p>
                <Button
                  className="mt-4"
                  size="sm"
                  variant="outline"
                  disabled={pending || needsReview || disabled}
                  onClick={() => open(item)}
                >
                  Run {item.label}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
      {commands.length === 0 && actions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No operations are available for this record.
        </p>
      )}
      {pending && (
        <p role="status" className="text-sm text-muted-foreground">
          Waiting for the operation. Do not submit it again.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-amber-300">
          {error}
        </p>
      )}
      {reauth && (
        <Link
          className="text-sm text-primary underline"
          href={`/login?reauth=1&next=${encodeURIComponent(destination)}`}
        >
          Sign in again
        </Link>
      )}
      {result && (
        <div
          role="status"
          aria-live="polite"
          className="space-y-3 rounded-lg border border-border bg-card p-5"
        >
          <h3 className="font-medium">
            {result.state === "succeeded"
              ? "Operation succeeded"
              : result.state === "failed"
                ? "Operation failed"
                : result.state === "pending"
                  ? "Operation still running"
                  : "Outcome unknown"}
          </h3>
          {result.state === "unknown" || result.state === "pending" ? (
            <p className="text-sm leading-6 text-amber-300">
              The product may have completed this operation. It has not been
              retried. Check its recorded outcome or refresh the remote record
              before considering a new operation.
            </p>
          ) : result.state === "failed" ? (
            <p className="text-sm text-muted-foreground">
              {operationMessage(result.code)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              The product confirmed success.
              {refreshFailed
                ? " The remote record could not be refreshed; refresh it manually."
                : " Remote state has been refreshed."}
            </p>
          )}
          <p className="break-all font-mono text-[10px] text-muted-foreground">
            Attempt {result.attemptId}
            {result.requestId && <> · Request {result.requestId}</>}
          </p>
          {result.output !== undefined && result.output !== null && (
            <div>
              <h4 className="mb-2 text-xs font-medium">Action result</h4>
              <JsonResult value={result.output} />
            </div>
          )}
          {(result.state === "unknown" || result.state === "pending") && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => void checkOutcome()}
            >
              Check recorded outcome
            </Button>
          )}
          {(needsReview || refreshFailed || result.state === "failed") && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              className="ml-2"
              onClick={() => {
                setPending(true);
                void refresh()
                  .then((ok) => {
                    if (ok) {
                      setNeedsReview(false);
                      setRefreshFailed(false);
                    } else setError("Remote state could not be refreshed.");
                  })
                  .finally(() => setPending(false));
              }}
            >
              Refresh remote record
            </Button>
          )}
        </div>
      )}
      <AlertDialog
        open={choice !== null}
        onOpenChange={(openState) => {
          if (!openState && !pending) setChoice(null);
        }}
      >
        <AlertDialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={(event) => void submit(event)} className="space-y-5">
            <AlertDialogHeader>
              <AlertDialogTitle>{choice?.label}</AlertDialogTitle>
              <AlertDialogDescription className="break-words">
                {choice?.consequence}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <dl className="space-y-2 rounded-md border border-border bg-secondary/30 p-3 text-xs">
              <div>
                <dt className="text-muted-foreground">Product</dt>
                <dd className="mt-1 break-all font-medium">
                  {detail.product.name}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Target</dt>
                <dd className="mt-1 break-all font-mono">
                  {choice?.operation === "actions.invoke"
                    ? `Product: ${detail.product.name}`
                    : userId}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Operation</dt>
                <dd className="mt-1 break-all font-mono">
                  {choice?.action?.id ?? choice?.operation}
                </dd>
              </div>
            </dl>
            {choice?.operation === "users.ban" && (
              <div className="space-y-2">
                <Label htmlFor="ban-reason">Reason (optional)</Label>
                <Input
                  id="ban-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={2000}
                  disabled={pending}
                />
              </div>
            )}
            {choice?.operation === "subscriptions.changePlan" && (
              <div className="space-y-2">
                <Label htmlFor="new-plan">New plan ID</Label>
                <Input
                  id="new-plan"
                  value={planId}
                  onChange={(event) => setPlanId(event.target.value)}
                  maxLength={256}
                  required
                  disabled={pending}
                />
                <p className="text-xs text-muted-foreground">
                  Use a plan ID accepted by this SaaS. The product validates it
                  before changing the subscription.
                </p>
              </div>
            )}
            {choice?.operation === "actions.invoke" && (
              <div className="space-y-2">
                <Label htmlFor="action-parameters">
                  Action parameters (JSON)
                </Label>
                <textarea
                  id="action-parameters"
                  className={textareaClass}
                  value={parameters}
                  onChange={(event) => setParameters(event.target.value)}
                  maxLength={12000}
                  spellCheck={false}
                  disabled={pending}
                  required
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  Use the parameters documented by this product. Its input rules
                  are checked by the SaaS before the action runs.
                </p>
              </div>
            )}
            {dangerous && (
              <div className="space-y-2">
                <Label htmlFor="operation-confirmation">
                  Type {expected} to confirm
                </Label>
                <Input
                  id="operation-confirmation"
                  autoComplete="off"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={pending}
                  required
                />
              </div>
            )}
            <label className="flex items-start gap-3 text-sm">
              <input
                className="mt-1 accent-primary"
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                disabled={pending}
              />
              <span>
                I reviewed the product, target, parameters, and consequences.
              </span>
            </label>
            <p className="text-xs text-muted-foreground">
              Requires a sign-in within the last five minutes.
            </p>
            {error && (
              <p role="alert" className="text-sm text-amber-300">
                {error}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <Button
                type="submit"
                variant={dangerous ? "destructive" : "default"}
                disabled={
                  pending ||
                  !acknowledged ||
                  (dangerous && confirmation !== expected)
                }
              >
                {pending ? "Sending…" : "Confirm operation"}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
