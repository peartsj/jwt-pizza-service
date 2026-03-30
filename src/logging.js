const config = require('./config.js');

const REDACTED = '*****';
const SENSITIVE_KEY_PATTERN = /(password|pass|secret|token|authorization|api[_-]?key|cookie|session|jwt|credential|private[_-]?key|email)/i;
const PROCESS_HANDLER_FLAG = '__jwtPizzaLoggingProcessHandlersRegistered';

class GrafanaLogger {
  constructor() {
    const loggingConfig = config.logging ?? {};

    this.source = loggingConfig.source ?? 'jwt-pizza-service';
    this.endpointUrl = loggingConfig.endpointUrl;
    this.accountId = loggingConfig.accountId;
    this.apiKey = loggingConfig.apiKey ?? loggingConfig.api_key;
    this.serviceName = 'jwt-pizza-service';
    this.disabled = this.#isTestEnvironment();
  }

  createRequestLoggingMiddleware() {
    return (req, res, next) => {
      const requestBody = req.body;
      let responseBody;

      const originalJson = res.json.bind(res);
      res.json = (body) => {
        responseBody = body;
        return originalJson(body);
      };

      const originalSend = res.send.bind(res);
      res.send = (body) => {
        if (responseBody === undefined) {
          responseBody = this.#normalizeBodyForLogging(body);
        }
        return originalSend(body);
      };

      res.on('finish', () => {
        this.logHttpRequest({
          host: req.headers.host,
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          hasAuthorizationHeader: Boolean(req.headers.authorization),
          requestBody,
          responseBody,
        });
      });

      next();
    };
  }

  registerProcessExceptionHandlers() {
    if (this.disabled || globalThis[PROCESS_HANDLER_FLAG]) {
      return;
    }

    process.on('uncaughtException', (error) => {
      this.logUnhandledException(error, { type: 'uncaughtException' });
    });

    process.on('unhandledRejection', (reason) => {
      this.logUnhandledException(reason, { type: 'unhandledRejection' });
    });

    globalThis[PROCESS_HANDLER_FLAG] = true;
  }

  logHttpRequest(details) {
    void this.log('info', 'http_request', details);
  }

  logDatabaseQuery(sql) {
    void this.log('info', 'database_query', { sql: this.#sanitizeSql(sql) });
  }

  logFactoryRequest(details) {
    void this.log('info', 'factory_request', details);
  }

  logUnhandledException(error, context = {}) {
    const normalizedError = this.#normalizeError(error);
    void this.log('error', 'unhandled_exception', {
      ...context,
      error: normalizedError,
    });
  }

  async log(level, event, payload = {}) {
    if (!this.#isConfiguredForSending() || this.disabled) {
      return;
    }

    const timestampNs = String(Date.now() * 1_000_000);
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      payload: this.sanitize(payload),
    };

    if (typeof fetch !== 'function') {
      console.warn('Global fetch is unavailable. Log entry was not sent to Grafana.');
      return;
    }

    try {
      const response = await fetch(this.endpointUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.accountId}:${this.apiKey}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          streams: [
            {
              stream: {
                source: this.source,
                service: this.serviceName,
                event,
                level,
              },
              values: [[timestampNs, JSON.stringify(entry)]],
            },
          ],
        }),
      });

      if (!response.ok) {
        const message = await response.text();
        console.error(`Failed to push logs to Grafana: ${message}`);
      }
    } catch (error) {
      console.error('Failed to push logs to Grafana', this.#normalizeError(error));
    }
  }

  sanitize(value, seen = new WeakSet()) {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'string') {
      return this.#sanitizeString(value);
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'function') {
      return '[FUNCTION]';
    }

    if (Buffer.isBuffer(value)) {
      return `[BUFFER:${value.length}]`;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (value instanceof Error) {
      return {
        name: this.#sanitizeString(value.name),
        message: this.#sanitizeString(value.message),
        stack: this.#sanitizeString(value.stack ?? ''),
      };
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitize(item, seen));
    }

    if (typeof value === 'object') {
      if (seen.has(value)) {
        return '[CIRCULAR]';
      }
      seen.add(value);

      const sanitized = {};
      for (const [key, nestedValue] of Object.entries(value)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
          sanitized[key] = REDACTED;
        } else {
          sanitized[key] = this.sanitize(nestedValue, seen);
        }
      }
      return sanitized;
    }

    return this.#sanitizeString(String(value));
  }

  #normalizeBodyForLogging(body) {
    if (Buffer.isBuffer(body)) {
      return `[BUFFER:${body.length}]`;
    }

    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
      } catch {
        return body;
      }
    }

    return body;
  }

  #normalizeError(error) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    if (typeof error === 'string') {
      return { name: 'Error', message: error };
    }

    return { name: 'Error', message: JSON.stringify(error) };
  }

  #sanitizeSql(sql) {
    const safeSql = this.#sanitizeString(String(sql));

    return safeSql
      .replace(/(password\s*=\s*)'[^']*'/gi, `$1'${REDACTED}'`)
      .replace(/(email\s*=\s*)'[^']*'/gi, `$1'${REDACTED}'`)
      .replace(/(token\s*=\s*)'[^']*'/gi, `$1'${REDACTED}'`)
      .replace(/(authorization\s*=\s*)'[^']*'/gi, `$1'${REDACTED}'`);
  }

  #sanitizeString(value) {
    let sanitized = String(value);

    sanitized = sanitized
      .replace(/Bearer\s+[A-Za-z0-9\-._~+/=]+/gi, 'Bearer [REDACTED]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');

    if (sanitized.length > 8_000) {
      sanitized = `${sanitized.slice(0, 8_000)}...[TRUNCATED]`;
    }

    return sanitized;
  }

  #isConfiguredForSending() {
    return Boolean(this.endpointUrl && this.accountId && this.apiKey);
  }

  #isTestEnvironment() {
    return process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
  }
}

module.exports = new GrafanaLogger();
