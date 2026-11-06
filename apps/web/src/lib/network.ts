import { API_BASE_URL } from './api';

export function conversationSocketUrl(
  conversationId: string,
  origin: string,
  apiBase = API_BASE_URL,
): URL {
  const url = new URL(`${apiBase}/communications/ws/${conversationId}`, origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url;
}

export function browserStorageUrl(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value;
  const url = new URL(value);
  if (
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    url.port === '9000'
  ) {
    return `/storage${url.pathname}${url.search}${url.hash}`;
  }
  return value;
}
