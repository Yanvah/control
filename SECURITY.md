# Security policy

Yanvah Control administers connected SaaS products with the credentials granted to it. Treat the application, host, database, configuration, and backups as privileged infrastructure. This unreleased implementation includes container packaging and maintenance tools. No stable release, published image, or long-term support branch is guaranteed by this checkout.

## Reporting a vulnerability

Use the repository's private vulnerability reporting feature when available. Otherwise, ask the maintainer for a private reporting channel without disclosing exploit details in a public issue. Include the affected revision, deployment mode, impact, and a minimal reproduction using disposable credentials. Never include real passwords, setup tokens, product keys, cookies, private database copies, or customer records. Coordinate public disclosure after the maintainer has investigated and prepared a fix.

Before publishing a release, maintainers must enable and verify a private reporting channel and identify the versions they support. Do not invent a contact address or assume a repository URL exists when redistributing a fork.

## Supported security boundaries

- One owner, token-gated first setup, password/passkey authentication, revocable database sessions, and no public registration.
- Owner authorization, exact-origin CSRF protection, request limits, recent authentication, and explicit confirmation for dangerous actions.
- Server-only SDK traffic with encrypted independent product credentials, validated/pinned network destinations, HTTPS in production, bounded responses, and no automatic mutation retries.
- Durable mutation attempt IDs and honest failed/unknown outcomes when a SaaS may already have applied a change.
- Append-only, HMAC-chained audit events, strict metadata allowlists, keyed target references, and safe structured security logs.

The [threat model](docs/THREAT-MODEL.md) describes these boundaries and their limits. Tests exercise the real authentication and SDK implementations; passing tests is not an external security audit.

## Operating the instance

Use a trusted host, HTTPS at the configured origin, and private access or a trusted reverse proxy. Keep the backend bound to loopback, the database directory private, and configuration secrets outside source control. Enable private SaaS destinations only when needed. The local HTTP flags are for development; production still rejects loopback and metadata endpoints.

The [Compose deployment](docs/INSTALLATION.md) runs as UID/GID 10001, publishes only a host loopback port, uses a read-only root filesystem, and stores writable state under `/data`. Keep the proxy/tunnel on the trusted host or a restricted private network. Cloudflare Access token validation belongs in the configured tunnel/proxy; Control always requires its own owner session. See the [deployment guide](docs/DEPLOYMENT.md).

Retain the database together with its matching authentication and encryption keys. The encryption key also authenticates the audit chain, so replacing it invalidates existing history and credentials. There is no key rotation or account-recovery tool in this release. Apply dependency updates after running the validation commands in the README.

Use the [stopped-service backup and fresh-volume restore procedure](docs/BACKUP-UPGRADE.md). Maintenance verifies SQLite and migration history; application startup verifies audit hashes. Preserve the previous image and backup before any upgrade. Do not run older code against a newer schema or bypass a migration-history failure. CI and container builds use the exact SDK package and integrity recorded in the lockfile; protect dependency updates and release credentials.

Audit records and application logs omit credentials and remote payloads, but remain sensitive operational metadata. Restrict access to them, backups, browser traces, and proxy/framework logs. Monitor disk usage: audit history and mutation receipts are retained, including after product removal. Do not delete records to reclaim space; doing so breaks integrity or duplicate-attempt protection.

## Suspected compromise or integrity failure

Stop accepting administrative requests, preserve the database and relevant logs, and investigate from a trusted environment. Do not bypass chain verification, edit hashes, or reset the setup marker to restore access. Compare against a protected backup or previously saved chain head and count. A valid chain alone cannot rule out tail truncation, an older restored database, or a host/key compromise. Rotate affected credentials at their source as part of recovery; never automatically repeat an operation whose outcome is unknown.
