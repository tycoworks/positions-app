// Checks that a trade is booked once, whatever dies on the way. They run against the stack Compose
// started, trade GOOG and MSFT, and leave each position where they found it:
//
//   cd test && npm install && npm test
//
// A pending trade expires after its symbol's approval wait, a minute in limit_rules. While they run,
// the tests shorten it to TEST_APPROVAL_WAIT, and put it back when they finish.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';

const RESTATE = 'http://localhost:8080';
const RESTATE_ADMIN = 'http://localhost:9070';
// The limits each instrument has in model/tables.sql
const POSITION_LIMIT = 500_000;
const APPROVAL_OVER = 100_000;

// The function as the stack deployed it, which is one bundled file, and the places in it where a test
// stops it: as insertTrade starts its INSERT, and as it ends
const BUNDLES = 'backend/dist';
const BUNDLE = 'index.js';
const DEPLOY = '/etc/floci/init/ready.d/deploy.sh';
const INSERT_STARTS = 'async function insertTrade(trade, status) {\n  await db.insert(tradesTable).select(';
const INSERT_ENDS = '  );\n}\nasync function updateTrade(';
const HOLD_SECONDS = 10;
const TEST_APPROVAL_WAIT = 15; // seconds: long enough to answer a trade after restarting Restate

const root = new URL('..', import.meta.url).pathname;
const database = new pg.Pool({ host: 'localhost', port: 6875, user: 'materialize', database: 'materialize' });
const requests = []; // every request the tests make
let approvalWait; // seconds, as the tests set it
let approvalWaits; // each instrument's approval wait before the tests, to put back
let deployed; // the function Restate sends its work to, as an AWS name
let large; // GOOG shares worth just enough to need approval

before(async () => {
  ({ rows: approvalWaits } = await database.query('SELECT instrument_id, approval_wait_seconds FROM limit_rules'));
  await database.query('UPDATE limit_rules SET approval_wait_seconds = $1', [TEST_APPROVAL_WAIT]);
  approvalWait = TEST_APPROVAL_WAIT;
  const { deployment_id: id } = await admin('services/trades');
  deployed = (await admin('deployments')).deployments.find((deployment) => deployment.id === id).arn;
  for (const symbol of ['GOOG', 'MSFT']) {
    const { value } = await position(symbol);
    assert.ok(Math.abs(value) < 350_000, `${symbol} is too near its limit. Start a fresh stack: docker compose down && docker compose up -d`);
  }
  large = shares(APPROVAL_OVER + 5_000, (await position('GOOG')).price);
});

after(async () => {
  for (const { instrument_id, approval_wait_seconds } of approvalWaits ?? []) {
    await database.query('UPDATE limit_rules SET approval_wait_seconds = $1 WHERE instrument_id = $2', [approval_wait_seconds, instrument_id]);
  }
  await database.end();
});

test('a small trade is booked once, and the position moves by its quantity', async () => {
  const { net } = await position('GOOG');
  await becomes(await request('GOOG', 10), 'Booked');
  assert.equal((await position('GOOG')).net, net + 10);
});

test('the same request sent twice books one trade', async () => {
  const { net } = await position('GOOG');
  const id = await request('GOOG', -10);
  await request('GOOG', -10, id);
  await becomes(id, 'Booked');
  assert.equal((await position('GOOG')).net, net - 10);
});

test("a request that can't be a trade is turned away, and nothing is written", async () => {
  const id = randomUUID();
  await call(`trades/${id}/create`, { symbol: 'NOPE', quantity: 10 });
  await until(async () => (await state(id)) === 'Invalid', 15);
  assert.deepEqual(await statuses(id), []);

  // A quantity that isn't a whole number is refused at the door, by the machine's own schema
  const response = await fetch(`${RESTATE}/restate/call/trades/${randomUUID()}/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ symbol: 'GOOG', quantity: 1.5 }),
  });
  assert.equal(response.status, 400);
});

test('a trade that would pass the limit is refused', async () => {
  const { net, value, price } = await position('MSFT');
  const side = value < 0 ? -1 : 1; // further the way MSFT already leans, where the limit is nearest
  await becomes(await request('MSFT', side * shares(POSITION_LIMIT - Math.abs(value) + 20_000, price)), 'Refused');
  assert.equal((await position('MSFT')).net, net);
});

test('trades sent at once book only the ones that fit', async () => {
  const { net, value, price } = await position('MSFT');
  const side = value < 0 ? -1 : 1;
  const room = POSITION_LIMIT - Math.abs(value);
  // Each is under the approval size, and sized so that exactly `fit` fit, with room to spare either side
  const fit = Math.max(3, Math.ceil(room / 95_000 - 0.5));
  const quantity = side * shares(room / (fit + 0.5), price);
  const ids = await Promise.all(Array.from({ length: fit + 2 }, () => request('MSFT', quantity)));

  const counts = () => sql('SELECT status, count(*)::int AS trades FROM trades WHERE id = ANY($1::text[]) GROUP BY status', [ids]);
  await until(async () => (await counts()).reduce((sum, row) => sum + row.trades, 0) === ids.length, 15);
  assert.deepEqual(Object.fromEntries((await counts()).map((row) => [row.status, row.trades])), { Booked: fit, Refused: 2 });

  for (let i = 0; i < fit; i++) await becomes(await request('MSFT', -quantity), 'Booked'); // put it back
  assert.equal((await position('MSFT')).net, net);
});

test('a large trade is pending until approved, and counts towards the limit meanwhile', async () => {
  const { net, value, price } = await position('GOOG');
  const id = await request('GOOG', large);
  await becomes(id, 'Pending');
  assert.equal((await position('GOOG')).net, net, 'a pending trade is not in the position');
  await until(async () => (await unfinished(id)) === 'trades deliverScheduled scheduled', 5, "while a trade is pending, Restate holds one call for it: its machine's expiry, scheduled");

  // A second trade that fits beside the position alone, and not once the pending one is counted
  const other = await request('GOOG', shares(POSITION_LIMIT - value - (large * price) / 2, price));
  await becomes(other, 'Refused');

  await answer(id, 'Approve');
  await becomes(id, 'Booked');
  assert.equal((await position('GOOG')).net, net + large);
});

test('a pending trade that is rejected is not booked, and a later answer changes nothing', async () => {
  const { net } = await position('GOOG');
  const id = await request('GOOG', -large);
  await becomes(id, 'Pending');
  const made = await requestedAt(id);
  await answer(id, 'Reject');
  await becomes(id, 'Rejected');
  assert.equal(await requestedAt(id), made, 'a rejected request keeps the time it was made');
  await answer(id, 'Approve'); // the machine has no move for it from rejected, so it is ignored
  await becomes(id, 'Rejected');
  assert.equal((await position('GOOG')).net, net);
});

test('a pending trade expires when nobody answers', { timeout: 180_000 }, async () => {
  const id = await request('GOOG', -large);
  await becomes(id, 'Pending');
  const made = await requestedAt(id);
  await becomes(id, 'Expired', approvalWait + 15);
  assert.equal(await requestedAt(id), made, 'an expired request keeps the time it was made');
});

test('with the function killed while a trade is pending, approving it books it once', async () => {
  const { net } = await position('GOOG');
  const id = await request('GOOG', -large);
  await becomes(id, 'Pending');
  killFunction();
  await answer(id, 'Approve');
  await becomes(id, 'Booked', 30);
  assert.equal((await position('GOOG')).net, net - large);
});

test('with Restate killed while a trade is pending, approving it books it once', async () => {
  const { net } = await position('GOOG');
  const id = await request('GOOG', large);
  await becomes(id, 'Pending');
  compose('kill', 'restate');
  await sleep(2000);
  compose('start', 'restate');
  await until(async () => (await fetch(`${RESTATE}/restate/health`).catch(() => ({}))).ok, 30);
  await answer(id, 'Approve');
  await becomes(id, 'Booked', 30);

  const back = await request('GOOG', -large); // put it back
  await becomes(back, 'Pending');
  await answer(back, 'Approve');
  await becomes(back, 'Booked');
  assert.equal((await position('GOOG')).net, net);
});

test("with the function killed straight after a trade's INSERT commits, the step runs again and leaves one trade", { timeout: 240_000 }, async () => {
  // A function that stops for good after an INSERT that wrote a row, and not after one that found it there
  const stopped = [
    [INSERT_STARTS, INSERT_STARTS.replace('await', 'const written = await')],
    [INSERT_ENDS, INSERT_ENDS.replace('}', '  if (written.rowCount) await new Promise(() => {});\n}')],
  ];
  await withChanged(stopped, async () => {
    const id = await request('GOOG', 10);
    await until(async () => (await statuses(id)).join() === 'Booked', 60, 'the trade was never written');
    assert.notEqual(await unfinished(id), '', "the function wasn't stopped, so Restate has recorded the step");

    killFunction();
    await until(async () => (await unfinished(id)) === '', 90, 'the step never finished');
    await becomes(id, 'Booked');
  });
  await becomes(await request('GOOG', -10), 'Booked'); // put it back
});

test("a trade whose row isn't written yet still counts towards the limit", { timeout: 240_000 }, async () => {
  const { net, value, price } = await position('MSFT');
  const side = value < 0 ? -1 : 1;
  const room = POSITION_LIMIT - Math.abs(value);
  const quantity = side * shares(90_000, price); // under the approval size, so it is booked
  // A function that waits before it writes a booked trade, and writes any other at once
  const slow = [[INSERT_STARTS, INSERT_STARTS.replace('{\n', `{\n  if (status === "Booked") await new Promise((resolve) => setTimeout(resolve, ${HOLD_SECONDS * 1000}));\n`)]];
  await withChanged(slow, async () => {
    const first = await request('MSFT', quantity);
    await until(async () => (await letThrough('MSFT')).includes(first), 15, 'the first trade was not let through');
    // A second trade that fits beside the position alone, and not once the first is counted
    const second = await request('MSFT', side * shares(room - 90_000 + 20_000, price));
    await until(async () => (await statuses(second)).join() === 'Refused', HOLD_SECONDS / 2, 'the second trade was not refused');
    assert.deepEqual(await statuses(first), [], "the first trade's row was not yet written");

    await becomes(first, 'Booked', 90);
    await becomes(second, 'Refused', 90);
  });
  await becomes(await request('MSFT', -quantity), 'Booked'); // put it back
  assert.equal((await position('MSFT')).net, net);
});

test('every request left exactly one trade, and none is still pending', async () => {
  const trades = await sql('SELECT id, count(*)::int AS rows, max(status) AS status FROM trades WHERE id = ANY($1::text[]) GROUP BY id', [requests]);
  assert.equal(trades.length, requests.length, 'a request left no trade');
  assert.deepEqual(trades.filter((trade) => trade.rows !== 1 || trade.status === 'Pending'), []);
});

// Asks for a trade, under a new id or the one given, and gives the id back. The id goes as the
// idempotency key too, as the page sends it.
async function request(symbol, quantity, id = randomUUID()) {
  await call(`trades/${id}/create`, { symbol, quantity }, { 'idempotency-key': id });
  if (!requests.includes(id)) requests.push(id);
  return id;
}

// Approves or rejects a trade that is waiting for approval
async function answer(id, which) {
  await call(`trades/${id}/send`, { type: which });
}

// The state of a trade's machine, as Restate holds it
async function state(id) {
  return (await call(`trades/${id}/snapshot`, {})).value;
}

// Calls one of the function's handlers through Restate, and gives its reply
async function call(handler, body, headers = {}) {
  const response = await fetch(`${RESTATE}/restate/call/${handler}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body && JSON.stringify(body),
  });
  const text = await response.text();
  assert.ok(response.ok, `Restate answered ${response.status}: ${text}`);
  return text ? JSON.parse(text) : undefined;
}

// Waits for a trade to have this status, on its one row and in its machine, and fails if it doesn't in time
async function becomes(id, status, seconds = 15) {
  await until(async () => (await statuses(id)).join() === status && (await state(id)) === status, seconds, `trade ${id} never became ${status}`);
}

// The time on a trade's row, as text, which is when it was made until it is booked
async function requestedAt(id) {
  const [row] = await sql('SELECT executed_at::text AS time FROM trades WHERE id = $1', [id]);
  return row.time;
}

// The status of each row a trade has. A trade written once has one.
async function statuses(id) {
  return (await sql('SELECT status FROM trades WHERE id = $1', [id])).map((row) => row.status);
}

async function position(symbol) {
  const [row] = await sql('SELECT net_position, market_value, latest_price FROM positions WHERE symbol = $1', [symbol]);
  return { net: Number(row.net_position), value: Number(row.market_value), price: Number(row.latest_price) };
}

// The whole number of shares worth about this many dollars
function shares(dollars, price) {
  return Math.max(1, Math.floor(dollars / price));
}

// The trades a symbol's limits have let through and still remember, as Restate holds them
async function letThrough(symbol) {
  const { rows } = await admin('query', { query: `SELECT value_utf8 FROM state WHERE service_name = 'limits' AND service_key = '${symbol}' AND key = 'letThrough'` });
  return rows.length ? Object.keys(JSON.parse(rows[0].value_utf8)) : [];
}

// The calls Restate holds for a trade that haven't finished, as service, handler, and status
async function unfinished(id) {
  const { rows } = await admin('query', { query: `SELECT target, status FROM sys_invocation WHERE target LIKE '%/${id}/%' AND status != 'completed'` });
  return rows.map((row) => `${row.target.split('/')[0]} ${row.target.split('/').pop()} ${row.status}`).join();
}

async function sql(text, values) {
  return (await database.query(text, values)).rows;
}

// Deploys a copy of the function's bundle with these changes, as a function of its own that takes
// Restate's new work while the body runs. Then new work goes to the real function again. Each change
// is a place in the bundle and what goes there instead.
async function withChanged(changes, body) {
  let bundle = readFileSync(`${root}${BUNDLES}/${BUNDLE}`, 'utf8');
  for (const [place, replacement] of changes) {
    assert.equal(bundle.split(place).length, 2, `${BUNDLE} has changed, so this test needs the new place to stop it`);
    bundle = bundle.replace(place, () => replacement);
  }
  const name = `book-trade-${randomUUID().slice(0, 8)}`;
  writeFileSync(`${root}${BUNDLES}/${name}.js`, bundle);
  try {
    compose('exec', '-T', 'floci', DEPLOY, name, `${name}.js`);
    await body();
  } finally {
    rmSync(`${root}${BUNDLES}/${name}.js`, { force: true });
    await admin('deployments', { arn: deployed, force: true });
  }
}

// Kills the containers Floci is running functions in. It starts one again for the next call.
function killFunction() {
  const containers = docker('ps', '-q', '--filter', 'label=io.floci.service=lambda').split('\n').filter(Boolean);
  if (containers.length) docker('kill', ...containers);
}

// Asks Restate's admin API for something, or posts to it, and gives its reply
async function admin(path, body) {
  const response = await fetch(`${RESTATE_ADMIN}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: body && JSON.stringify(body),
  });
  const text = await response.text();
  assert.ok(response.ok, `Restate answered ${response.status}: ${text}`);
  return text ? JSON.parse(text) : undefined;
}

// Runs docker compose in the app's folder
function compose(...args) {
  return docker('compose', ...args);
}

function docker(...args) {
  return execFileSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Tries a condition four times a second until it holds, and fails if it doesn't in time
async function until(condition, seconds, message = 'timed out') {
  const deadline = Date.now() + seconds * 1000;
  while (!(await condition())) {
    assert.ok(Date.now() < deadline, message);
    await sleep(250);
  }
}
