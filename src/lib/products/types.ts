import type { Capabilities } from "@yanvah/control";

export type ProductStatus = "unknown" | "online" | "offline" | "degraded";

export type ProductView = {
  id: string;
  name: string;
  endpoint: string;
  enabled: boolean;
  keyId: string;
  status: ProductStatus;
  capabilities: Capabilities | null;
  lastConnectedAt: string | null;
  lastTestedAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CredentialInput =
  { mode: "generate" } | { mode: "existing"; keyId: string; secret: string };
export type ProductWriteResult = {
  product: ProductView;
  credentials?: { keyId: string; secret: string };
};
