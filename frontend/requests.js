// The calls that book a trade, which are plain HTTP to the Restate server. It answers calls from a
// page on another origin. Each call throws Restate's message if it fails.
const RESTATE_URL = import.meta.env.VITE_RESTATE_URL ?? 'http://localhost:8080';

// Asks for a trade to be booked, by creating its state machine. The quantity is signed: positive
// buys, negative sells. The id is the request's own and goes as the idempotency key too, so the same
// request sent again books nothing more. What happens next comes as the trade's status.
export async function requestTrade(id, { symbol, quantity }) {
  await post(`${RESTATE_URL}/restate/call/trades/${id}/create`, { symbol, quantity }, { 'idempotency-key': id });
}

// Approves or rejects a trade that is waiting for approval
export async function answerRequest(id, answer) {
  await post(`${RESTATE_URL}/restate/call/trades/${id}/send`, { type: answer });
}

// Makes a call, with a JSON body if there is one, and throws if the response is not ok
async function post(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: body ? { 'content-type': 'application/json', ...headers } : headers,
    body: body && JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await errorText(response));
}

// Restate's message if the response has one, or else its text or status
async function errorText(response) {
  const text = await response.text();
  try {
    return JSON.parse(text).message ?? text;
  } catch {
    return text || `${response.status} ${response.statusText}`;
  }
}
