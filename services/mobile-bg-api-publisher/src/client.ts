// A thin client for the official Mobile.bg import API.
//
// Contract: https://api.mobile.bg/import_doc/
//
// Two things about this API shape the whole design:
//
//   * The session token is short-lived. `POST /import_api/login` returns a
//     32-character token that the documentation says is valid for three minutes.
//     It is therefore never stored or reused across a run: a run logs in, keeps
//     the token in memory for its own lifetime, and logs out. Nothing about it
//     ever reaches a column, a log line or the screen.
//
//   * Pictures are not uploaded. `advertpicts` is given file *paths* and
//     Mobile.bg downloads them from the host registered against the account. An
//     absolute external URL such as the source listing's own picture can never
//     work; only a path that resolves under that one host can.
//
// Every call is funnelled through `call` so that the trace recorded per step is
// produced in one place and cannot drift from what was actually sent.

export type ApiStepName =
  | 'LOGIN'
  | 'FIELDS'
  | 'PUBLISH'
  | 'PICTURES'
  | 'VERIFY'
  | 'LOGOUT';

export type TraceEntry = {
  step: ApiStepName;
  // What was attempted, in words a broker can read. The technical detail
  // (method, path, status, body) follows it.
  label: string;
  method: string;
  // The path with the token replaced by "<token>", so a trace can be stored and
  // shown without leaking a live credential.
  path: string;
  http_status: number | null;
  // Mobile.bg's own status field, which is separate from the HTTP status: a
  // failure is reported as `{"status":"error","msg":"..."}` with HTTP 200.
  api_status: string | null;
  api_msg: string | null;
  // A short, redacted excerpt of the response. Never a request body: those
  // carry the password and the token.
  response_excerpt: string | null;
  ok: boolean;
  at: string;
};

export type ApiCallResult<T> = {
  ok: boolean;
  httpStatus: number | null;
  apiStatus: string | null;
  apiMsg: string | null;
  payload: T | null;
  // Present only when the call did not succeed. Written for a broker, not for a
  // developer, because it is what the screen shows.
  error: string | null;
};

const MAX_EXCERPT = 600;

// Keys whose values must never survive into a trace, a log or the screen. The
// response bodies of this API do not normally contain any of them, but the
// excerpt is taken from arbitrary JSON and a future field must not leak by
// accident.
const SECRET_KEYS = /^(?:token|password|pass|pwd|username|user|secret|apikey|api_key)$/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '…';
  if (Array.isArray(value)) return value.slice(0, 20).map(item => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEYS.test(key) ? '<скрито>' : redact(item, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 300) return `${value.slice(0, 300)}…`;
  return value;
}

// The trace is stored as JSON and shown on screen, so it is bounded twice: the
// excerpt length and the number of entries. A run cannot produce more than a
// dozen steps, but a retry loop must not grow the column without limit.
export function excerptOf(body: unknown): string | null {
  if (body === null || body === undefined) return null;
  const text = typeof body === 'string' ? body : JSON.stringify(redact(body));
  if (!text) return null;
  return text.length > MAX_EXCERPT ? `${text.slice(0, MAX_EXCERPT)}…` : text;
}

export function trimTrace(trace: TraceEntry[], max = 60): TraceEntry[] {
  return trace.length > max ? trace.slice(trace.length - max) : trace;
}

// A token in a URL is a live credential. The trace keeps the shape of the call
// so the endpoint is recognisable, but never the value that authorises it.
export function redactPath(path: string, token?: string | null): string {
  if (token && path.includes(token)) return path.split(token).join('<token>');
  return path.replace(/(\/import_api\/[a-z]+\/)[A-Za-z0-9]{16,}/i, '$1<token>');
}

export type ApiClientOptions = {
  baseUrl?: string;
  username?: string;
  password?: string;
  timeoutMs?: number;
  // Injected so tests can drive the client without a network.
  fetchImpl?: typeof fetch;
};

export class MobileBgApiError extends Error {
  readonly step: ApiStepName;
  readonly httpStatus: number | null;
  readonly apiMsg: string | null;
  constructor(step: ApiStepName, message: string, httpStatus: number | null, apiMsg: string | null) {
    super(message);
    this.name = 'MobileBgApiError';
    this.step = step;
    this.httpStatus = httpStatus;
    this.apiMsg = apiMsg;
  }
}

export class MobileBgApiClient {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private token: string | null = null;
  readonly trace: TraceEntry[] = [];

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl || process.env.MOBILE_BG_API_BASE_URL || 'https://api.mobile.bg').replace(/\/+$/, '');
    this.username = options.username ?? process.env.MOBILE_BG_API_USERNAME ?? process.env.MOBILE_BG_USERNAME ?? '';
    this.password = options.password ?? process.env.MOBILE_BG_API_PASSWORD ?? process.env.MOBILE_BG_PASSWORD ?? '';
    this.timeoutMs = options.timeoutMs ?? Number(process.env.MOBILE_BG_API_TIMEOUT_MS || 30000);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  // True when both halves of the credential are present. Checked before a run
  // starts so a missing secret is reported as configuration, not as a login
  // failure from Mobile.bg.
  hasCredentials(): boolean {
    return this.username.trim().length > 0 && this.password.length > 0;
  }

  get hasToken(): boolean {
    return this.token !== null;
  }

  private record(entry: TraceEntry): void {
    this.trace.push(entry);
  }

  private async call<T>(
    step: ApiStepName,
    label: string,
    method: 'GET' | 'POST',
    path: string,
    options: { query?: Record<string, string | number | undefined>; form?: Record<string, string> } = {},
  ): Promise<ApiCallResult<T>> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const shownPath = `${url.pathname}${url.search ? url.search : ''}`;
    const at = new Date().toISOString();

    let response: Response | null = null;
    let body: unknown = null;
    let httpStatus: number | null = null;
    try {
      response = await this.fetchImpl(url.toString(), {
        method,
        headers: options.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
        body: options.form ? new URLSearchParams(options.form).toString() : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      httpStatus = response.status;
      const text = await response.text();
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'непозната грешка';
      const friendly = /timeout|timed out|aborted/i.test(message)
        ? `Mobile.bg не отговори в рамките на ${Math.round(this.timeoutMs / 1000)} секунди.`
        : `Връзката с Mobile.bg се провали: ${message}`;
      this.record({
        step, label, method, path: redactPath(shownPath, this.token),
        http_status: null, api_status: null, api_msg: null,
        response_excerpt: null, ok: false, at,
      });
      return { ok: false, httpStatus: null, apiStatus: null, apiMsg: null, payload: null, error: friendly };
    }

    const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const apiStatus = typeof record.status === 'string' ? record.status : null;
    const apiMsg = typeof record.msg === 'string' ? record.msg : null;
    // This API answers HTTP 200 even for a rejection and puts the outcome in
    // `status`, so both must agree before a call counts as successful.
    const ok = response.ok && apiStatus !== 'error';
    const excerpt = excerptOf(body);
    this.record({
      step, label, method, path: redactPath(shownPath, this.token),
      http_status: httpStatus, api_status: apiStatus, api_msg: apiMsg,
      response_excerpt: excerpt, ok, at,
    });

    if (ok) {
      return { ok: true, httpStatus, apiStatus, apiMsg, payload: body as T, error: null };
    }

    let error: string;
    if (httpStatus === 403) {
      // Observed from this environment: Cloudflare answers a datacentre IP with
      // 403 before the API is ever reached. It is a network-level block, not a
      // rejected request, so it must not read as "wrong password".
      error = 'Достъпът до api.mobile.bg е отказан (HTTP 403). Ако заявката идва от сървър, провери дали Cloudflare пуска този IP.';
    } else if (httpStatus !== null && httpStatus >= 500) {
      error = `Mobile.bg върна сървърна грешка (HTTP ${httpStatus}).`;
    } else if (apiMsg) {
      error = apiMsg;
    } else if (apiStatus) {
      error = `Mobile.bg отговори с „${apiStatus}“.`;
    } else if (httpStatus !== null) {
      error = `Mobile.bg върна HTTP ${httpStatus}.`;
    } else {
      error = 'Неизвестна грешка при връзката с Mobile.bg.';
    }
    return { ok: false, httpStatus, apiStatus, apiMsg, payload: null, error };
  }

  // Generates a fresh token. Called once at the start of a run and never reused.
  async login(): Promise<ApiCallResult<{ token: string }>> {
    if (!this.hasCredentials()) {
      this.record({
        step: 'LOGIN', label: 'Вход в Mobile.bg', method: 'POST', path: '/import_api/login',
        http_status: null, api_status: null, api_msg: null, response_excerpt: null, ok: false,
        at: new Date().toISOString(),
      });
      return {
        ok: false, httpStatus: null, apiStatus: null, apiMsg: null, payload: null,
        error: 'Липсват потребител и парола за Mobile.bg. Задай MOBILE_BG_API_USERNAME и MOBILE_BG_API_PASSWORD на сървъра.',
      };
    }
    const result = await this.call<{ token?: string }>('LOGIN', 'Вход в Mobile.bg (генериране на token)', 'POST', '/import_api/login', {
      form: { username: this.username, password: this.password },
    });
    if (!result.ok || !result.payload?.token) {
      return { ...result, ok: false, payload: null, error: result.error || 'Mobile.bg не върна token.' };
    }
    this.token = result.payload.token;
    return { ...result, payload: { token: result.payload.token } };
  }

  // Ends the session so the token cannot be reused if it leaks. Best effort: a
  // failure here must not fail an otherwise successful publish.
  async logout(): Promise<void> {
    if (!this.token) return;
    const token = this.token;
    await this.call('LOGOUT', 'Затваряне на сесията', 'POST', `/import_api/logout/${token}/`);
    this.token = null;
  }

  // The fields the chosen category expects. Used to check the draft against
  // Mobile.bg itself rather than against our own idea of the form.
  async catfields(topmenu: number, rub = 1, extra: Record<string, string | number | undefined> = {}) {
    return this.call<{ fields?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(
      'FIELDS', `Четене на полетата за категория ${topmenu}/${rub}`, 'GET',
      `/import_api/catfields/${topmenu}/${rub}/`, { query: extra },
    );
  }

  // Allowed values for the list-type fields. A value outside this list is the
  // most likely reason a publish is rejected, so it is what the readiness check
  // compares against when a dictionary is available.
  async dictionary(topmenu: number, rub = 1, fname?: string, extra: Record<string, string | number | undefined> = {}) {
    const path = fname
      ? `/import_api/dictionary/${topmenu}/${rub}/${fname}/`
      : `/import_api/dictionary/${topmenu}/${rub}/`;
    return this.call<Record<string, unknown>>(
      'FIELDS', fname ? `Четене на стойностите за „${fname}“` : `Четене на речника за категория ${topmenu}/${rub}`,
      'GET', path, { query: extra },
    );
  }

  // Creates a new listing, or corrects an existing one when `ida` is present.
  async advertPub(fields: Record<string, string>, ida?: string | null) {
    const form: Record<string, string> = { ...fields };
    if (ida) form.ida = ida;
    const result = await this.call<{ advert?: unknown }>(
      'PUBLISH', ida ? 'Корекция на съществуваща обява' : 'Публикуване на нова обява', 'POST',
      `/import_api/advertpub/${this.token}/`, { form },
    );
    return result;
  }

  // `add` attaches pictures, `upd` replaces one by position, `del` removes one.
  // The pictures live on our host; only the paths below the registered domain
  // are sent, separated by `~`.
  async advertPicts(ida: string, action: 'add' | 'upd' | 'del', options: { picts?: string; pictnom?: number } = {}) {
    const form: Record<string, string> = { ida, action };
    if (options.picts) form.picts = options.picts;
    if (options.pictnom !== undefined) form.pictnom = String(options.pictnom);
    const label = action === 'add' ? 'Добавяне на снимките към обявата'
      : action === 'upd' ? 'Подмяна на снимка в обявата'
      : 'Изтриване на снимка от обявата';
    const result = await this.call<{ picts?: unknown }>(
      'PICTURES', label, 'POST', `/import_api/advertpicts/${this.token}/`, { form },
    );
    return result;
  }

  // Reads a listing back. This is the only honest way to claim a publish
  // succeeded: `advertpub` reporting success does not by itself prove the
  // listing is readable, and this is what the verification step calls.
  async advertLoad(ida: string) {
    return this.call<{ advert?: Record<string, unknown> }>(
      'VERIFY', 'Проверка на обявата в Mobile.bg', 'GET', `/import_api/advertload/${this.token}/`, { query: { ida } },
    );
  }

  // Lists the account's listings with their ids and publication times. Used as a
  // fallback check when a publish returned no advert body to read an id from.
  async adverts() {
    return this.call<{ adverts?: Array<{ ida: string; pubtime: string }> }>(
      'VERIFY', 'Списък на обявите в акаунта', 'GET', `/import_api/adverts/${this.token}/`,
    );
  }
}

// The API nests the listing under `advert` in its success responses, but the
// exact shape is not documented — the examples stop at `"advert": .....`. The id
// is therefore searched for rather than read from a fixed path, and anything
// that looks like a 17-digit listing id is accepted: that is the length the
// documentation states for `ida`.
const ID_PATTERN = /^\d{17}$/;

export function findListingId(payload: unknown): string | null {
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number): string | null => {
    if (depth > 6 || node === null || node === undefined) return null;
    if (typeof node === 'string') return ID_PATTERN.test(node) ? node : null;
    if (typeof node === 'number') return ID_PATTERN.test(String(node)) ? String(node) : null;
    if (typeof node !== 'object' || seen.has(node)) return null;
    seen.add(node);
    const entries = Array.isArray(node)
      ? node.map(item => ['', item] as const)
      : Object.entries(node as Record<string, unknown>);
    // Preferred keys first: `ida` is the documented name, so it wins over any
    // other 17-digit number that happens to sit in the same body.
    const ordered = [...entries].sort(([a], [b]) => {
      const rank = (key: string) => (/^ida$/i.test(key) ? 0 : /id/i.test(key) ? 1 : 2);
      return rank(a) - rank(b);
    });
    for (const [, value] of ordered) {
      const found = walk(value, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(payload, 0);
}
