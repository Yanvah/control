import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getEnv, type ControlEnv } from "@/lib/env";

export type EndpointPolicy = Pick<
  ControlEnv,
  | "NODE_ENV"
  | "CONTROL_ALLOW_HTTP_ENDPOINTS"
  | "CONTROL_ALLOW_PRIVATE_ENDPOINTS"
>;
export type EndpointErrorCode =
  | "INVALID_ENDPOINT"
  | "UNSAFE_ENDPOINT"
  | "ENDPOINT_UNAVAILABLE"
  | "REQUEST_ABORTED"
  | "REQUEST_TIMEOUT"
  | "REDIRECT_BLOCKED"
  | "TOO_MANY_REQUESTS";

const messages: Record<EndpointErrorCode, string> = {
  INVALID_ENDPOINT:
    "Enter a valid HTTPS product endpoint without credentials, query, or fragment.",
  UNSAFE_ENDPOINT:
    "This destination is blocked by the endpoint security policy.",
  ENDPOINT_UNAVAILABLE: "The product endpoint could not be reached.",
  REQUEST_ABORTED: "The connection attempt was canceled.",
  REQUEST_TIMEOUT: "The product endpoint did not respond in time.",
  REDIRECT_BLOCKED: "Product endpoints must not redirect requests.",
  TOO_MANY_REQUESTS: "Too many product connection attempts are in progress.",
};

export class EndpointError extends Error {
  override readonly name = "EndpointError";
  constructor(readonly code: EndpointErrorCode) {
    super(messages[code]);
  }
}

export interface ResolvedEndpoint {
  url: URL;
  address: string;
  family: 4 | 6;
}

const DNS_TIMEOUT_MS = 3_000;
const metadataNames = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
]);

function ipv4Number(address: string): bigint {
  return address
    .split(".")
    .reduce((result, octet) => (result << 8n) | BigInt(octet), 0n);
}

function ipv6Number(address: string): bigint {
  // isIP has already checked the syntax. Normalize embedded IPv4 before expanding ::.
  const normalized = address.replace(/\d+\.\d+\.\d+\.\d+$/, (ipv4) => {
    const value = ipv4Number(ipv4);
    return `${(value >> 16n).toString(16)}:${(value & 0xffffn).toString(16)}`;
  });
  const halves = normalized.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const parts =
    halves.length === 1
      ? left
      : [
          ...left,
          ...Array<string>(8 - left.length - right.length).fill("0"),
          ...right,
        ];
  return parts.reduce(
    (result, part) => (result << 16n) | BigInt(`0x${part}`),
    0n,
  );
}

function inRange(
  value: bigint,
  base: bigint,
  prefix: number,
  bits: number,
): boolean {
  const shift = BigInt(bits - prefix);
  return value >> shift === base >> shift;
}

function localAllowed(policy: EndpointPolicy): boolean {
  return (
    policy.NODE_ENV !== "production" &&
    policy.CONTROL_ALLOW_HTTP_ENDPOINTS &&
    policy.CONTROL_ALLOW_PRIVATE_ENDPOINTS
  );
}

function assertAddressAllowed(address: string, policy: EndpointPolicy): 4 | 6 {
  const family = isIP(address);
  if (!family || address.includes("%"))
    throw new EndpointError("UNSAFE_ENDPOINT");
  if (family === 4) {
    const value = ipv4Number(address);
    const within = (base: string, prefix: number): boolean =>
      inRange(value, ipv4Number(base), prefix, 32);
    // Link-local/metadata and special-purpose ranges stay blocked with private opt-in.
    if (
      [
        ["0.0.0.0", 8],
        ["169.254.0.0", 16],
        ["192.0.0.0", 24],
        ["192.0.2.0", 24],
        ["192.88.99.0", 24],
        ["198.18.0.0", 15],
        ["198.51.100.0", 24],
        ["203.0.113.0", 24],
        ["224.0.0.0", 4],
        ["240.0.0.0", 4],
      ].some(([base, prefix]) => within(String(base), Number(prefix))) ||
      address === "100.100.100.200" ||
      address === "168.63.129.16"
    ) {
      throw new EndpointError("UNSAFE_ENDPOINT");
    }
    if (within("127.0.0.0", 8)) {
      if (!localAllowed(policy)) throw new EndpointError("UNSAFE_ENDPOINT");
    } else if (
      [
        ["10.0.0.0", 8],
        ["172.16.0.0", 12],
        ["192.168.0.0", 16],
        ["100.64.0.0", 10],
      ].some(([base, prefix]) => within(String(base), Number(prefix))) &&
      !policy.CONTROL_ALLOW_PRIVATE_ENDPOINTS
    ) {
      throw new EndpointError("UNSAFE_ENDPOINT");
    }
    return 4;
  }
  const value = ipv6Number(address);
  const within = (base: string, prefix: number): boolean =>
    inRange(value, ipv6Number(base), prefix, 128);
  if (value === 1n && localAllowed(policy)) return 6;
  if (within("fc00::", 7)) {
    // AWS and Google metadata use ULA addresses, including Google's HTTPS endpoint:
    // https://docs.cloud.google.com/compute/docs/metadata/querying-metadata#metadata_server_endpoints
    const metadata =
      value === ipv6Number("fd00:ec2::254") ||
      value === ipv6Number("fd20:ce::254");
    if (policy.CONTROL_ALLOW_PRIVATE_ENDPOINTS && !metadata) return 6;
    throw new EndpointError("UNSAFE_ENDPOINT");
  }
  // Permit global unicast only. This excludes mapped/translated IPv4, link-local,
  // multicast, unspecified and reserved space; reject transition/documentation ranges too.
  if (
    !within("2000::", 3) ||
    within("2001::", 23) ||
    within("2001:db8::", 32) ||
    within("2002::", 16) ||
    within("3ffe::", 16) ||
    within("3fff::", 20)
  ) {
    throw new EndpointError("UNSAFE_ENDPOINT");
  }
  return 6;
}

export function validateEndpoint(
  value: string,
  policy: EndpointPolicy = getEnv(),
): string {
  if (
    value.length > 2_048 ||
    !/^https?:\/\//i.test(value) ||
    /[\s\\?#]/.test(value)
  )
    throw new EndpointError("INVALID_ENDPOINT");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new EndpointError("INVALID_ENDPOINT");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.hostname.endsWith(".")
  )
    throw new EndpointError("INVALID_ENDPOINT");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      localAllowed(policy) &&
      ["localhost", "127.0.0.1", "::1"].includes(hostname)
    )
  ) {
    throw new EndpointError("INVALID_ENDPOINT");
  }
  if (
    metadataNames.has(hostname) ||
    hostname.endsWith(".metadata.google.internal")
  )
    throw new EndpointError("UNSAFE_ENDPOINT");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    if (!localAllowed(policy)) throw new EndpointError("UNSAFE_ENDPOINT");
  }
  if (isIP(hostname)) assertAddressAllowed(hostname, policy);
  return url.href;
}

export async function resolveEndpoint(
  endpoint: string,
  signal?: AbortSignal,
  policy: EndpointPolicy = getEnv(),
): Promise<ResolvedEndpoint> {
  const url = new URL(validateEndpoint(endpoint, policy));
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (signal?.aborted) throw new EndpointError("REQUEST_ABORTED");
  if (isIP(hostname))
    return {
      url,
      address: hostname,
      family: assertAddressAllowed(hostname, policy),
    };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const canceled = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new EndpointError("REQUEST_TIMEOUT")),
        DNS_TIMEOUT_MS,
      );
      abort = (): void => reject(new EndpointError("REQUEST_ABORTED"));
      signal?.addEventListener("abort", abort, { once: true });
    });
    const addresses = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      canceled,
    ]);
    if (addresses.length === 0 || addresses.length > 64)
      throw new EndpointError("UNSAFE_ENDPOINT");
    // Reject mixed answers rather than selecting the one safe address an attacker supplied.
    for (const result of addresses) {
      if (assertAddressAllowed(result.address, policy) !== result.family)
        throw new EndpointError("UNSAFE_ENDPOINT");
      if (
        url.protocol === "http:" &&
        !(result.address.startsWith("127.") || result.address === "::1")
      )
        throw new EndpointError("UNSAFE_ENDPOINT");
    }
    if (signal?.aborted) throw new EndpointError("REQUEST_ABORTED");
    return {
      url,
      address: addresses[0].address,
      family: addresses[0].family as 4 | 6,
    };
  } catch (error: unknown) {
    if (error instanceof EndpointError) throw error;
    throw new EndpointError("ENDPOINT_UNAVAILABLE");
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}

export async function validateProductEndpoint(
  value: string,
  policy: EndpointPolicy = getEnv(),
): Promise<string> {
  return (await resolveEndpoint(value, undefined, policy)).url.href;
}
