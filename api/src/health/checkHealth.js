async function checkSubsystem(fn) {
  try {
    await fn();
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

async function checkHealth({ pingPostgres, pingRedis, runNoopJob }) {
  const [postgres, redis, queue] = await Promise.all([
    checkSubsystem(pingPostgres),
    checkSubsystem(pingRedis),
    checkSubsystem(runNoopJob),
  ]);

  const subsystems = { postgres, redis, queue };
  const healthy = Object.values(subsystems).every((s) => s.status === 'ok');

  return {
    status: healthy ? 'ok' : 'degraded',
    subsystems,
  };
}

module.exports = { checkHealth };
