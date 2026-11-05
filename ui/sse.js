// Data layer for Zilla's server-sent events. Zilla sends each Kafka message on a topic as one event:
// a row event carries the whole new row as JSON, and a 'delete' event carries the message key, in
// base64, when a row is removed. These become the INSERT, UPDATE and DELETE operations tycostream's
// GraphQL subscriptions send, so the grid code doesn't depend on the transport.
const ZILLA_URL = import.meta.env.VITE_ZILLA_URL ?? 'http://localhost:7114';

export function subscribe(path, idField, onChange) {
  const seen = new Set();
  const source = new EventSource(`${ZILLA_URL}${path}`);

  source.onmessage = (event) => {
    const row = parseNumbers(JSON.parse(event.data));
    const id = String(row[idField]);
    const operation = seen.has(id) ? 'UPDATE' : 'INSERT';
    seen.add(id);
    onChange(operation, row, Object.keys(row));
  };

  source.addEventListener('delete', (event) => {
    const key = parseNumbers(JSON.parse(atob(event.data.replace(/-/g, '+').replace(/_/g, '/'))));
    seen.delete(String(key[idField]));
    onChange('DELETE', key, null);
  });

  return source;
}

// Materialize writes numeric values as JSON strings, to keep their precision. The grid needs numbers.
function parseNumbers(row) {
  return Object.fromEntries(Object.entries(row).map(([field, value]) =>
    [field, typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value]));
}
