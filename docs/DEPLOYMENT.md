# HTTPS and private deployment

Complete [installation](INSTALLATION.md) with one Control process and a persistent `/data` volume. Choose the browser hostname before creating the owner or enrolling a passkey. `CONTROL_URL` must be that exact HTTPS origin, without a path. Control continues to require its owner login behind every proxy described here.

The Compose service publishes `127.0.0.1:3000` on the host. Run the TLS proxy or tunnel connector on that same host. Do not publish the application port on all interfaces. If the proxy is a separate container, use an explicitly configured private Docker network and the service's container port; its `127.0.0.1` is not the Docker host. Keep that network inaccessible to untrusted containers.

## Tailscale Serve

1. Install Tailscale on the Docker host, sign in, and restrict access to the intended owner/device using your tailnet policy.
2. Enable HTTPS for the tailnet and run:

   ```bash
   tailscale serve --bg http://127.0.0.1:3000
   tailscale serve status
   ```

3. Use the HTTPS hostname shown by Serve as `CONTROL_URL`, for example `https://control-host.example-tailnet.ts.net`. Set it in `.env.production` before setup, then run `docker compose up -d`.
4. Open that URL from an authorized tailnet device and claim the instance. Verify an unauthorized device cannot reach it.

Serve terminates HTTPS and forwards to the host's loopback listener. `--bg` retains the configuration across restarts. Use Serve for private tailnet access; Funnel exposes a service publicly. See the [Serve guide](https://tailscale.com/docs/features/tailscale-serve) and [CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve).

Control does not trust Tailscale identity headers as an owner session. Serving the dashboard through Tailscale also does not grant the container outbound connectivity to another tailnet device. Configure host/container routing and DNS separately if a SaaS endpoint lives there. Set `CONTROL_ALLOW_PRIVATE_ENDPOINTS=true` only for those outbound private HTTPS connections, and recreate the service after editing its environment. TLS hostname verification, metadata blocking, and the ban on production loopback endpoints still apply.

## TLS reverse proxy

For a Caddy service on the Docker host, a complete site block is:

```caddyfile
control.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Replace the hostname with one you control, point DNS at the proxy, and set `CONTROL_URL=https://control.example.com`. Caddy can provision HTTPS for a suitable hostname when certificate issuance requirements are met; follow its [reverse proxy quick-start](https://caddyserver.com/docs/quick-starts/reverse-proxy) and [automatic HTTPS documentation](https://caddyserver.com/docs/automatic-https). Use your existing proxy deployment's validation/reload procedure.

For another proxy, preserve the browser's Host and Origin, forward cookies and request bodies unchanged, and support streamed responses. Do not rewrite the site into a subpath or rewrite Origin to make an invalid request pass. Use TLS between separate hosts. Trust forwarded headers only from your own upstream, restrict direct backend access, and avoid caching authenticated responses. Do not add third-party script injection, HTML rewriting, or a blanket CSP override. Apply ingress limits in addition to Control's durable application limits.

## Cloudflare Access with Tunnel

Set `CONTROL_URL` to the final browser origin, such as `https://control.example.com`.

1. Create a **self-hosted Access application** for the entire hostname before publishing its tunnel route. Allow only the intended owner; require the identity provider's MFA as appropriate. Do not add a bypass policy for `/setup` or `/api`.
2. Create a named Cloudflare Tunnel with `cloudflared` running on the Docker host. Route the hostname to `http://127.0.0.1:3000`; retain the loopback Compose binding and close alternate public paths.
3. Enable **Protect with Access** on the tunnel so `cloudflared` validates Access tokens before forwarding. Control does not implement Cloudflare JWT validation or header-based login.
4. Test both an allowed session and a browser without an Access session. Access must gate the entire hostname, and the allowed browser must still sign in to Control.

Keep tunnel credentials out of this repository and the application image. Follow Cloudflare's [self-hosted application guide](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) for current dashboard steps and token-validation configuration. Avoid unauthenticated temporary tunnels for deployment.

Access is an additional browser access boundary. The SDK client does not attach Cloudflare service-token headers when calling a SaaS; an SDK endpoint behind an interactive Access login will return a safe connection failure rather than bypassing that policy.

## Health and operational checks

`/api/health/live` reports that the HTTP process responds. `/api/health/ready` checks local database access after startup initialization. Responses are limited to `{"status":"ok"}` or `{"status":"unavailable"}` with no instance details. Neither probe contacts a SaaS or proves that all products are available. The container health check uses the private ready endpoint and requires no proxy/Access exemption.

After installing or changing the proxy, verify setup/login, a passkey if enrolled, a confirmed operation, and its audit event through the final HTTPS hostname. Review [backup and upgrade procedures](BACKUP-UPGRADE.md) before relying on the instance.
