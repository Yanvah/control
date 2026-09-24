import { Badge } from "@/components/ui/badge";
import type { ProductView } from "@/lib/products/types";
import { cn } from "@/lib/utils";

export function ProductStatus({
  product,
}: {
  product: Pick<ProductView, "enabled" | "status">;
}): React.JSX.Element {
  const status = product.enabled ? product.status : "disabled";
  const labels = {
    online: "Online",
    offline: "Offline",
    degraded: "Degraded",
    unknown: "Unknown",
    disabled: "Disabled",
  };
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 text-[10px] font-medium",
        status === "online" && "border-primary/25 text-primary",
        status === "offline" && "border-destructive/25 text-destructive",
        status === "degraded" && "border-amber-400/25 text-amber-300",
        (status === "unknown" || status === "disabled") &&
          "text-muted-foreground",
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {labels[status]}
    </Badge>
  );
}

export function formatProductDate(value: string | null): string {
  if (!value) return "Never";
  return `${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value))} UTC`;
}

const safeMessages: Record<string, string> = {
  INVALID_REQUEST: "Check the product name, endpoint, and credential fields.",
  INVALID_ENDPOINT:
    "Use a complete endpoint URL without credentials, a query, or a fragment.",
  UNSAFE_ENDPOINT: "This endpoint is blocked by the instance’s network policy.",
  ENDPOINT_UNAVAILABLE: "The endpoint could not be resolved or reached.",
  AUTHENTICATION_FAILED:
    "The product rejected this credential. Check the key ID and shared secret on both sides.",
  REQUEST_TIMEOUT:
    "The product did not respond before the connection deadline.",
  PRODUCT_UNAVAILABLE: "The product could not be reached.",
  INVALID_RESPONSE:
    "The product returned a response that could not be validated.",
  RESPONSE_TOO_LARGE: "The product response exceeded the allowed size.",
  REDIRECT_BLOCKED:
    "The endpoint returned a redirect. Use the final SDK endpoint URL.",
  NETWORK_ERROR: "The connection could not be completed.",
  PRODUCT_NOT_FOUND:
    "This product no longer exists. Return to the product list.",
  PRODUCT_DISABLED: "Enable this product before testing its connection.",
  PRODUCT_BUSY:
    "A connection test is already running for this product. Wait, then refresh.",
  CONNECTION_LIMIT:
    "Other connection tests are running. Wait before testing again.",
  PRODUCT_CHANGED:
    "This product changed while the request was running. Refresh before continuing.",
  CONFIRMATION_REQUIRED:
    "Type the product name exactly to confirm this change.",
  CREDENTIAL_REUSED:
    "Each product needs its own credential. Generate a new one or enter a different secret.",
  TOO_MANY_ATTEMPTS: "Too many attempts. Wait a minute before trying again.",
  RECENT_AUTHENTICATION_REQUIRED:
    "Sign in again to confirm your identity before changing this product.",
  UNAUTHORIZED: "Your session has ended. Sign in again to continue.",
};

export function productErrorMessage(code: string | null): string {
  if (!code) return "No connection error recorded.";
  return (
    safeMessages[code] ??
    "The connection or change could not be completed. Check the product configuration before trying again."
  );
}
