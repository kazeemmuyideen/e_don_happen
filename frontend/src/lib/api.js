const KEY = 'signal:session';
const DEFAULT_TIMEOUT = 15000;
const MAX_GET_RETRIES = 2;
const RETRY_BASE_DELAY = 300;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

class ApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = details.status;
    this.code = details.code;
    this.offline = details.offline === true;
    this.retryable = details.retryable === true;
  }
}

export function session() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || 'null');
  } catch {
    sessionStorage.removeItem(KEY);
    return null;
  }
}
export function saveSession(value) {
  sessionStorage.setItem(KEY, JSON.stringify(value));
}
export function logout() {
  sessionStorage.removeItem(KEY);
}

export function isOfflineError(error) {
  return Boolean(error && (error.offline === true || error.code === 'NETWORK_OFFLINE'));
}

function isFormData(body) {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

function isBodyInit(body) {
  return (
    typeof body === 'string' ||
    isFormData(body) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
    (typeof ArrayBuffer !== 'undefined' &&
      (body instanceof ArrayBuffer || ArrayBuffer.isView(body)))
  );
}

function encodeBody(body) {
  if (body === undefined || body === null) return undefined;
  return isBodyInit(body) ? body : JSON.stringify(body);
}

function buildHeaders(rawHeaders, body, current) {
  const headers = new Headers(rawHeaders || {});
  if (isFormData(body)) {
    headers.delete('Content-Type');
  } else if (typeof body === 'string') {
    if (!headers.has('Content-Type'))
      headers.set('Content-Type', 'text/plain;charset=UTF-8');
  } else if (body !== undefined && body !== null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (current?.accessToken && !headers.has('Authorization'))
    headers.set('Authorization', `Bearer ${current.accessToken}`);
  return headers;
}

function serverMessage(data) {
  const value = data && typeof data === 'object' && !Array.isArray(data)
    ? data.message
    : data;
  if (Array.isArray(value)) return value.join('. ');
  return typeof value === 'string' && value.trim() ? value : '';
}

function statusMessage(status, data, path) {
  const fromServer = serverMessage(data);
  if (fromServer) return fromServer;
  switch (status) {
    case 400:
      return 'That request could not be completed. Check the details and try again.';
    case 401:
      return path === '/auth/refresh'
        ? 'Your session expired. Please sign in again.'
        : 'Please sign in again to continue.';
    case 403:
      return 'You do not have permission to do that.';
    case 404:
      return 'We could not find that information.';
    case 409:
      return 'That change conflicts with the current data. Refresh and try again.';
    case 422:
      return 'Some details need attention. Check your entries and try again.';
    case 429:
      return 'Too many requests. Please wait a moment and try again.';
    default:
      if (status >= 500)
        return 'The server had trouble completing that request. Please try again.';
      return 'Request failed. Please try again.';
  }
}

async function readBody(response) {
  if (response.status === 204) return null;
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function abortReason(signal) {
  if (signal?.reason !== undefined) return signal.reason;
  return new DOMException('The request was aborted.', 'AbortError');
}

function wait(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

let refreshing;

async function fetchOnce(path, options, retry, current) {
  const {
    timeout = DEFAULT_TIMEOUT,
    signal,
    body,
    headers,
    retryDelay,
    ...rest
  } = options;
  const method = String(rest.method || 'GET').toUpperCase();
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(signal?.reason);

  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timeoutMs = Number(timeout);
  const timer =
    !signal?.aborted && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;

  let response;
  try {
    response = await fetch(`/api${path}`, {
      ...rest,
      signal: controller.signal,
      headers: buildHeaders(headers, body, current),
      body: encodeBody(body),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timedOut)
      throw new ApiError(
        'The request timed out. Check your connection and try again.',
        { code: 'TIMEOUT', retryable: true },
      );
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    throw new ApiError(
      offline
        ? 'You are offline. Reconnect and try again.'
        : 'Cannot reach the server. Check that the backend is running.',
      {
        code: offline ? 'NETWORK_OFFLINE' : 'NETWORK_ERROR',
        offline,
        retryable: !offline,
      },
    );
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }

  if (
    response.status === 401 &&
    retry &&
    current?.refreshToken &&
    path !== '/auth/refresh'
  ) {
    refreshing ||= api(
      '/auth/refresh',
      { method: 'POST', body: { refreshToken: current.refreshToken } },
      false,
    )
      .then((refreshed) => {
        if (!refreshed?.accessToken) throw new Error('Missing access token');
        saveSession({ ...current, accessToken: refreshed.accessToken });
      })
      .finally(() => {
        refreshing = undefined;
      });
    try {
      await refreshing;
      return await api(path, options, false);
    } catch (error) {
      if (signal?.aborted) throw error;
      logout();
      throw new ApiError('Your session expired. Please sign in again.', {
        status: 401,
        code: 'AUTH_EXPIRED',
      });
    }
  }

  const data = await readBody(response);
  if (!response.ok) {
    throw new ApiError(statusMessage(response.status, data, path), {
      status: response.status,
      code: `HTTP_${response.status}`,
      retryable: method === 'GET' && RETRYABLE_STATUS.has(response.status),
    });
  }
  return data;
}

export async function api(path, options = {}, retry = true) {
  const method = String(options.method || 'GET').toUpperCase();
  const attempts = method === 'GET' && retry ? MAX_GET_RETRIES + 1 : 1;
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchOnce(path, options, retry && attempt === 0, session());
    } catch (error) {
      lastError = error;
      if (!error?.retryable || !retry || method !== 'GET' || attempt === attempts - 1)
        throw error;
      const delay = Number(options.retryDelay) || RETRY_BASE_DELAY * 2 ** attempt;
      await wait(delay, options.signal);
    }
  }
  throw lastError;
}
