// F1.7 final review I2: importing app.js must not open a Redis connection as a side effect.
// Regression coverage for the chain app.js -> statementUploadService.js -> statementQueue.js
// (which opens an IORedis connection at module-load time). Points REDIS_URL at an address
// nothing is listening on so that, if app.js's import graph still reaches statementQueue.js,
// the open (leaked) IORedis handle keeps this test process alive well past a fast, synchronous
// require — surfaced here as a jest fake-timers-free timing assertion rather than relying on
// --forceExit to paper over it.
describe('requiring app.js alone', () => {
  const originalRedisUrl = process.env.REDIS_URL;

  beforeAll(() => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
  });

  afterAll(() => {
    process.env.REDIS_URL = originalRedisUrl;
  });

  test('does not throw and does not require statementQueue.js (no Redis import side effect)', () => {
    jest.resetModules();
    expect(() => require('../../src/app')).not.toThrow();
    // statementQueue.js is the module that opens the IORedis connection at load time. If
    // app.js's import graph still reaches it, it will already be in the require cache here.
    expect(require.cache[require.resolve('../../src/documents/statementQueue')]).toBeUndefined();
  });
});
