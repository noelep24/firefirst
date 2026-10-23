/** Local calendar date as YYYY-MM-DD (what the API's date fields use). */
export function isoDate(date: Date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parse YYYY-MM-DD as a local date (not UTC midnight, which shifts the day west of Greenwich). */
export function parseDate(value: string) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(value: string, days: number) {
  const date = parseDate(value);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

export function formatDay(value: string, options: Intl.DateTimeFormatOptions = {}) {
  return parseDate(value).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...options,
  });
}

export function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatTime(value: string) {
  return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "out_of_service" -> "Out of service" */
export function humanize(value: string) {
  const words = value.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const isValidIsoDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(parseDate(value).getTime());
