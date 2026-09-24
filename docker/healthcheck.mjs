try {
  const response = await fetch(
    `http://127.0.0.1:${process.env.PORT ?? "3000"}/api/health/ready`,
    { signal: AbortSignal.timeout(3000), redirect: "error" },
  );
  if (
    response.status !== 200 ||
    JSON.stringify(await response.json()) !== '{"status":"ok"}'
  )
    process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
