const url = process.env.HEALTH_URL || 'http://127.0.0.1:3000/api/health';
const timeoutMs = Number(process.env.HEALTH_TIMEOUT_MS || 5000);

try {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`invalid JSON: ${text.slice(0, 200) || '<empty body>'}`);
  }

  const healthy =
    response.ok && payload.status === 'ok' && payload.database === 'up';

  console.log(
    `${healthy ? 'ok' : 'unhealthy'} HTTP ${response.status} ${url}`,
  );
  console.log(JSON.stringify(payload));

  if (!healthy) process.exitCode = 1;
} catch (error) {
  console.error(`unhealthy ${url}: ${error.message}`);
  process.exitCode = 1;
}
