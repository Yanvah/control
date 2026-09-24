# Contributing

Read [AGENTS.md](AGENTS.md), [PLAN.md](PLAN.md), and the [threat model](docs/THREAT-MODEL.md) before changing behavior. Keep work focused on the requested scope and discuss changes to the SDK contract separately. The SDK is a separate repository and Control must consume its public package interface.

## Development

Use Node.js 22.14 or newer and npm. Follow the [README](README.md#local-development) for local configuration. Never use a production database or credentials for tests. Normal development and CI use the exact published SDK in the lockfile; a matching sibling SDK may be linked temporarily for SDK integration work.

Use strict TypeScript, runtime validation for external input, Server Components by default, and server-only modules for credentials, persistence, cryptography, and SDK calls. Do not add a dependency when existing project or platform APIs suffice. Preserve accessibility, conservative network policy, explicit confirmation, and honest unknown outcomes.

Run `npm run format` to apply the pinned Prettier style to source, tests, and configuration. `npm run lint` checks both ESLint and formatting. Generated files, immutable migrations, prose, and artwork are excluded from formatting. Explain non-obvious security, lifecycle, and compatibility decisions in comments; avoid comments that only repeat the code.

Before opening a change:

```bash
npm run lint
npm run typecheck
npm test
npm run test:release
npm run test:e2e
npm run build
npm run db:generate
npm audit
```

Install the Playwright Chromium browser with `npx playwright install chromium` if needed. Apply migrations to a disposable database and verify rerunning them is safe. A schema change requires a new committed migration and the [migration policy](docs/BACKUP-UPGRADE.md#database-migration-policy). A packaging change also requires `docker build -t yanvah-control:local .` followed by `npm run test:container -- --image yanvah-control:local`, including health/setup/restart and backup/restore checks.

Tests should establish user-visible or security behavior. Integration tests use real Better Auth and signed HTTP SDK fixtures; do not replace signing, protocol parsing, or authorization with mocks. Include failure and interruption cases for mutations. Keep generated databases, environment files, traces, build output, and credentials out of changes.

The browser-test harness sets the internal `CONTROL_TEST_BUILD=1` switch to use `.next/test`. Do not set it for production or normal development. The harness owns its servers and disposable databases; use its lifecycle helpers rather than connecting to an existing owner instance.

## Reviews

Describe the problem, final behavior, important security/compatibility decisions, and commands run. Include screenshots for visual changes using synthetic data only. Update user-facing documentation and the changelog when behavior or operations change. Do not rewrite historical migrations, relax validation to make checks pass, or add unrelated future work.

Do not post security exploits or sensitive logs in a public issue; follow [SECURITY.md](SECURITY.md). Follow the [Code of Conduct](CODE_OF_CONDUCT.md) in reviews and discussions.

## Licensing and releases

Contributions are provided under the repository's [Apache-2.0 license](LICENSE). Preserve upstream license texts and notices when redistributing dependencies. The Yanvah marks identify this project; the software license does not grant trademark rights. Use only assets you have permission to contribute.

Only maintainers should authorize tags, releases, and registry publication. A package version in `package.json` is not a published release. Before publication, review the pinned dependency licenses/advisories, run every validation including container checks, rehearse backup/upgrade/restore, record migration compatibility, and enable a private security reporting channel. Follow the [release procedure](docs/RELEASING.md); the repository currently has no published release guaranteed by these documents.
