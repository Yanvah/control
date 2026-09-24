import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

const execute = promisify(execFile);
const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const { values } = parseArgs({
  options: { image: { type: "string", default: "yanvah-control:local" } },
  strict: true,
});
const image = values.image;
if (!image || image.startsWith("-") || /\s/.test(image))
  throw new Error("An explicit local image reference is required.");
const project = `control-test-${randomBytes(6).toString("hex")}`;
const restoredVolume = `${project}-restored`;
const missingKeysContainer = `${project}-missing-keys`;
const secrets = [
  randomBytes(32).toString("base64"),
  randomBytes(32).toString("base64"),
  randomBytes(32).toString("base64"),
  randomBytes(32).toString("base64"),
  randomBytes(32).toString("base64"),
  randomBytes(24).toString("base64url"),
];
const [
  authSecret,
  encryptionKey,
  setupToken,
  productSecretA,
  productSecretB,
  password,
] = secrets;
let directory;
let restored = false;
let fixtureStarted = false;
let composeFiles;
let environment;

const runtimeInspection = String.raw`
  const fs = require('node:fs');
  const path = require('node:path');
  if (process.getuid() !== 10001) throw new Error('Unexpected runtime UID.');
  for (const file of ['.env', '.env.local', '.env.production', '.test-data', '.data', '.artifacts', 'src/test', 'scripts/container-fixture.mjs', 'node_modules/typescript', 'node_modules/vitest', 'node_modules/jsdom', 'node_modules/@playwright/test']) {
    if (fs.existsSync('/app/' + file)) throw new Error('Development or private files in the runtime image.');
  }
  if (fs.existsSync('/usr/local/bin/npm')) throw new Error('Package manager in runtime image.');
  try { fs.writeFileSync('/app/unexpected-write', 'x'); throw new Error('Runtime root is writable.'); }
  catch (error) { if (!['EROFS', 'EACCES'].includes(error.code)) throw error; }
  const manifest = JSON.parse(fs.readFileSync('/app/package.json'));
  if (manifest.devDependencies) throw new Error('Development dependencies in runtime manifest.');
  const privatePath = Buffer.from(process.argv[1]);
  function inspect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) inspect(file);
      else if (entry.isFile()) {
        if (/\.(?:db|sqlite)(?:$|[-.])/.test(entry.name)) throw new Error('Database file baked into runtime image.');
        if (fs.readFileSync(file).includes(privatePath)) throw new Error('Local workspace path baked into runtime image.');
      }
    }
  }
  inspect('/app');
  console.log('runtime boundaries verified');
`;

async function command(args, options = {}) {
  return execute("docker", args, {
    cwd: repository,
    env: environment ?? process.env,
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
    ...options,
  });
}
async function compose(args, extraFiles = []) {
  return command([
    "compose",
    "--project-name",
    project,
    ...composeFiles.flatMap((file) => ["--file", file]),
    ...extraFiles.flatMap((file) => ["--file", file]),
    ...args,
  ]);
}
function safe(text) {
  return secrets.reduce(
    (result, value) => result.replaceAll(value, "[redacted]"),
    String(text),
  );
}
async function until(check, label, timeout = 90_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await check()) return;
    } catch {
      /* Startup and container restarts temporarily refuse connections. */
    }
    await delay(300);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

try {
  await mkdir(path.join(repository, ".test-data"), { recursive: true });
  directory = await mkdtemp(path.join(repository, ".test-data", "container-"));
  await chmod(directory, 0o755);
  const tls = path.join(directory, "tls");
  await mkdir(tls, { mode: 0o755 });
  await execute(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=Control container test",
      "-addext",
      "subjectAltName=DNS:localhost,DNS:fixture,IP:127.0.0.1",
      "-keyout",
      path.join(tls, "key.pem"),
      "-out",
      path.join(tls, "cert.pem"),
    ],
    { timeout: 30_000 },
  );
  await chmod(path.join(tls, "key.pem"), 0o644);
  await chmod(path.join(tls, "cert.pem"), 0o644);
  const config = path.join(directory, "production.env");
  const fixtureConfig = path.join(directory, "fixture.env");
  await writeFile(
    fixtureConfig,
    `FIXTURE_SECRET_A=${productSecretA}\nFIXTURE_SECRET_B=${productSecretB}\n`,
    { mode: 0o600 },
  );
  const writeConfiguration = async (origin) =>
    writeFile(
      config,
      `CONTROL_URL=${origin}\nCONTROL_AUTH_SECRET=${authSecret}\nCONTROL_ENCRYPTION_KEY=${encryptionKey}\nCONTROL_SETUP_TOKEN=${setupToken}\nCONTROL_ALLOW_PRIVATE_ENDPOINTS=true\n`,
      { mode: 0o600 },
    );
  await writeConfiguration("https://localhost:1");
  const override = path.join(directory, "compose-test.json");
  await writeFile(
    override,
    JSON.stringify({
      services: {
        control: {
          environment: { NODE_EXTRA_CA_CERTS: "/fixtures/cert.pem" },
          volumes: [`${tls}:/fixtures:ro`],
        },
        fixture: {
          image,
          entrypoint: ["node", "/app/container-fixture.mjs"],
          command: [],
          user: "10001:10001",
          read_only: true,
          cap_drop: ["ALL"],
          security_opt: ["no-new-privileges:true"],
          init: true,
          env_file: [fixtureConfig],
          ports: ["127.0.0.1:0:3443"],
          volumes: [
            `${path.join(repository, "scripts/container-fixture.mjs")}:/app/container-fixture.mjs:ro`,
            `${tls}:/fixtures:ro`,
          ],
          healthcheck: { disable: true },
          restart: "no",
        },
      },
    }),
    { mode: 0o600 },
  );
  composeFiles = [path.join(repository, "compose.yaml"), override];
  environment = {
    ...process.env,
    CONTROL_IMAGE: image,
    CONTROL_ENV_FILE: config,
    CONTROL_PORT: "0",
  };
  await command(["image", "inspect", image]);
  await compose(["up", "--detach", "--no-build", "fixture"]);
  fixtureStarted = true;
  const { stdout: fixtureAddress } = await compose(["port", "fixture", "3443"]);
  const port = Number(fixtureAddress.trim().split(":").at(-1));
  assert.ok(
    Number.isInteger(port) && port > 0,
    "The fixture must publish an ephemeral TLS port.",
  );
  const origin = `https://localhost:${port}`;
  await writeConfiguration(origin);
  const ca = await readFile(path.join(tls, "cert.pem"));
  const cookies = new Map();
  async function request(
    route,
    { method = "GET", body, authenticated = true, requestOrigin = origin } = {},
  ) {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const headers = {
      Origin: requestOrigin,
      ...(data === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
          }),
      ...(authenticated && cookies.size
        ? {
            Cookie: [...cookies]
              .map(([name, value]) => `${name}=${value}`)
              .join("; "),
          }
        : {}),
    };
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          hostname: "127.0.0.1",
          servername: "localhost",
          port,
          path: route,
          ca,
          method,
          headers,
          timeout: 15_000,
        },
        (res) => {
          const chunks = [];
          let length = 0;
          res.on("data", (chunk) => {
            length += chunk.length;
            if (length > 1_048_576)
              req.destroy(new Error("Container response exceeded its bound."));
            else chunks.push(chunk);
          });
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString();
            let json;
            try {
              json = JSON.parse(text);
            } catch {
              json = null;
            }
            resolve({
              status: res.statusCode,
              headers: res.headers,
              json,
              text,
            });
          });
        },
      );
      req.on("error", reject);
      req.on("timeout", () =>
        req.destroy(new Error("Container request timed out.")),
      );
      req.end(data);
    });
  }
  await until(
    async () => (await request("/fixture/state")).status === 200,
    "TLS fixture",
  );
  await compose(["up", "--detach", "--no-build", "control"]);
  await until(
    async () => (await request("/api/health/ready")).status === 200,
    "production readiness",
  );
  for (const route of ["/api/health/live", "/api/health/ready"]) {
    const response = await request(route);
    assert.deepEqual(response.json, { status: "ok" });
    assert.equal(response.status, 200);
  }
  const owner = {
    name: "Container owner",
    email: "container-owner@example.test",
    password,
  };
  assert.equal(
    (
      await request("/api/setup", {
        method: "POST",
        body: {
          ...owner,
          setupToken: "invalid-setup-token-with-sufficient-length",
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/setup", {
        method: "POST",
        body: { ...owner, setupToken },
      })
    ).status,
    201,
  );
  const login = await request("/api/auth/sign-in/email", {
    method: "POST",
    body: { email: owner.email, password },
  });
  assert.equal(login.status, 200, "Production password sign-in must succeed.");
  const setCookies = login.headers["set-cookie"] ?? [];
  assert.ok(
    setCookies.some(
      (cookie) =>
        /;\s*Secure(?:;|$)/i.test(cookie) &&
        /;\s*HttpOnly(?:;|$)/i.test(cookie),
    ),
    "Authentication cookies must be Secure and HttpOnly.",
  );
  for (const cookie of setCookies) {
    const pair = cookie.split(";")[0];
    const separator = pair.indexOf("=");
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  assert.equal(
    (
      await request("/api/products", {
        method: "POST",
        body: {},
        authenticated: false,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/api/products", {
        method: "POST",
        body: {},
        requestOrigin: "https://attacker.invalid",
      })
    ).status,
    403,
  );
  const products = [];
  for (const [id, secret] of [
    ["a", productSecretA],
    ["b", productSecretB],
  ]) {
    const created = await request("/api/products", {
      method: "POST",
      body: {
        name: `Container ${id.toUpperCase()}`,
        endpoint: `https://fixture:3443/saas/${id}`,
        credentials: { mode: "existing", keyId: `container_${id}`, secret },
      },
    });
    assert.equal(
      created.status,
      201,
      `Product ${id} must register over private HTTPS.`,
    );
    const productId = created.json.product.id;
    products.push(productId);
    const tested = await request(`/api/products/${productId}/test`, {
      method: "POST",
      body: {},
    });
    assert.equal(
      tested.json?.product?.status,
      "online",
      `Product ${id} SDK discovery must succeed.`,
    );
  }
  const search = await request("/api/users/search", {
    method: "POST",
    body: {
      query: "container-user@example.test",
      channelId: randomUUID(),
      sequence: 1,
    },
  });
  assert.equal(search.status, 200);
  assert.equal(search.json.results.length, 2);
  assert.ok(
    search.json.results.every(
      (result) => result.state === "found" && result.users.length === 1,
    ),
  );
  const detail = await request(`/api/products/${products[0]}/users`, {
    method: "POST",
    body: { userId: "user_container" },
  });
  const mutation = {
    attemptId: randomUUID(),
    capabilityVersion: detail.json.capabilityVersion,
    confirmed: true,
    confirmation: "user_container",
    operation: "users.ban",
    input: { userId: "user_container" },
  };
  const changed = await request(`/api/products/${products[0]}/operations`, {
    method: "POST",
    body: mutation,
  });
  assert.equal(
    changed.json?.state,
    "succeeded",
    "The real SDK mutation must succeed.",
  );
  const duplicate = await request(`/api/products/${products[0]}/operations`, {
    method: "POST",
    body: mutation,
  });
  assert.equal(duplicate.json?.state, "succeeded");
  const remoteState = (await request("/fixture/state")).json;
  assert.equal(remoteState["/saas/a"].user.banned, true);
  assert.equal(remoteState["/saas/a"].mutations, 1);
  assert.equal(remoteState["/saas/b"].user.banned, false);
  assert.equal(remoteState["/saas/b"].mutations, 0);
  const audit = await request(
    `/api/audit?action=users.ban&outcome=all&productId=${products[0]}`,
  );
  assert.equal(audit.status, 200);
  assert.deepEqual(
    audit.json.events.map((event) => event.eventType),
    ["succeeded", "requested"],
  );
  assert.ok(
    audit.json.events.every(
      (event) =>
        /^[a-f0-9]{64}$/.test(event.integrityHash) &&
        /^[a-f0-9]{64}$/.test(event.targetId),
    ),
  );
  for (const value of [
    ...secrets,
    owner.email,
    "container-user@example.test",
    "user_container",
  ])
    assert.ok(
      !audit.text.includes(value),
      "Audit records must omit credentials and raw remote data.",
    );
  assert.equal((await request("/api/audit/integrity")).json?.valid, true);
  const structure = await compose([
    "exec",
    "--no-TTY",
    "control",
    "node",
    "-e",
    runtimeInspection,
    path.dirname(repository),
  ]);
  assert.match(structure.stdout, /runtime boundaries verified/);
  await compose(["restart", "control"]);
  await until(
    async () => (await request("/api/health/ready")).status === 200,
    "restarted production instance",
  );
  assert.equal((await request("/api/products")).json?.products?.length, 2);
  const afterRestart = await request(`/api/products/${products[0]}/test`, {
    method: "POST",
    body: {},
  });
  assert.equal(
    afterRestart.json?.product?.status,
    "online",
    "Product secrets must decrypt after restart.",
  );
  assert.equal((await request("/api/audit/integrity")).json?.valid, true);
  const originalLogs = (await compose(["logs", "--no-color", "control"]))
    .stdout;
  console.info(
    "Production setup, secure login, two real SDK products, isolated mutation, duplicate protection, audit, runtime restrictions, and restart persistence passed.",
  );

  await compose(["stop", "control"]);
  await compose([
    "run",
    "--rm",
    "--no-deps",
    "--entrypoint",
    "node",
    "control",
    "scripts/database-maintenance.mjs",
    "backup",
    "--offline",
    "--output",
    "/data/backups/test.db",
  ]);
  await compose([
    "run",
    "--rm",
    "--no-deps",
    "--entrypoint",
    "node",
    "control",
    "scripts/database-maintenance.mjs",
    "verify",
    "--input",
    "/data/backups/test.db",
  ]);
  // Exercise the documented rollout path against the retained volume. An older
  // released image does not exist yet; migration-prefix upgrades have unit coverage.
  await compose([
    "up",
    "--detach",
    "--no-build",
    "--force-recreate",
    "control",
  ]);
  await until(
    async () => (await request("/api/health/ready")).status === 200,
    "recreated production instance",
  );
  assert.equal((await request("/api/products")).json?.products?.length, 2);
  assert.equal((await request("/api/audit/integrity")).json?.valid, true);
  assert.equal(
    (
      await request(`/api/products/${products[0]}/test`, {
        method: "POST",
        body: {},
      })
    ).json?.product?.status,
    "online",
    "A replacement container must retain owner sessions and decrypt product credentials.",
  );
  const rolloutLogs = (await compose(["logs", "--no-color", "control"])).stdout;
  await compose(["stop", "control"]);
  const { stdout: containerId } = await compose([
    "ps",
    "--all",
    "--quiet",
    "control",
  ]);
  const { stdout: mounts } = await command([
    "inspect",
    containerId.trim(),
    "--format",
    "{{json .Mounts}}",
  ]);
  const dataVolume = JSON.parse(mounts).find(
    (mount) => mount.Destination === "/data",
  )?.Name;
  assert.ok(
    dataVolume?.startsWith(project),
    "Backup source must be owned by the isolated test project.",
  );
  await command(["volume", "create", restoredVolume]);
  restored = true;
  await command([
    "run",
    "--rm",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--entrypoint",
    "node",
    "--mount",
    `type=volume,src=${restoredVolume},dst=/data`,
    "--mount",
    `type=volume,src=${dataVolume},dst=/data/backup-source,readonly`,
    image,
    "scripts/database-maintenance.mjs",
    "restore",
    "--offline",
    "--input",
    "/data/backup-source/backups/test.db",
  ]);
  const restoreOverride = path.join(directory, "compose-restore.json");
  await writeFile(
    restoreOverride,
    JSON.stringify({
      services: { control: { volumes: ["restored-data:/data"] } },
      volumes: { "restored-data": { external: true, name: restoredVolume } },
    }),
    { mode: 0o600 },
  );
  await compose(
    ["up", "--detach", "--no-build", "--force-recreate", "control"],
    [restoreOverride],
  );
  await until(
    async () => (await request("/api/health/ready")).status === 200,
    "restored production instance",
  );
  assert.equal((await request("/api/products")).json?.products?.length, 2);
  assert.equal((await request("/api/audit/integrity")).json?.valid, true);
  assert.equal(
    (
      await request(`/api/products/${products[0]}/test`, {
        method: "POST",
        body: {},
      })
    ).json?.product?.status,
    "online",
  );
  const logs =
    originalLogs +
    rolloutLogs +
    (await compose(["logs", "--no-color", "control"])).stdout;
  for (const secret of secrets)
    assert.ok(
      !logs.includes(secret),
      "Application logs must omit credentials.",
    );
  const failed = await command(
    [
      "run",
      "--name",
      missingKeysContainer,
      "--rm",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      image,
    ],
    { timeout: 30_000 },
  ).then(
    () => null,
    (error) => error,
  );
  assert.ok(
    failed && typeof failed.code === "number" && failed.code !== 0,
    "Missing production keys must stop startup.",
  );
  assert.ok(!failed.killed, "Missing-key validation must fail promptly.");
  console.info(
    "Offline backup, verification, same-version container rollout, restore into a fresh volume, retained-key decryption, audit verification, and fail-closed startup passed.",
  );
} catch (error) {
  console.error(
    safe(
      error instanceof Error ? error.message : "Container validation failed.",
    ),
  );
  if (fixtureStarted) {
    const logs = await compose(["logs", "--no-color", "--tail", "40"]).catch(
      () => null,
    );
    if (logs) console.error(safe(logs.stdout + logs.stderr));
  }
  process.exitCode = 1;
} finally {
  const missingKeysPresent = await command([
    "ps",
    "--all",
    "--quiet",
    "--filter",
    `name=^${missingKeysContainer}$`,
  ]).catch(() => null);
  if (missingKeysPresent?.stdout.trim())
    await command(["rm", "--force", missingKeysContainer]).catch((error) => {
      console.error(safe(error.message));
      process.exitCode = 1;
    });
  if (composeFiles && environment) {
    await compose([
      "down",
      "--volumes",
      "--remove-orphans",
      "--timeout",
      "15",
    ]).catch((error) => {
      console.error(safe(error.message));
      process.exitCode = 1;
    });
  }
  if (restored)
    await command(["volume", "rm", restoredVolume]).catch((error) => {
      console.error(safe(error.message));
      process.exitCode = 1;
    });
  if (directory) await rm(directory, { recursive: true, force: true });
}
