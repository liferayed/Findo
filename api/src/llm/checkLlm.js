// CP-007: is the local LLM usable? One GET /api/tags tells us both whether Ollama is reachable and
// whether each configured model has been pulled. Never throws — the result feeds GET /health,
// which must answer even when Ollama is down.

const DEFAULT_TIMEOUT_MS = 2000;

// Ollama lists an untagged model as `<name>:latest`.
function withDefaultTag(name) {
  return name.includes(':') ? name : `${name}:latest`;
}

async function checkLlm({ baseUrl, models, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch }) {
  const roles = Object.keys(models);
  const unavailable = {
    status: 'unavailable',
    message: `Ollama not reachable at ${baseUrl}`,
    models: Object.fromEntries(roles.map((role) => [role, { name: models[role], status: 'unknown' }])),
  };

  let body;
  try {
    const res = await fetchImpl(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      return unavailable;
    }
    body = await res.json();
  } catch {
    return unavailable;
  }

  const listed = Array.isArray(body && body.models) ? body.models : [];
  const pulled = new Set(listed.map((m) => m && m.name).filter((name) => typeof name === 'string'));
  const modelStatus = Object.fromEntries(
    roles.map((role) => [role, { name: models[role], status: pulled.has(withDefaultTag(models[role])) ? 'ok' : 'missing' }])
  );
  const missing = roles.filter((role) => modelStatus[role].status === 'missing').map((role) => models[role]);

  if (missing.length === 0) {
    return { status: 'ok', models: modelStatus };
  }
  return { status: 'degraded', message: `Model not pulled: ${missing.join(', ')}`, models: modelStatus };
}

module.exports = { checkLlm };
