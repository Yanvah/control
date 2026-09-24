import { Badge } from "@/components/ui/badge";
import type { ReadFailure } from "@/lib/users/models";

const labels = {
  offline: "Offline",
  unauthorized: "Unauthorized",
  failed: "Failed",
  canceled: "Canceled",
  unsupported: "Not supported",
};
const messages: Record<string, string> = {
  AUTHENTICATION_FAILED:
    "The product rejected its credential. Check the connection in Products.",
  REQUEST_TIMEOUT: "The product did not respond before the deadline.",
  PRODUCT_UNAVAILABLE: "The product could not be reached.",
  ENDPOINT_UNAVAILABLE: "The product could not be reached.",
  PRODUCT_DISABLED:
    "This product is disabled. Enable it in Products before continuing.",
  PRODUCT_CHANGED:
    "The product configuration changed. Refresh before continuing.",
  CREDENTIAL_UNAVAILABLE:
    "The stored credential is unavailable. Review its encryption key or replace the credential.",
  INVALID_RESPONSE:
    "The product returned a response that could not be safely validated.",
  INVALID_INPUT:
    "The product rejected these parameters. Check its documented input requirements.",
  INVALID_REQUEST: "Check the requested operation and parameter values.",
  OPERATION_UNSUPPORTED: "This product does not expose this operation.",
  CAPABILITIES_CHANGED:
    "The product's capabilities changed. Refresh and review the operation again.",
  CONFIRMATION_REQUIRED: "Type the requested confirmation exactly.",
  USER_NOT_FOUND: "This user no longer exists in the product.",
  USER_ALREADY_EXISTS:
    "A user with this email already exists in the product. Search for that account before trying again.",
  CONNECTION_LIMIT: "Other requests are running. Wait, then try a new request.",
  REQUEST_ABORTED: "The request was canceled.",
  TOO_MANY_ATTEMPTS: "Too many requests. Wait a minute before continuing.",
  RECENT_AUTHENTICATION_REQUIRED: "Sign in again before running an operation.",
  UNAUTHORIZED: "Your session ended. Sign in again to continue.",
  UNSAFE_ENDPOINT:
    "The destination is blocked by the instance's network policy.",
  INVALID_ENDPOINT: "The product endpoint does not meet the network policy.",
  ATTEMPT_CONFLICT:
    "This attempt was already used for different parameters. Refresh and review a new operation.",
  ATTEMPT_NOT_FOUND:
    "No recorded attempt was found. The outcome cannot be confirmed.",
};
export function operationMessage(code: string | null): string {
  return (
    (code && messages[code]) ||
    "The request could not be completed. Review the product connection before continuing."
  );
}
export function ReadProblem({
  result,
}: {
  result: ReadFailure;
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <Badge variant="outline" className="text-amber-300">
        {labels[result.state]}
      </Badge>
      <p className="text-xs leading-5 text-muted-foreground">
        {operationMessage(result.code)}
      </p>
    </div>
  );
}
