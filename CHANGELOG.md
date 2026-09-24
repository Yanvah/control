# Changelog

Changes are recorded here before they are included in an explicitly published release. No release or image publication is implied by the current application version.

## Unreleased — 0.1.0 development

### Added

- Token-gated first-owner setup, password/passkey authentication, database sessions, and recent-authentication checks.
- Encrypted product credentials, real SDK capability discovery, bounded server-side transport, and SSRF protections.
- Cross-product search, user/subscription inspection, confirmed standard/custom operations, partial failures, and durable duplicate/unknown-outcome receipts.
- Product-specific user creation through protocol v2, with definite duplicate conflicts and unknown-outcome safeguards.
- A reusable top-right toast system with stacked, animated, auto-dismissing Settings feedback.
- Append-only audit events with correlation, credential redaction, integrity verification, filters, and safe structured logging.
- Production container/Compose packaging, explicit production configuration, database maintenance tooling, and CI/release workflows.
- Container startup validation before binding HTTP, including migration-history and audit-integrity checks; isolated browser-test build output.
- Installation, private/TLS deployment, backup/restore/upgrade, troubleshooting, security, and contribution documentation.

### Fixed

- Return to user creation after a recent sign-in, while keeping login destinations restricted to known local routes.
- Reject malformed UTF-8 and incorrect body lengths, bound stalled browser uploads, and release request readers on failures.
- Apply the same credential-leak checks to saved discovery metadata and live SDK results.
- Report uncertain security-setting changes honestly when the server fails after processing them.
- Limit standalone SDK tracing to runtime files so linked workspace builds do not follow recursive development dependencies.

### Development

- Standardized source formatting with pinned Prettier tooling and lint enforcement; clarified security and lifecycle comments.
- Pinned the published SDK for reproducible source, CI, and container builds while retaining optional local SDK linking.

### Compatibility

- Requires Node.js 22.14 or newer, SQLite, and `@yanvah/control` 0.2.1. Existing protocol v1 products remain connectable; creation requires a v2 handler.
- One owner and one application process per database. There is no account-recovery service, database downgrade, encryption-key rotation, or multi-instance deployment.
- Existing Phase 3 receipts import into the audit chain on first Phase 4-or-newer startup; incomplete requests become unknown and are never replayed.
- Normal installs and containers use the published SDK in the lockfile. Local integration work can temporarily link a matching sibling build; `npm ci` restores the release dependency.

See the [migration policy and upgrade procedure](docs/BACKUP-UPGRADE.md) before changing application versions.
