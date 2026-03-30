const express = require('express');
const request = require('supertest');
const logger = require('../src/logging.js');

describe('logging', () => {
  test('log payloads are sanitized before sending to Grafana', async () => {
    const originalState = {
      disabled: logger.disabled,
      endpointUrl: logger.endpointUrl,
      accountId: logger.accountId,
      apiKey: logger.apiKey,
      fetch: global.fetch,
    };

    logger.disabled = false;
    logger.endpointUrl = 'https://logs.example.test/loki/api/v1/push';
    logger.accountId = 'acct';
    logger.apiKey = 'token';

    global.fetch = jest.fn(async () => ({ ok: true, text: async () => '' }));

    await logger.log('info', 'test_event', {
      password: 'my-secret-password',
      authorization: 'Bearer abc.def.ghi',
      profile: {
        email: 'person@example.com',
      },
      note: 'Bearer abc.def.ghi',
    });

    const fetchBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    const entry = JSON.parse(fetchBody.streams[0].values[0][1]);

    expect(entry.payload.password).not.toBe('my-secret-password');
    expect(entry.payload.authorization).not.toContain('abc.def.ghi');
    expect(entry.payload.profile.email).not.toBe('person@example.com');
    expect(entry.payload.note).not.toContain('abc.def.ghi');

    // Sensitive object-key fields should use the same redaction marker.
    expect(entry.payload.password).toBe(entry.payload.authorization);
    expect(entry.payload.password).toBe(entry.payload.profile.email);

    logger.disabled = originalState.disabled;
    logger.endpointUrl = originalState.endpointUrl;
    logger.accountId = originalState.accountId;
    logger.apiKey = originalState.apiKey;
    global.fetch = originalState.fetch;
  });

  test('request middleware captures method, path, status, auth-header presence, request body, and response body', async () => {
    const app = express();
    app.use(express.json());

    const spy = jest.spyOn(logger, 'logHttpRequest').mockImplementation(() => {});

    app.use(logger.createRequestLoggingMiddleware());
    app.post('/example', (req, res) => {
      res.status(201).json({ token: 'factory-jwt', ok: true });
    });

    await request(app)
      .post('/example')
      .set('Authorization', 'Bearer abc123')
      .send({ password: 'pw', item: 'pizza' })
      .expect(201);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/example',
        statusCode: 201,
        hasAuthorizationHeader: true,
        requestBody: { password: 'pw', item: 'pizza' },
        responseBody: { token: 'factory-jwt', ok: true },
      })
    );

    spy.mockRestore();
  });

  test('database SQL logging sanitizes inline secrets', async () => {
    const spy = jest.spyOn(logger, 'log').mockResolvedValue(undefined);

    logger.logDatabaseQuery("UPDATE user SET email='a@jwt.com', password='pw', token='x' WHERE id=1");

    expect(spy).toHaveBeenCalledTimes(1);

    const [, , payload] = spy.mock.calls[0];
    expect(payload.action).toBe('UPDATE');
    expect(payload.sql).toContain("email='");
    expect(payload.sql).toContain("password='");
    expect(payload.sql).toContain("token='");
    expect(payload.sql).not.toContain('a@jwt.com');
    expect(payload.sql).not.toContain("password='pw'");
    expect(payload.sql).not.toContain("token='x'");

    spy.mockRestore();
  });
});
