# Install Yanvah Control

Control runs as one Node.js service with one SQLite database. Production needs an HTTPS browser origin and persistent storage. Use Docker Engine with the Compose plugin, or Docker Desktop, and Node.js 22.14+ with npm for the configuration/package preparation commands below.

## Current distribution status

The lockfile pins the published `@yanvah/control` 0.2.1 package. A source build therefore needs no sibling checkout. A public GHCR image exists only after a maintainer completes the explicit release workflow; do not treat an unversioned or unknown registry image as an official release.

The application and SDK remain separate repositories. Run every command below from the Control repository.

## Prepare and start

1. Obtain the Control checkout and install its locked dependencies:

   ```bash
   npm ci
   ```

   Docker and hosted CI run the same locked install. Local SDK development may use `npm run sdk:link -- ../yanvah-control-sdk` after building that matching SDK version; run `npm ci` afterward to restore the published package.

2. Choose a final HTTPS hostname and configure [Tailscale Serve, a TLS reverse proxy, or Cloudflare Access](DEPLOYMENT.md). The proxy forwards to the Docker host's `127.0.0.1:3000`.

3. Create production configuration, replacing the example hostname:

   ```bash
   npm run setup:production -- --production --url https://control.example.com
   ```

   The tool writes `.env.production` once with mode `0600`, independent random secrets, and `/data/control.db`. It refuses to overwrite an existing file, create an owner, or accept an HTTP origin. Read the file privately to retrieve the setup token; it is not printed. Save the authentication and encryption keys in a protected secret manager.

4. Build and start:

   ```bash
   docker compose build
   docker compose up -d
   docker compose ps
   docker compose logs --tail=50 control
   ```

   A direct build is also supported: `docker build -t yanvah-control:local .`. The build consumes no instance secrets. The entrypoint runs the compiled application checks before opening the HTTP listener: configuration/ownership validation, committed migrations, and full audit-chain verification. A failure exits startup and must be investigated; do not reset the volume to make startup pass. Explicit maintenance commands bypass application startup so a damaged database can be inspected or restored without opening a listener.

   After an official image release, replace the local tag with its versioned GHCR reference or immutable digest and start without building:

   ```bash
   CONTROL_IMAGE=ghcr.io/OWNER/REPOSITORY:v0.1.0 docker compose pull control
   CONTROL_IMAGE=ghcr.io/OWNER/REPOSITORY:v0.1.0 docker compose up -d --no-build control
   ```

   Substitute the repository that published the image. Prefer the digest reported by the release workflow for long-lived deployments.

5. Visit `https://control.example.com/setup` through your configured proxy. Enter the exact `CONTROL_SETUP_TOKEN` from `.env.production`, your name/email, and a password of 12–128 characters. Setup creates the sole owner and permanently closes. Enroll a passkey in Settings while recently signed in.

6. Remove the entire `CONTROL_SETUP_TOKEN` line from `.env.production` after setup, then recreate the service to load the changed environment:

   ```bash
   docker compose up -d --force-recreate control
   ```

   Leave `CONTROL_AUTH_SECRET`, `CONTROL_ENCRYPTION_KEY`, and the data volume intact. `docker compose restart` alone does not reload an edited environment file.

The service runs as UID/GID `10001:10001`, with a read-only root filesystem, dropped capabilities, and `/data` as its writable persistent volume. The named volume is `control-data` within the Compose project. Do not use `docker compose down -v` for a normal stop or upgrade: `-v` deletes persistent volumes. Do not run multiple replicas against the same database.

## Deploy a released image on Dokploy or another container platform

Use the exact versioned GHCR image or release digest. In Dokploy, select its [Docker Registry source](https://docs.dokploy.com/docs/core/Docker); other container platforms have an equivalent image source. Configure one replica with container port `3000`, a persistent volume mounted at `/data`, and an HTTPS domain routed to that port. The platform may manage the proxy and certificate; `CONTROL_URL` must still equal the final browser origin exactly.

Set these runtime variables with independent values:

```dotenv
NODE_ENV=production
HOSTNAME=0.0.0.0
PORT=3000
DATABASE_PATH=/data/control.db
CONTROL_URL=https://control.example.com
CONTROL_AUTH_SECRET=replace-with-an-independent-secret
CONTROL_ENCRYPTION_KEY=replace-with-base64-of-exactly-32-random-bytes
CONTROL_SETUP_TOKEN=replace-with-an-independent-setup-token
CONTROL_ALLOW_HTTP_ENDPOINTS=false
CONTROL_ALLOW_PRIVATE_ENDPOINTS=false
```

Generate the three secret values independently. `openssl rand -base64 32` produces a suitable value for each field; do not reuse one output. Set `CONTROL_ALLOW_PRIVATE_ENDPOINTS=true` only when Control must call private-network HTTPS SaaS endpoints and the container has a route to them.

Deploy, wait for the built-in health check to pass, then claim `/setup` through the final HTTPS domain. Remove `CONTROL_SETUP_TOKEN` from the platform configuration after setup and redeploy the same image without replacing the other secrets or `/data` volume. Configure backups before relying on the instance. The initial release workflow publishes a Linux AMD64 image; ARM64 operators should build and validate the source on their ARM64 host until a multi-architecture image is released.

## Connect and verify a SaaS

Expose the SDK server handler in the SaaS with an independent key ID/secret and a valid HTTPS endpoint. Follow the [SDK contract](SDK-CONTRACT.md) and the SDK's own server documentation. Configure persistent replay storage in the SaaS for production; the SDK's example in-memory replay store is process-local.

In **Products → Add product**, enter the endpoint and matching credential, then **Test connection**. For a private HTTPS address, explicitly set `CONTROL_ALLOW_PRIVATE_ENDPOINTS=true` and recreate Control first. The container must have DNS/routing to that address. `localhost` points inside the container and is prohibited for production product endpoints.

For a SaaS that registers protocol v2 `users.create`, open its product detail page and choose **Create user** to test product-specific account creation.

Open **Users**, search an existing account, inspect its supported operations, and perform an appropriate confirmed action against test data. Check the resulting **Audit Log** sequence. Add another SDK-enabled product to verify partial failures and independent capabilities. Restart with `docker compose restart control`, then confirm the owner, products, and audit history persist. Finally, perform the [backup and restore rehearsal](BACKUP-UPGRADE.md).

## Configuration

The complete application variable reference is in [README.md](../README.md#configuration). Compose reads instance variables from `.env.production` at runtime; it must not be included in image layers, build arguments, CI artifacts, or source control. The example pins `NODE_ENV=production`, `DATABASE_PATH=/data/control.db`, and `CONTROL_ALLOW_HTTP_ENDPOINTS=false` in its service definition; these take precedence over values in the runtime file. `CONTROL_ALLOW_PRIVATE_ENDPOINTS` remains an explicit operator opt-in.

Compose also accepts these operator variables from the invoking shell or Compose's `.env` file:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CONTROL_IMAGE` | `yanvah-control:local` | Exact local image tag or, after a real publication, a trusted immutable registry tag/digest. |
| `CONTROL_PORT` | `3000` | Host loopback port forwarded to container port 3000; update the host proxy if changed. |
| `CONTROL_ENV_FILE` | `.env.production` | Runtime environment file for this instance; keep it private and retain its stable keys. |

For a nondefault port, use `CONTROL_PORT=3001 docker compose up -d`. Keep using the same value for later Compose commands. These Compose interpolation variables are distinct from the application's `.env.production` file. Secrets belong only in the runtime file or an equivalent protected runtime environment.

## Before distributing an image

The repository includes validation and release workflow definitions, but their presence is not evidence of a published release. CI installs the exact SDK and dependency graph in `package-lock.json`. Review the workflow, lockfile, release authorization, and registry permissions before publishing.

A maintainer must run all application and container checks, authorize the application release, and publish the versioned image before advertising a GHCR reference as available. The image retains the application license at `/app/LICENSE` and collected runtime dependency notices with a package inventory under `/app/licenses/`. Preserve these when redistributing. Nothing in this setup process publishes either repository.
