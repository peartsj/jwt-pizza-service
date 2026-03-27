const os = require('os');
const config = require('./config.js');

const TRACKED_METHODS = ['GET', 'PUT', 'POST', 'DELETE'];

class OtelMetricBuilder {
	constructor(source) {
		this.source = source;
		this.timeUnixNano = Date.now() * 1_000_000;
		this.metrics = [];
	}

	addGauge(name, value, unit = '1', attributes = {}) {
		this.metrics.push({
			name,
			unit,
			gauge: {
				dataPoints: [this.#toDataPoint(value, attributes)],
			},
		});
	}

	addSum(name, value, unit = '1', attributes = {}) {
		this.metrics.push({
			name,
			unit,
			sum: {
				aggregationTemporality: 'AGGREGATION_TEMPORALITY_CUMULATIVE',
				isMonotonic: true,
				dataPoints: [this.#toDataPoint(value, attributes)],
			},
		});
	}

	toPayload() {
		return {
			resourceMetrics: [
				{
					resource: {
						attributes: [
							{
								key: 'service.name',
								value: { stringValue: this.source },
							},
						],
					},
					scopeMetrics: [
						{
							scope: {
								name: 'jwt-pizza-service.metrics',
							},
							metrics: this.metrics,
						},
					],
				},
			],
		};
	}

	#toDataPoint(value, attributes) {
		const numericValue = Number.isFinite(Number(value)) ? Number(value) : 0;
		const point = {
			timeUnixNano: this.timeUnixNano,
			attributes: this.#toAttributes(attributes),
		};

		if (Number.isInteger(numericValue)) {
			point.asInt = numericValue;
		} else {
			point.asDouble = numericValue;
		}

		return point;
	}

	#toAttributes(attributes) {
		return Object.entries(attributes).map(([key, value]) => {
			if (typeof value === 'boolean') {
				return { key, value: { boolValue: value } };
			}

			if (typeof value === 'number') {
				if (Number.isInteger(value)) {
					return { key, value: { intValue: value } };
				}
				return { key, value: { doubleValue: value } };
			}

			return { key, value: { stringValue: String(value) } };
		});
	}
}

class MetricsService {
	constructor() {
		const metricsConfig = config.metrics ?? {};
		this.source = metricsConfig.source ?? 'jwt-pizza-service';
		this.endpointUrl = metricsConfig.endpointUrl;
		this.accountId = metricsConfig.accountId;
		this.apiKey = metricsConfig.apiKey ?? metricsConfig.api_key;
		this.reportPeriodMs = Math.max(5_000, Number(metricsConfig.reportPeriodMs) || 60_000);

		this.totals = {
			requests: 0,
			requestsByMethod: this.#createMethodCounter(),
			pizzasSold: 0,
			pizzaCreationFailures: 0,
			revenue: 0,
			serviceLatencyMsTotal: 0,
			serviceLatencyCount: 0,
			pizzaCreationLatencyMsTotal: 0,
			pizzaCreationLatencyCount: 0,
		};

		this.window = {
			requests: 0,
			requestsByMethod: this.#createMethodCounter(),
			authSuccesses: 0,
			authFailures: 0,
			serviceLatencyMsTotal: 0,
			serviceLatencyCount: 0,
			pizzaCreationLatencyMsTotal: 0,
			pizzaCreationLatencyCount: 0,
		};

		this.activeUsers = new Set();
		this.previousCpuSnapshot = this.#getCpuSnapshot();
		this.reportingTimer = null;

		this.requestTracker = this.requestTracker.bind(this);

		if (!this.#isTestEnvironment()) {
			this.start();
		}
	}

	requestTracker(req, res, next) {
		const startTime = process.hrtime.bigint();
		const method = this.#normalizeMethod(req.method);

		res.on('finish', () => {
			const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

			this.totals.requests += 1;
			this.totals.requestsByMethod[method] += 1;
			this.totals.serviceLatencyMsTotal += elapsedMs;
			this.totals.serviceLatencyCount += 1;

			this.window.requests += 1;
			this.window.requestsByMethod[method] += 1;
			this.window.serviceLatencyMsTotal += elapsedMs;
			this.window.serviceLatencyCount += 1;

			if (req.user?.id) {
				this.activeUsers.add(req.user.id);
			}
		});

		next();
	}

	authenticationAttempt(success, _action = 'auth') {
		if (success) {
			this.window.authSuccesses += 1;
		} else {
			this.window.authFailures += 1;
		}
	}

	userAuthenticated(userId) {
		if (userId !== undefined && userId !== null) {
			this.activeUsers.add(userId);
		}
	}

	userLoggedOut(userId) {
		if (userId !== undefined && userId !== null) {
			this.activeUsers.delete(userId);
		}
	}

	pizzaPurchase(success, latencyMs, price = 0, quantity = 0) {
		const safeLatency = Number.isFinite(Number(latencyMs)) ? Number(latencyMs) : 0;
		const safePrice = Number.isFinite(Number(price)) ? Number(price) : 0;
		const safeQuantity = Number.isFinite(Number(quantity)) ? Number(quantity) : 0;

		this.totals.pizzaCreationLatencyMsTotal += safeLatency;
		this.totals.pizzaCreationLatencyCount += 1;
		this.window.pizzaCreationLatencyMsTotal += safeLatency;
		this.window.pizzaCreationLatencyCount += 1;

		if (success) {
			this.totals.pizzasSold += safeQuantity;
			this.totals.revenue += safePrice;
		} else {
			this.totals.pizzaCreationFailures += 1;
		}
	}

	start() {
		if (this.reportingTimer) {
			return;
		}

		this.reportingTimer = setInterval(async () => {
			try {
				await this.reportMetrics();
			} catch (error) {
				console.error('Error sending metrics', error);
			}
		}, this.reportPeriodMs);

		if (typeof this.reportingTimer.unref === 'function') {
			this.reportingTimer.unref();
		}
	}

	stop() {
		if (this.reportingTimer) {
			clearInterval(this.reportingTimer);
			this.reportingTimer = null;
		}
	}

	async reportMetrics() {
		const cpuUsage = this.#getCpuUsagePercentage();
		const memoryUsage = this.#getMemoryUsagePercentage();
		const requestRateScale = 60_000 / this.reportPeriodMs;

		const averageServiceLatency =
			this.window.serviceLatencyCount > 0 ? this.window.serviceLatencyMsTotal / this.window.serviceLatencyCount : 0;
		const averagePizzaCreationLatency =
			this.window.pizzaCreationLatencyCount > 0 ? this.window.pizzaCreationLatencyMsTotal / this.window.pizzaCreationLatencyCount : 0;

		const builder = new OtelMetricBuilder(this.source);

		// Request metrics (counters + per-minute gauge).
		builder.addSum('http_requests_total', this.totals.requests);
		builder.addGauge('http_requests_per_minute', this.window.requests * requestRateScale, '1', { method: 'ALL' });
		for (const method of TRACKED_METHODS) {
			builder.addSum('http_requests_by_method_total', this.totals.requestsByMethod[method], '1', { method });
			builder.addGauge('http_requests_per_minute', this.window.requestsByMethod[method] * requestRateScale, '1', { method });
		}

		// Active user + auth metrics.
		builder.addGauge('active_users', this.activeUsers.size);
		builder.addGauge('auth_success_per_minute', this.window.authSuccesses * requestRateScale);
		builder.addGauge('auth_failure_per_minute', this.window.authFailures * requestRateScale);

		// System metrics.
		builder.addGauge('cpu_usage_percent', cpuUsage, '%');
		builder.addGauge('memory_usage_percent', memoryUsage, '%');

		// Purchase metrics.
		builder.addSum('pizzas_sold_total', this.totals.pizzasSold);
		builder.addSum('pizza_creation_failures_total', this.totals.pizzaCreationFailures);
		builder.addSum('pizza_revenue_total', this.totals.revenue, 'USD');

		// Latency metrics.
		builder.addSum('service_endpoint_latency_ms_total', this.totals.serviceLatencyMsTotal, 'ms');
		builder.addSum('service_endpoint_latency_count_total', this.totals.serviceLatencyCount);
		builder.addGauge('service_endpoint_latency_ms_avg', averageServiceLatency, 'ms');

		builder.addSum('pizza_creation_latency_ms_total', this.totals.pizzaCreationLatencyMsTotal, 'ms');
		builder.addSum('pizza_creation_latency_count_total', this.totals.pizzaCreationLatencyCount);
		builder.addGauge('pizza_creation_latency_ms_avg', averagePizzaCreationLatency, 'ms');

		await this.#sendToGrafana(builder.toPayload());
		this.#resetWindowCounters();
	}

	async #sendToGrafana(payload) {
		if (!this.#isConfiguredForSending()) {
			return;
		}

		if (typeof fetch !== 'function') {
			console.warn('Global fetch is unavailable. Metrics were not sent.');
			return;
		}

		const body = JSON.stringify(payload);

		for (let attempt = 1; attempt <= 2; attempt++) {
			try {
				const response = await fetch(this.endpointUrl, {
					method: 'POST',
					body,
					headers: {
						Authorization: `Bearer ${this.accountId}:${this.apiKey}`,
						'Content-Type': 'application/json',
					},
				});

				if (response.ok) {
					return;
				}

				const text = await response.text();
				const canRetry = this.#shouldRetryStatus(response.status);
				if (!canRetry || attempt === 2) {
					console.error(`Failed to push metrics data to Grafana: ${text}`);
					return;
				}
			} catch (error) {
				if (attempt === 2) {
					console.error('Failed to push metrics data to Grafana', error);
					return;
				}
			}

			await this.#sleep(250 * attempt);
		}
	}

	#isConfiguredForSending() {
		return Boolean(this.endpointUrl && this.accountId && this.apiKey);
	}

	#shouldRetryStatus(status) {
		return status === 429 || status >= 500;
	}

	#sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	#normalizeMethod(method) {
		const normalized = String(method || 'UNKNOWN').toUpperCase();
		if (TRACKED_METHODS.includes(normalized)) {
			return normalized;
		}
		return 'OTHER';
	}

	#createMethodCounter() {
		return {
			GET: 0,
			PUT: 0,
			POST: 0,
			DELETE: 0,
			OTHER: 0,
		};
	}

	#getMemoryUsagePercentage() {
		const totalMemory = os.totalmem();
		const freeMemory = os.freemem();
		const usedMemory = totalMemory - freeMemory;
		return Number(((usedMemory / totalMemory) * 100).toFixed(2));
	}

	#getCpuUsagePercentage() {
		const current = this.#getCpuSnapshot();
		const previous = this.previousCpuSnapshot;
		this.previousCpuSnapshot = current;

		const idleDiff = current.idle - previous.idle;
		const totalDiff = current.total - previous.total;
		if (totalDiff <= 0) {
			return 0;
		}

		const usage = ((1 - idleDiff / totalDiff) * 100).toFixed(2);
		return Number(usage);
	}

	#getCpuSnapshot() {
		const cpus = os.cpus();
		let idle = 0;
		let total = 0;

		for (const cpu of cpus) {
			idle += cpu.times.idle;
			total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
		}

		return { idle, total };
	}

	#resetWindowCounters() {
		this.window.requests = 0;
		this.window.requestsByMethod = this.#createMethodCounter();
		this.window.authSuccesses = 0;
		this.window.authFailures = 0;
		this.window.serviceLatencyMsTotal = 0;
		this.window.serviceLatencyCount = 0;
		this.window.pizzaCreationLatencyMsTotal = 0;
		this.window.pizzaCreationLatencyCount = 0;
	}

	#isTestEnvironment() {
		return process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
	}
}

module.exports = new MetricsService();
