async function checkSubsystem(fn) {
  try {
    await fn();
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

// CP-007: `checkLlm` (optional, zero-arg, never rejects) reports the local LLM as a separate
// top-level `llm` key. It deliberately does not feed `status` — manual entry and the rest of the
// app work without Ollama, and CI runs with no Ollama at all.
async function checkHealth({ pingPostgres, pingRedis, runNoopJob, checkLlm }) {
  const [postgres, redis, queue, llm] = await Promise.all([
    checkSubsystem(pingPostgres),
    checkSubsystem(pingRedis),
    checkSubsystem(runNoopJob),
    checkLlm ? checkLlm() : Promise.resolve(undefined),
  ]);

  const subsystems = { postgres, redis, queue };
  const healthy = Object.values(subsystems).every((s) => s.status === 'ok');

  const result = {
    status: healthy ? 'ok' : 'degraded',
    subsystems,
  };
  if (llm) {
    result.llm = llm;
  }
  return result;
}

module.exports = { checkHealth };
