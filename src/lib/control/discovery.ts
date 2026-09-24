import "server-only";
import type { Capabilities, ProtocolVersion } from "@yanvah/control";
import {
  ControlClientError,
  type ControlClient,
  type ControlInvokeOptions,
} from "@yanvah/control/client";

export async function discoverCapabilities(
  clientFor: (version: ProtocolVersion) => ControlClient,
  options?: ControlInvokeOptions,
): Promise<{ client: ControlClient; capabilities: Capabilities }> {
  const v2 = clientFor("2");
  try {
    return { client: v2, capabilities: await v2.getCapabilities(options) };
  } catch (error) {
    if (
      !(error instanceof ControlClientError) ||
      error.code !== "AUTHENTICATION_FAILED"
    )
      throw error;
  }
  // A v1 handler rejects the v2 header before parsing. Only discovery falls back.
  const v1 = clientFor("1");
  return { client: v1, capabilities: await v1.getCapabilities(options) };
}
