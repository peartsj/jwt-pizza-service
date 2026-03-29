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
			authSuccesses: 0,
			authFailures: 0,
			pizzaPurchaseAttempts: 0,
			pizzasSold: 0,
			pizzaCreationFailures: 0,
			revenue: 0,
			serviceLatencyMsTotal: 0,
			serviceLatencyCount: 0,
			pizzaCreationLatencyMsTotal: 0,
			pizzaCreationLatencyCount: 0,
		};

		this.window = {
			requestTimestamps: [],
			requestTimestampsByMethod: this.#createMethodEventBuckets(),
			authSuccessTimestamps: [],
			authFailureTimestamps: [],
			pizzaPurchaseAttemptTimestamps: [],
			serviceLatencyMsTotal: 0,
			serviceLatencyCount: 0,
			pizzaCreationEvents: [],
		};

		this.requestWindowMs = 60_000;
		this.authWindowMs = 60_000;
		this.pizzaLatencyWindowMs = 60_000;
		this.pizzaPurchaseAttemptWindowMs = 60_000;

		this.activeUsers = new Set();
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
			const timestampMs = Date.now();
			const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

			this.totals.requests += 1;
			this.totals.requestsByMethod[method] += 1;
			this.totals.serviceLatencyMsTotal += elapsedMs;
			this.totals.serviceLatencyCount += 1;

			this.window.requestTimestamps.push(timestampMs);
			this.window.requestTimestampsByMethod[method].push(timestampMs);
			this.window.serviceLatencyMsTotal += elapsedMs;
			this.window.serviceLatencyCount += 1;
			this.#pruneRequestWindow(timestampMs);

			if (req.user?.id) {
				this.activeUsers.add(req.user.id);
			}
		});

		next();
	}

	authenticationAttempt(success, _action = 'auth') {
		const timestampMs = Date.now();

		if (success) {
			this.totals.authSuccesses += 1;
			this.window.authSuccessTimestamps.push(timestampMs);
		} else {
			this.totals.authFailures += 1;
			this.window.authFailureTimestamps.push(timestampMs);
		}

		this.#pruneAuthWindow(timestampMs);
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
		const timestampMs = Date.now();
		const safeLatency = Number.isFinite(Number(latencyMs)) ? Number(latencyMs) : 0;
		const safePrice = Number.isFinite(Number(price)) ? Number(price) : 0;
		const safeQuantity = Number.isFinite(Number(quantity)) ? Number(quantity) : 0;

		this.totals.pizzaPurchaseAttempts += 1;
		this.window.pizzaPurchaseAttemptTimestamps.push(timestampMs);
		this.#prunePizzaPurchaseAttemptWindow(timestampMs);

		if (success) {
			this.totals.pizzaCreationLatencyMsTotal += safeLatency;
			this.totals.pizzaCreationLatencyCount += 1;
			this.window.pizzaCreationEvents.push({ timestampMs, latencyMs: safeLatency });
			this.#prunePizzaLatencyWindow(timestampMs);

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
		const now = Date.now();
		const requestsPerMinute = this.#countRecentEvents(this.window.requestTimestamps, now, this.requestWindowMs);
		const authSuccessPerMinute = this.#countRecentEvents(this.window.authSuccessTimestamps, now);
		const authFailurePerMinute = this.#countRecentEvents(this.window.authFailureTimestamps, now);
		const pizzaPurchaseAttemptsPerMinute = this.#countRecentEvents(
			this.window.pizzaPurchaseAttemptTimestamps,
			now,
			this.pizzaPurchaseAttemptWindowMs
		);

		const averageServiceLatency =
			this.window.serviceLatencyCount > 0 ? this.window.serviceLatencyMsTotal / this.window.serviceLatencyCount : 0;
		const averagePizzaCreationLatency = this.#getRecentPizzaLatencyAverage(now);

		const builder = new OtelMetricBuilder(this.source);

		// Request metrics (counters + per-minute gauge).
		builder.addSum('http_requests_total', this.totals.requests);
		builder.addGauge('http_requests_per_minute', requestsPerMinute, '1', { method: 'ALL' });
		for (const method of TRACKED_METHODS) {
			const methodRequestsPerMinute = this.#countRecentEvents(
				this.window.requestTimestampsByMethod[method],
				now,
				this.requestWindowMs
			);
			builder.addSum('http_requests_by_method_total', this.totals.requestsByMethod[method], '1', { method });
			builder.addGauge('http_requests_per_minute', methodRequestsPerMinute, '1', { method });
		}

		// Active user + auth metrics.
		builder.addGauge('active_users', this.activeUsers.size);
		builder.addGauge('auth_success_per_minute', authSuccessPerMinute);
		builder.addGauge('auth_failure_per_minute', authFailurePerMinute);
		builder.addSum('auth_success_total', this.totals.authSuccesses);
		builder.addSum('auth_failure_total', this.totals.authFailures);

		// System metrics.
		builder.addGauge('cpu_usage_percent', cpuUsage, '%');
		builder.addGauge('memory_usage_percent', memoryUsage, '%');

		// Purchase metrics.
		builder.addSum('pizzas_sold_total', this.totals.pizzasSold);
		builder.addSum('pizza_creation_failures_total', this.totals.pizzaCreationFailures);
		builder.addSum('pizza_purchase_attempts_total', this.totals.pizzaPurchaseAttempts);
		builder.addGauge('pizza_purchase_attempts_per_minute', pizzaPurchaseAttemptsPerMinute);
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

	#createMethodEventBuckets() {
		return {
			GET: [],
			PUT: [],
			POST: [],
			DELETE: [],
			OTHER: [],
		};
	}

	#getMemoryUsagePercentage() {
		const totalMemory = os.totalmem();
		const freeMemory = os.freemem();
		const usedMemory = totalMemory - freeMemory;
		const memoryUsage = (usedMemory / totalMemory) * 100;
		return memoryUsage.toFixed(2);
	}

	#getCpuUsagePercentage() {
		const cpuUsage = os.loadavg()[0] / os.cpus().length;
		return cpuUsage.toFixed(2) * 100;
	}

	#countRecentEvents(queue, nowMs, windowMs = this.authWindowMs) {
		const cutoff = nowMs - windowMs;
		while (queue.length > 0 && queue[0] <= cutoff) {
			queue.shift();
		}

		return queue.length;
	}

	#pruneRequestWindow(nowMs) {
		this.#countRecentEvents(this.window.requestTimestamps, nowMs, this.requestWindowMs);
		for (const method of Object.keys(this.window.requestTimestampsByMethod)) {
			this.#countRecentEvents(this.window.requestTimestampsByMethod[method], nowMs, this.requestWindowMs);
		}
	}

	#pruneAuthWindow(nowMs) {
		this.#countRecentEvents(this.window.authSuccessTimestamps, nowMs);
		this.#countRecentEvents(this.window.authFailureTimestamps, nowMs);
	}

	#getRecentPizzaLatencyAverage(nowMs) {
		this.#prunePizzaLatencyWindow(nowMs);

		const { pizzaCreationEvents } = this.window;
		if (pizzaCreationEvents.length === 0) {
			return 0;
		}

		const totalLatency = pizzaCreationEvents.reduce((sum, event) => sum + event.latencyMs, 0);
		return totalLatency / pizzaCreationEvents.length;
	}

	#prunePizzaLatencyWindow(nowMs) {
		const cutoff = nowMs - this.pizzaLatencyWindowMs;
		while (this.window.pizzaCreationEvents.length > 0 && this.window.pizzaCreationEvents[0].timestampMs <= cutoff) {
			this.window.pizzaCreationEvents.shift();
		}
	}

	#prunePizzaPurchaseAttemptWindow(nowMs) {
		this.#countRecentEvents(this.window.pizzaPurchaseAttemptTimestamps, nowMs, this.pizzaPurchaseAttemptWindowMs);
	}

	#resetWindowCounters() {
		this.window.serviceLatencyMsTotal = 0;
		this.window.serviceLatencyCount = 0;
	}

	#isTestEnvironment() {
		return process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
	}
}

module.exports = new MetricsService();
