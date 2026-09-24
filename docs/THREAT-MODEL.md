# Threat model

Scope: the single-owner Node.js application, its SQLite database, browser interface, server-side `@yanvah/control` integration, and Phase 5 container/maintenance boundary. SaaS applications remain the source of truth. Control neither connects to their databases nor synchronizes their user directories.

## Assets and trust boundaries

```text
Untrusted browser/network
  -> configured Control origin and owner session
  -> privileged Control server + private SQLite database
  -> server-only SDK client and restricted HTTP transport
  -> independently operated SaaS SDK endpoints
```

Protect owner credentials/passkeys, session tokens, setup and encryption secrets, each product's independent credential, SaaS administration authority, and reliable operation history. The host operator, application code, runtime dependencies, and configured TLS proxy are trusted. Browser input, forwarded headers, DNS answers, remote endpoints, capability descriptions, custom-action parameters, and remote results are untrusted. A valid SDK signature authenticates a peer; it does not make its data safe to execute or display as HTML.

## Threats, controls, and residual risk

| Threat | Implemented control | Limit |
| --- | --- | --- |
| Unauthenticated setup takeover or second owner | Independent setup token, immediate transaction, unique owner, permanent setup marker and database triggers | Protect the token before first setup; remove it afterward. Host/database administrators can bypass application controls. |
| Password guessing, stolen or stale sessions | Durable global login/setup limits, password hashing, user-verified passkeys, HTTP-only SameSite cookies, database session checks and revocation, five-minute authentication requirement for dangerous work | Global limits can delay the owner during hostile traffic. They do not stop a host compromise or an attacker operating within a stolen recently authenticated session. |
| CSRF or input injection | Exact configured origin and Fetch Metadata checks, bounded JSON parsing, runtime schemas, restricted auth endpoints, CSP, escaped text rendering | Browser extensions and a compromised owner device are outside this boundary. UI confirmation is not independent approval. |
| SSRF, DNS rebinding, metadata access or redirects | HTTPS in production, explicit private-network opt-in, validation of every DNS answer, socket IP pinning with original TLS identity, blocked metadata/reserved addresses and redirects | A permitted SaaS endpoint may itself proxy work elsewhere. Protect the host with appropriate egress policy. OS DNS jobs can outlive the caller's timeout. |
| Malicious or unavailable SaaS | Real SDK validation/signing, deadlines, body/header limits, bounded concurrency/queues, separate product results, plain-text metadata/output rendering | SaaS business logic and allowed custom actions remain the product operator's responsibility. Control cannot establish distributed exactly-once execution or undo a remote change. |
| Accidental or repeated privileged operations | Fresh capabilities and credential revisions, explicit/typed confirmations, recent authentication, browser submit guards, durable remote attempt IDs and input fingerprints | A deliberately new confirmation is a new attempt. Registry/security forms have submit guards but do not provide a general remote idempotency protocol. |
| Lost response or process interruption | Requested intent before work, terminal outcomes, conservative unknown state, no mutation retry, duplicate attempts return stored receipts | Unknown can mean the remote change happened. Inspect remote state before a new attempt. SQLite and a SaaS cannot share one transaction. |
| Product-secret disclosure | AES-256-GCM with authenticated context, independent credentials, one-time issuance, server-only modules, no saved-secret retrieval, safe errors | Encryption does not protect a running compromised host or an attacker with both configuration and database. Generated credentials necessarily appear once in the owner's browser. |
| Sensitive data in history or logs | Central allowlists, fixed actions/codes, UUID-only correlation IDs, keyed target references, no inputs/headers/raw errors/remote payloads, structured JSON logger | Owner/product IDs and timing remain operational metadata. Earlier Phase 3 receipts keep their original target IDs. Framework/proxy logs and test traces require separate access and retention controls. |
| Audit editing, deletion, reordering or forgery | Append-only triggers, sequence numbers, HMAC chain, full startup/manual verification, tail verification on append, audit-write failures block undispatched work | Triggers cannot stop a database administrator. The chain detects middle-row edits/deletions/reordering without the key, but not suffix deletion or rollback to an older valid database without an external checkpoint. Host/key compromise defeats this protection. |
| Resource exhaustion | Durable request limits, bounded payloads/concurrency, indexed audit queries with 50-row pages, five integrity checks per minute, verification in 500-row batches | Disk history grows without automatic retention. Full verification and legacy receipt import take time proportional to history. Public ingress needs host/proxy capacity controls. |
| Container or deployment misuse | Non-root runtime, read-only root filesystem, `/data` volume, dropped capabilities, no-new-privileges, host loopback publication, runtime-only secrets | The Docker host/daemon and TLS proxy are trusted. Container isolation does not protect against host administrators. Operator-supplied networks, volumes, or privileged overrides can defeat defaults. |
| Backup loss, incompatible downgrade, or migration tampering | Explicit offline maintenance, verified SQLite snapshots, exclusive fresh-target restore, immutable migration hash/order checks, documented backup-before-upgrade policy | Operators must actually stop other writers and retain matching keys. A valid snapshot can be stale; rollback does not undo SaaS changes. There are no down migrations or automatic key recovery. |
| Build artifact substitution | Exact SDK version and registry integrity in the dependency lockfile, clean installs in CI and Docker, restricted release permissions, and publication of the tested image | Maintainers must review lockfile changes, trust the package registry/publisher, and protect CI and release configuration. Actual image publication remains an explicit external action. |

## Audit guarantees

Audit scope includes setup, authentication attempts/challenges, passkey/session management, product registry mutations and tests, searches, and remote mutations. Failed authorization, origin, validation, and rate-limit checks also produce safe events. Routine page/data reads, health probes, session refresh internals, and SQLite housekeeping are outside this event stream.

Every audited request has a Control-generated UUID and a requested event followed by at most one terminal event. The SDK transport request ID and browser mutation attempt ID are separate correlations. Arbitrary target IDs are HMAC references, so a remote identifier containing a token cannot insert plaintext into the audit trail. Only HTTP status, selected booleans, credential mode, and a valid SDK request UUID are allowed as metadata. No search query or mutation parameter/output is retained.

Requested remote audit events and duplicate-protection receipts are committed together before dispatch. Terminal receipts and audit outcomes are also committed together. A local authentication/registry change and its terminal audit append can be separated by a crash; the existing intent is marked unknown on restart. If intent cannot be written, privileged work does not start. If completion cannot be written after work starts, the response is unavailable/unknown and the intent remains for restart recovery. Audit storage failure may also prevent persisting a rejected request; the safe stdout error then provides the request ID.

The chain authenticates a canonical field sequence, including timestamp, outcome, safe metadata, prior hash, and sequence number. Chain signing and target references use different domain labels under the stable encryption key. Application audit APIs are read-only. Full integrity checks are explicit or at startup, not on every read; a middle-row change during a running process is detected at the next full check. Verification reports the checked count and head for an operator to retain separately. There is no external anchoring service or automatic checkpoint comparison.

Phase 3 operation receipts are imported once into the new chain with original timestamps and an `imported` marker. This authenticates the imported snapshot from that point forward; it cannot prove pre-import integrity or recover historical login/registry activity. Unfinished legacy operations and interrupted new requests become unknown and are never resumed.

## Deployment assumptions and checks

Run one Control process per SQLite database. Maintain stable secrets, a private data directory, a trusted HTTPS origin, and protected backups. Production must not enable local HTTP endpoints. Do not expose database inspection tooling publicly. The [installation](INSTALLATION.md), [deployment](DEPLOYMENT.md), and [backup/upgrade](BACKUP-UPGRADE.md) guides define the container and operator boundary. Readiness reports local database availability, not SaaS reachability or a continuous full audit verification.

The TLS proxy/tunnel is trusted to protect browser transport and restrict direct origin access. Tailscale or Cloudflare identity headers are not owner authentication. Cloudflare Access requires token validation at the tunnel/proxy and does not replace Control's login, CSRF checks, or recent authentication. Inbound private access does not relax outbound SaaS destination policy.

The test suites cover unauthorized/stale sessions, CSRF, setup/login limits, unsafe and rebinding destinations, malformed or credential-bearing remote data, SDK signatures, duplicate attempts, lost responses, interruption recovery, audit redaction and filtering, append-only enforcement, storage failure, migration import, and chain tampering. Browser tests use two real SDK-enabled fixtures and verify redacted audit details, integrity checks, tablet layout, and persistence after restart.
