const { EventEmitter } = require('events');

function findMetric(payload, name) {
  const metrics = payload.resourceMetrics[0].scopeMetrics[0].metrics;
  return metrics.find((metric) => metric.name === name);
}

function findMetricByAttribute(payload, name, attributeKey, attributeValue) {
  const metrics = payload.resourceMetrics[0].scopeMetrics[0].metrics;

  return metrics.find((metric) => {
    if (metric.name !== name) {
      return false;
    }

    const dataPoint = metric.gauge?.dataPoints?.[0] ?? metric.sum?.dataPoints?.[0];
    const matchingAttribute = dataPoint?.attributes?.find((attribute) => attribute.key === attributeKey);

    return matchingAttribute?.value?.stringValue === attributeValue;
  });
}

function readMetricValue(metric) {
  const dataPoint = metric.gauge?.dataPoints?.[0] ?? metric.sum?.dataPoints?.[0];
  return dataPoint.asInt ?? dataPoint.asDouble;
}

function readMetricPoint(metric) {
  return metric.gauge?.dataPoints?.[0] ?? metric.sum?.dataPoints?.[0];
}

describe('metrics reporting', () => {
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

  test('reports http requests per minute as rolling 60s counts for all tracked methods', async () => {
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
    const trackRequest = (method) => {
      const req = { method };
      const res = new EventEmitter();
      metrics.requestTracker(req, res, () => {});
      res.emit('finish');
    };

    trackRequest('GET');
    jest.setSystemTime(new Date('2026-01-01T00:00:10.000Z'));
    trackRequest('PUT');
    jest.setSystemTime(new Date('2026-01-01T00:00:20.000Z'));
    trackRequest('GET');

    await metrics.reportMetrics();

    let payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(readMetricValue(findMetricByAttribute(payload, 'http_requests_per_minute', 'method', 'ALL'))).toBe(3);
    expect(readMetricValue(findMetricByAttribute(payload, 'http_requests_per_minute', 'method', 'GET'))).toBe(2);
    expect(readMetricValue(findMetricByAttribute(payload, 'http_requests_per_minute', 'method', 'PUT'))).toBe(1);
    expect(readMetricValue(findMetricByAttribute(payload, 'http_requests_per_minute', 'method', 'POST'))).toBe(0);
    expect(readMetricValue(findMetricByAttribute(payload, 'http_requests_per_minute', 'method', 'DELETE'))).toBe(0);

    jest.setSystemTime(new Date('2026-01-01T00:01:01.000Z'));
    await metrics.reportMetrics();

    payload = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(readMetricValue(findMetricByAttribute(payload, 'http_requests_per_minute', 'method', 'ALL'))).toBe(2);
    expect(readMetricValue(findMetricByAttribute(payload, 'http_requests_per_minute', 'method', 'GET'))).toBe(1);
    expect(readMetricValue(findMetricByAttribute(payload, 'http_requests_per_minute', 'method', 'PUT'))).toBe(1);

    metrics.stop();
  });

  test('reports pizza creation latency as rolling 60s average', async () => {
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

    metrics.pizzaPurchase(true, 40, 1, 1);
    jest.setSystemTime(new Date('2026-01-01T00:00:10.000Z'));
    metrics.pizzaPurchase(true, 20, 1, 1);
    jest.setSystemTime(new Date('2026-01-01T00:00:20.000Z'));
    metrics.pizzaPurchase(false, 500, 0, 0);

    await metrics.reportMetrics();
    let payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(readMetricValue(findMetric(payload, 'pizza_creation_latency_ms_avg'))).toBeCloseTo(30, 5);
    expect(readMetricValue(findMetric(payload, 'pizza_creation_failures_total'))).toBe(1);
    expect(readMetricValue(findMetric(payload, 'pizzas_sold_total'))).toBe(2);

    const soldPoint = readMetricPoint(findMetric(payload, 'pizzas_sold_total'));
    const failuresPoint = readMetricPoint(findMetric(payload, 'pizza_creation_failures_total'));
    expect(soldPoint.asInt).toBeDefined();
    expect(failuresPoint.asInt).toBeDefined();

    jest.setSystemTime(new Date('2026-01-01T00:00:50.000Z'));
    await metrics.reportMetrics();
    payload = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(readMetricValue(findMetric(payload, 'pizza_creation_latency_ms_avg'))).toBeCloseTo(30, 5);

    jest.setSystemTime(new Date('2026-01-01T00:01:01.000Z'));
    await metrics.reportMetrics();
    payload = JSON.parse(global.fetch.mock.calls[2][1].body);
    expect(readMetricValue(findMetric(payload, 'pizza_creation_latency_ms_avg'))).toBeCloseTo(20, 5);
    expect(readMetricValue(findMetric(payload, 'pizza_creation_failures_total'))).toBe(1);
    expect(readMetricValue(findMetric(payload, 'pizzas_sold_total'))).toBe(1);

    jest.setSystemTime(new Date('2026-01-01T00:01:11.000Z'));
    await metrics.reportMetrics();
    payload = JSON.parse(global.fetch.mock.calls[3][1].body);
    expect(readMetricValue(findMetric(payload, 'pizza_creation_latency_ms_avg'))).toBe(0);
    expect(readMetricValue(findMetric(payload, 'pizza_creation_failures_total'))).toBe(1);
    expect(readMetricValue(findMetric(payload, 'pizzas_sold_total'))).toBe(0);

    metrics.stop();
  });
});
