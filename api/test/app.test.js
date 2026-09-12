const request = require('supertest');
const { createApp } = require('../src/app');

function appWithHealth(healthResult) {
  return createApp({ checkHealth: async () => healthResult });
}

describe('GET /health', () => {
  test('returns 200 with the health payload when all subsystems are ok', async () => {
    const res = await request(
      appWithHealth({
        status: 'ok',
        subsystems: {
          postgres: { status: 'ok' },
          redis: { status: 'ok' },
          queue: { status: 'ok' },
        },
      })
    ).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.subsystems.postgres).toEqual({ status: 'ok' });
  });

  test('returns 503 with per-subsystem detail when a subsystem is degraded', async () => {
    const res = await request(
      appWithHealth({
        status: 'degraded',
        subsystems: {
          postgres: { status: 'error', message: 'connection refused' },
          redis: { status: 'ok' },
          queue: { status: 'ok' },
        },
      })
    ).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.subsystems.postgres).toEqual({ status: 'error', message: 'connection refused' });
    expect(res.body.subsystems.redis).toEqual({ status: 'ok' });
  });
});

describe('POST /chat/messages', () => {
  test('echoes the message back with a reply', async () => {
    const res = await request(appWithHealth({ status: 'ok', subsystems: {} }))
      .post('/chat/messages')
      .send({ text: 'Spent $12 at Starbucks' });

    expect(res.status).toBe(201);
    expect(res.body.received).toBe('Spent $12 at Starbucks');
    expect(res.body.reply).toEqual(expect.stringContaining('Spent $12 at Starbucks'));
  });

  test('rejects blank text with 400 instead of creating anything', async () => {
    const res = await request(appWithHealth({ status: 'ok', subsystems: {} }))
      .post('/chat/messages')
      .send({ text: '   ' });

    expect(res.status).toBe(400);
  });
});
