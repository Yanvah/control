# SDK contract used by Control

The application pins the published `@yanvah/control` **0.2.1** ESM package and imports only its documented public exports. CI and container builds install it from the committed lockfile. Developers may temporarily link a matching built sibling checkout without changing dependency manifests. No SDK protocol implementation is copied into Control; see [installation](INSTALLATION.md) for the package boundary.

## Package exports

- `@yanvah/control`: protocol constants, operation/error names, shared types and public Zod schemas. Control uses `Capabilities`, `capabilitiesSchema`, and `requestHeadersSchema.shape.keyId` rather than inventing replacements.
- `@yanvah/control/client`: `createControlClient`, `ControlClientError`, and client types.
- `@yanvah/control/server`: `createControlHandler`, `createMemoryReplayStore`, and server types. Used by the local SaaS test fixtures, not by the browser.

## Client construction and execution

```ts
import { createControlClient } from "@yanvah/control/client";

const client = createControlClient({
  endpoint,
  keyId,
  secret,
  protocolVersion: "2",
  timeoutMs: 5_000,
  maxResponseBytes: 262_144,
  fetch: restrictedTransport.fetch,
});
const capabilities = await client.getCapabilities({ signal });
```

The optional `fetch` implements the standard fetch signature and returns a global `Response`. The SDK owns HTTP request construction, exact-byte signing, response parsing, request correlation, and runtime validation. Control's transport only enforces destination policy and resource limits. Capability discovery uses `getCapabilities()`, which calls `system.capabilities` with empty input. Phase 3 invokes the standard operations and explicitly advertised actions below; all signing, response validation, and correlation remain in the SDK.

The SDK requires HTTPS. Its sole HTTP exception is a loopback hostname (`localhost`, `127.0.0.1`, or `[::1]`), so Control's HTTP opt-in cannot allow arbitrary private HTTP endpoints. Both URL credentials and query/fragment components are rejected by the SDK. The Control policy is stricter by default and requires explicit local-development opt-ins for loopback.

Control probes v2 discovery first and tries v1 only when v2 authentication is rejected. It pins every subsequent call to the discovered version; a creation request is never retried under another protocol version.

## Credentials

Each connection uses a key ID matching `[A-Za-z0-9_-]{1,128}` and an independent secret containing at least one non-whitespace character and **32–1024 UTF-8 bytes**. The secret is literal UTF-8 text; it is not decoded from hex/base64 by the SDK. Generated Control secrets are random base64url text of sufficient length. The same key ID and exact secret must be configured at the SaaS endpoint.

The SDK signs protocol version, key ID, method, pathname, timestamp, request ID, and the exact body hash. Signing remains internal to the SDK. Never log secrets, signatures, or authentication headers.

## Validated discovery result

`Capabilities` has exactly:

```text
product: { id, name }
sdkVersion: string
protocolVersion: "1" | "2"
operations: OperationName[]
actions: { id, label, description, risk: "safe" | "caution" | "dangerous" }[]
```

Discovery must advertise `system.capabilities`. Operations and action IDs are unique; `actions.invoke` is advertised exactly when actions exist. Action metadata contains neither executable functions nor input schemas. Control validates stored metadata with the public schema and renders text safely. Local registry names/IDs remain distinct from remote product names/IDs.

## Errors, timeouts, and replay

`ControlClientError` has a fixed sanitized message, `code`, and generated `requestId`. Codes are `AUTHENTICATION_FAILED`, `REQUEST_EXPIRED`, `REQUEST_REPLAYED`, `INVALID_INPUT`, `OPERATION_UNSUPPORTED`, `USER_ALREADY_EXISTS`, `PRODUCT_UNAVAILABLE`, `REQUEST_TIMEOUT`, `INTERNAL_ERROR`, plus client-local `INVALID_RESPONSE` and `REQUEST_ABORTED`.

The SDK defaults to 10 seconds (maximum 60 seconds) and a decoded response limit of 1 MiB (maximum 10 MiB). Control explicitly selects 5 seconds and 256 KiB. The deadline covers transport and response validation. Each attempt uses a fresh request ID/signature; the SDK never retries and rejects redirects. Caller cancellation is `REQUEST_ABORTED`, timeout is `REQUEST_TIMEOUT`, and malformed responses are `INVALID_RESPONSE`. Transport exceptions are sanitized as `PRODUCT_UNAVAILABLE`.

The SaaS handler checks timestamp skew (default/max five minutes) and atomically consumes each request ID through its replay store. The supplied in-memory store is process-local and loses state on restart; SaaS production deployments must use suitable persistent/shared replay storage. Control uses the SDK unchanged, and does not implement its own replay or signing logic.

Creation appears only when fresh v2 discovery advertises `users.create`. Its email, name, and returned user stay transient; operation receipts and audit events contain only a keyed target reference and safe status. `USER_ALREADY_EXISTS` is a definite failed outcome when the SaaS confirms no account was created. A lost response stays unknown.

## Transport policy references

Control adds destination restrictions around the SDK's fetch hook using [Node HTTP](https://nodejs.org/api/http.html) and [HTTPS](https://nodejs.org/api/https.html) APIs. Its permanent metadata exclusions include the IPv4/IPv6 addresses documented by [AWS EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html), [Google Compute Engine](https://docs.cloud.google.com/compute/docs/metadata/querying-metadata), and [Azure](https://learn.microsoft.com/en-us/azure/virtual-machines/instance-metadata-service). Explicit private-network access does not bypass these exclusions.

## Phase 3 operation surface

| SDK operation | Input | Validated result |
| --- | --- | --- |
| `users.create` (v2) | `{ email, name? }` | `{ user: User }` |
| `users.search` | `{ query, limit? }` (Control requests 20) | `{ users: User[] }` |
| `users.get` | `{ userId }` | `{ user: User \| null }` |
| `users.ban` | `{ userId, reason? }` | `null` |
| `users.unban` | `{ userId }` | `null` |
| `users.revokeSessions` | `{ userId }` | `null` |
| `subscriptions.get` | `{ userId }` | `{ subscription: Subscription \| null }` |
| `subscriptions.changePlan` | `{ userId, planId }` | `null` |
| `actions.invoke` | `{ actionId, input: JsonValue }` | `JsonValue` |

Control consumes `operationInputSchemas`, `userSchema`, `subscriptionSchema`, `capabilitiesSchema`, and `jsonValueSchema` through the public package. The client validates operation-specific results and verifies that returned user/subscription IDs match the requested target. IDs are opaque strings of 1–256 characters; user-detail links encode them in a single query parameter so slashes and dot segments cannot change the route.

`User` permits `id`, optional nullable `email`/`name`, optional `banned`, and optional `createdAt`. `Subscription` contains `id`, `userId`, `planId`, `status`, and optional nullable `currentPeriodEnd`. There is no arbitrary user-field extension or plan-list operation in this SDK version.

The action's private Zod `input` schema and executable `run` function remain inside the SaaS. Discovery does not serialize them. Control renders metadata-driven action controls with safe JSON parameters; the handler validates the product-specific schema before `run`. Outputs use the SDK safe JSON tree (including depth and unsafe-key restrictions), response bounds, credential-exposure checks, and a limited text preview. Field-specific generated forms would require a future SDK contract extension, not an invented protocol in Control.

Each invocation receives the authenticated owner as its signed `actor`. The SDK generates the wire request ID; Control reads only the public `CONTROL_HEADERS.requestId` field for operation receipts and never generates replacement signatures or protocol envelopes. A separate Control attempt ID prevents replaying a browser submission across application restarts.

Capability fingerprints bind a confirmation to the discovered metadata. Immediately before execution, Control re-discovers capabilities and checks the fingerprint, advertised operation/action, required confirmation, enabled state, and credential revision. A returned success is authoritative; `AUTHENTICATION_FAILED`, `REQUEST_EXPIRED`, `INVALID_INPUT`, and `OPERATION_UNSUPPORTED` are pre-execution rejections. Other failures after dispatch are conservatively unknown, including `INTERNAL_ERROR`, since a handler may throw after changing data.
