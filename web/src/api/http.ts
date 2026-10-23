/**
 * Minimal JSON client for the FireFirst API.
 *
 * The web app authenticates with Django's session cookie. Unsafe requests
 * carry the CSRF token from the `csrftoken` cookie, which Django rotates on
 * login, so it is read fresh for every request.
 */
import type { components } from './schema';

export type Schemas = components['schemas'];

export type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] };

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }

  /** Field-level messages from a DRF validation error, e.g. {unit_number: "This field is required."} */
  get fieldErrors(): Record<string, string> {
    if (!this.body || typeof this.body !== 'object' || Array.isArray(this.body)) return {};
    return Object.fromEntries(
      Object.entries(this.body as Record<string, unknown>).map(([field, value]) => [field, errorMessage(value)]),
    );
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

function csrfToken() {
  return document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1] ?? '';
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRFToken'] = csrfToken();

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  }

  if (response.status === 204) return undefined as T;
  const data = response.headers.get('content-type')?.includes('json') ? await response.json() : undefined;
  if (!response.ok) {
    if (response.status === 401 || (response.status === 403 && isNotAuthenticated(data))) onUnauthorized();
    throw new ApiError(errorMessage(data) || `Request failed (${response.status}).`, response.status, data);
  }
  return data as T;
}

function isNotAuthenticated(data: unknown) {
  const detail = (data as { detail?: string } | undefined)?.detail ?? '';
  return detail.includes('credentials were not provided');
}

export const http = {
  get: <T>(path: string, query?: Query) => request<T>('GET', withQuery(path, query)),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: (path: string) => request<void>('DELETE', path),
};

/** Turn a DRF error body ({detail}, {field: [msg]}, nested lists…) into one readable message. */
export function errorMessage(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (Array.isArray(error)) return error.map(errorMessage).join(' ');
  if (typeof error === 'object') {
    return Object.entries(error as Record<string, unknown>)
      .map(([field, value]) => {
        const text = errorMessage(value);
        return field === 'detail' || field === 'non_field_errors' ? text : `${humanizeField(field)}: ${text}`;
      })
      .join('\n');
  }
  return String(error);
}

function humanizeField(field: string) {
  const words = field.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Fetch every page of a list endpoint (department-sized lists: dozens to a few hundred rows). */
export async function getAll<T>(path: string, query?: Query): Promise<T[]> {
  const first = await http.get<Page<T>>(path, { page_size: 200, ...query });
  const results = [...first.results];
  let next = first.next;
  while (next) {
    const url = new URL(next, window.location.origin);
    const page = await http.get<Page<T>>(url.pathname + url.search);
    results.push(...page.results);
    next = page.next;
  }
  return results;
}
