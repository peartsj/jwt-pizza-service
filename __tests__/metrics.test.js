function findMetric(payload, name) {
  const metrics = payload.resourceMetrics[0].scopeMetrics[0].metrics;
  return metrics.find((metric) => metric.name === name);
}

function readMetricValue(metric) {
  const dataPoint = metric.gauge?.dataPoints?.[0] ?? metric.sum?.dataPoints?.[0];
  return dataPoint.asInt ?? dataPoint.asDouble;
}

describe('metrics auth reporting', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    jest.resetModules();

    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => '',
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.fetch;
  });

  test('reports auth per-minute as rolling 60s count and keeps cumulative totals', async () => {
    jest.doMock('../src/config.js', () => ({
      jwtSecret: 'test-secret',
      db: { connection: {} },
      factory: { url: 'http://factory.test', apiKey: 'factory-key' },
      metrics: {
        source: 'jwt-pizza-service-test',
        reportPeriodMs: 10000,
        endpointUrl: 'http://grafana.test/otlp/v1/metrics',
        accountId: 'acct',
        apiKey: 'key',
      },
    }));

    const metrics = require('../src/metrics.js');

    metrics.authenticationAttempt(true, 'login');
    jest.setSystemTime(new Date('2026-01-01T00:00:10.000Z'));
    metrics.authenticationAttempt(false, 'login');
    jest.setSystemTime(new Date('2026-01-01T00:00:20.000Z'));
    metrics.authenticationAttempt(true, 'login');

    await metrics.reportMetrics();

    let payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(readMetricValue(findMetric(payload, 'auth_success_per_minute'))).toBe(2);
    expect(readMetricValue(findMetric(payload, 'auth_failure_per_minute'))).toBe(1);
    expect(readMetricValue(findMetric(payload, 'auth_success_total'))).toBe(2);
    expect(readMetricValue(findMetric(payload, 'auth_failure_total'))).toBe(1);

    jest.setSystemTime(new Date('2026-01-01T00:01:01.000Z'));
    await metrics.reportMetrics();

    payload = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(readMetricValue(findMetric(payload, 'auth_success_per_minute'))).toBe(1);
    expect(readMetricValue(findMetric(payload, 'auth_failure_per_minute'))).toBe(1);
    expect(readMetricValue(findMetric(payload, 'auth_success_total'))).toBe(2);
    expect(readMetricValue(findMetric(payload, 'auth_failure_total'))).toBe(1);

    jest.setSystemTime(new Date('2026-01-01T00:01:21.000Z'));
    await metrics.reportMetrics();

    payload = JSON.parse(global.fetch.mock.calls[2][1].body);
    expect(readMetricValue(findMetric(payload, 'auth_success_per_minute'))).toBe(0);
    expect(readMetricValue(findMetric(payload, 'auth_failure_per_minute'))).toBe(0);
    expect(readMetricValue(findMetric(payload, 'auth_success_total'))).toBe(2);
    expect(readMetricValue(findMetric(payload, 'auth_failure_total'))).toBe(1);

    metrics.stop();
  });
});
