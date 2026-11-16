import { createGrid, ModuleRegistry, AllCommunityModule, themeAlpine } from 'ag-grid-community';
import { Answer, TradeStatus } from '../model/enums.ts';
import { Operation, gql, subscribe } from './graphql.js';
import { requestTrade, answerRequest } from './requests.js';

ModuleRegistry.registerModules([AllCommunityModule]);

// The sources the app subscribes to, and each one's key
const POSITIONS = 'positions';
const TRADES = 'trades';
const REQUESTS = 'requests';
const POSITION_KEY = 'instrument_id';
const TRADE_KEY = 'id';

// Each position's limits, which come joined to it from the limits view
const LIMITS = 'limits';

// The colour of each status a request can show
const STATUS_COLORS = {
  [TradeStatus.Pending]: '#b26a00',
  [TradeStatus.Refused]: 'red',
  [TradeStatus.Rejected]: 'red',
  [TradeStatus.Expired]: 'gray',
};

// Setup positions grid, with each position's limits beside it
const positionsColumnConfig = getPositionsColumnConfig();
const positionsFields = Object.keys(positionsColumnConfig);
const limitsColumnConfig = getLimitsColumnConfig();
const limitsFields = Object.keys(limitsColumnConfig);
const positionsGridApi = createPositionsGrid();

// Setup trades grid, for the selected position's booked trades
const tradesColumnConfig = getTradesColumnConfig();
const tradesFields = Object.keys(tradesColumnConfig);
const tradesGridApi = createTradesGrid();

// Setup requests grid, for the selected position's requests: its trades that aren't booked, from the
// requests view. A request has a trade's fields and its status.
const requestsFields = [...tradesFields, 'status'];
const requestsGridApi = createRequestsGrid();

// The rows as they are now, by key: the positions, and each position's booked trades and requests
const positions = new Map();
const tradesByPosition = new Map();
const requestsByPosition = new Map();
let selectedPosition = null;

// The ticket's controls
const symbolSelect = document.querySelector('#ticket-symbol');
const quantityInput = document.querySelector('#ticket-quantity');
const buyButton = document.querySelector('#ticket-buy');
const sellButton = document.querySelector('#ticket-sell');
const ticketStatus = document.querySelector('#ticket-status');

// One id for each ticket, not each click. It changes only once a request is sent, so pressing a
// button again after a failure sends the same request again, and books it once.
let ticketId = crypto.randomUUID();

buyButton.addEventListener('click', () => sendRequest(1));
sellButton.addEventListener('click', () => sendRequest(-1));

// One subscription for the whole page: the positions, each joined to its limits, with its booked
// trades and its requests, each timestamp as one message
subscribe(POSITIONS, gql`subscription {
  ${POSITIONS} {
    operation fields data { ${positionsFields.join(' ')} ${LIMITS} { ${limitsFields.join(' ')} } }
    ${TRADES}(where: { status: { _eq: ${TradeStatus.Booked} } }) { operation fields data { ${tradesFields.join(' ')} } }
    ${REQUESTS} { operation fields data { ${requestsFields.join(' ')} } }
  }
}`, (updates) => {
  let selectedChanged = false;
  for (const { data, [TRADES]: trades, [REQUESTS]: requests } of updates) {
    const id = data[POSITION_KEY];
    const transactions = [
      applyUpdates(rowsOf(tradesByPosition, id), trades, TRADE_KEY),
      applyUpdates(rowsOf(requestsByPosition, id), requests, TRADE_KEY),
    ];
    const changed = transactions.some((transaction) => Object.values(transaction).some((rows) => rows.length));
    if (id === selectedPosition && changed) selectedChanged = true;
  }
  // All three grids change together, so they never show different timestamps
  positionsGridApi.applyTransaction(applyUpdates(positions, updates, POSITION_KEY));
  if (selectedChanged) showSelectedTrades();
  offerSymbols();
});

// Show the trades and requests of the clicked position, which are already here, and put its symbol
// in the ticket
function selectPosition(position) {
  selectedPosition = position[POSITION_KEY];
  document.querySelector('#trades-title').textContent = `Trades: ${position.symbol}`;
  document.querySelector('#requests-title').textContent = `Requests: ${position.symbol}`;
  showSelectedTrades();
  symbolSelect.value = position.symbol;
}

// Puts the selected position's booked trades and requests in the two grids under it. A trade moves
// from one to the other when it is booked.
function showSelectedTrades() {
  tradesGridApi.setGridOption('rowData', [...rowsOf(tradesByPosition, selectedPosition).values()]);
  requestsGridApi.setGridOption('rowData', [...rowsOf(requestsByPosition, selectedPosition).values()]);
}

// Offers the positions' symbols in the ticket, sorted. The options are replaced only when the symbols
// change, and the symbol chosen stays chosen.
function offerSymbols() {
  const symbols = [...new Set([...positions.values()].map((position) => position.symbol))].sort();
  if (symbols.join() === [...symbolSelect.options].map((option) => option.value).join()) return;
  const chosen = symbolSelect.value;
  symbolSelect.replaceChildren(...symbols.map((symbol) => new Option(symbol)));
  if (symbols.includes(chosen)) symbolSelect.value = chosen;
}

// Sends the ticket's request: Buy as +quantity, Sell as -quantity. Both buttons are off until the reply.
async function sendRequest(sign) {
  if (!symbolSelect.reportValidity() || !quantityInput.reportValidity()) return;
  const request = { symbol: symbolSelect.value, quantity: sign * quantityInput.valueAsNumber };
  buyButton.disabled = sellButton.disabled = true;
  showStatus('Sending');
  try {
    await requestTrade(ticketId, request);
    ticketId = crypto.randomUUID();
    showStatus(`Sent: ${sign > 0 ? 'buy' : 'sell'} ${quantityInput.valueAsNumber.toLocaleString()} ${request.symbol}`);
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    buyButton.disabled = sellButton.disabled = false;
  }
}

// Gives a pending trade its answer. The buttons stay off once the call is made, as the result comes
// as a change of status, which takes the trade out of the grid or redraws its row.
async function sendAnswer(id, answer, buttons) {
  buttons.forEach((button) => { button.disabled = true; });
  try {
    await answerRequest(id, answer);
  } catch (error) {
    buttons.forEach((button) => { button.disabled = false; });
    showStatus(error.message, true);
  }
}

// Shows the ticket's status text, an error in red
function showStatus(text, isError = false) {
  ticketStatus.textContent = text;
  ticketStatus.classList.toggle('error', isError);
}

// A parent's rows by key, made when first needed
function rowsOf(byParent, parentId) {
  if (!byParent.has(parentId)) byParent.set(parentId, new Map());
  return byParent.get(parentId);
}

// Applies one timestamp's updates to rows kept by key, and gives the grid transaction that does the
// same: an INSERT adds its row, an UPDATE merges in only the fields it names, as the others come as
// null, and a DELETE removes its row. Only the rows the updates name change.
function applyUpdates(rows, updates, idField) {
  const transaction = { add: [], update: [], remove: [] };
  for (const { operation, data, fields } of updates) {
    const id = data[idField];
    switch (operation) {
      case Operation.Insert:
        rows.set(id, data);
        transaction.add.push(data);
        break;
      case Operation.Update: {
        const row = rows.get(id);
        if (!row) {
          console.warn(`UPDATE received for non-existent row with ${idField}=${id}`);
          break;
        }
        const merged = { ...row, ...Object.fromEntries(fields.map((field) => [field, data[field]])) };
        rows.set(id, merged);
        transaction.update.push(merged);
        break;
      }
      case Operation.Delete:
        rows.delete(id);
        transaction.remove.push(data);
        break;
    }
  }
  return transaction;
}

// A timestamp as date and time text, in local time. It comes without a zone, and is in UTC.
function localTime(timestamp) {
  return timestamp ? new Date(`${timestamp}Z`).toLocaleString() : '';
}

// A request's columns, which are a trade's with its side spelled out, its notional, and its status
function getRequestsColumns() {
  const trade = tradesColumnConfig;
  return [
    { field: TRADE_KEY, ...trade[TRADE_KEY] },
    // When the request was made, newest first. A trade's time only moves when it is booked, and a
    // booked trade isn't a request.
    { field: 'executed_at', ...trade.executed_at, headerName: 'Requested At' },
    {
      // A trade's quantity is positive for a buy and negative for a sell. Here the side is spelled
      // out, and the quantity is shown without its sign.
      headerName: 'Side',
      valueGetter: params => params.data.quantity > 0 ? 'Buy' : 'Sell',
      cellStyle: params => ({ color: signColor(params.data.quantity) })
    },
    {
      headerName: 'Quantity',
      valueGetter: params => Math.abs(params.data.quantity),
      valueFormatter: formatQuantity
    },
    { field: 'price', ...trade.price },
    {
      // The quantity times the price, which is what the limit and the approval size are measured in.
      // Signed and coloured as a position's P&L is: a buy adds to the market value, a sell takes away.
      headerName: 'Notional',
      valueGetter: params => params.data.quantity * params.data.price,
      ...getPnlColumnConfig()
    },
    {
      field: 'status',
      headerName: 'Status',
      cellStyle: params => ({ color: STATUS_COLORS[params.value] ?? 'black', fontWeight: 'bold' })
    },
    {
      // The status a second time. The grid redraws a cell only when its own value changes, so with
      // the status as its value the buttons come and go as the status changes.
      colId: 'answer',
      field: 'status',
      headerName: '',
      sortable: false,
      minWidth: 170, // room for both buttons
      cellRenderer: getAnswerButtons
    }
  ];
}

// Approve and Reject buttons for a trade that is pending, and nothing for any other
function getAnswerButtons(params) {
  if (params.value !== TradeStatus.Pending) return null;
  const cell = document.createElement('span');
  const buttons = [Answer.Approve, Answer.Reject].map((answer) => {
    const button = document.createElement('button');
    button.textContent = answer;
    button.style.marginRight = '6px';
    button.addEventListener('click', () => sendAnswer(params.data[TRADE_KEY], answer, buttons));
    return button;
  });
  cell.append(...buttons);
  return cell;
}

function getPositionsColumnConfig() {
  return {
    [POSITION_KEY]: { hide: true },
    symbol: { headerName: 'Symbol' },
    latest_price: {
      headerName: 'Latest Price',
      valueFormatter: formatPrice,
      cellRenderer: 'agAnimateShowChangeCellRenderer',
      minWidth: 120
    },
    net_position: {
      headerName: 'Net Position',
      valueFormatter: formatQuantity
    },
    market_value: {
      headerName: 'Market Value',
      valueFormatter: formatDollars
    },
    avg_cost_basis: {
      headerName: 'Avg Cost',
      valueFormatter: formatPrice
    },
    theoretical_pnl: {
      headerName: 'Theoretical P&L',
      ...getPnlColumnConfig()
    }
  };
}

// A position's limits: the share of the limit that is used, what is pending on each side, and what is
// left to buy and to sell. A pending buy or sell shows in its own colour, and what's available turns
// red once nothing is left.
function getLimitsColumnConfig() {
  const available = { valueFormatter: formatDollars, cellStyle: params => ({ color: params.value <= 0 ? 'red' : 'black' }) };
  return {
    position_limit: { headerName: 'Limit', valueFormatter: formatDollars },
    utilisation: { headerName: 'Used', cellRenderer: getUsedBar },
    pending_buys: { headerName: 'Pending Buys', ...getPnlColumnConfig() },
    pending_sells: { headerName: 'Pending Sells', ...getPnlColumnConfig() },
    available_to_buy: { headerName: 'Available to Buy', ...available },
    available_to_sell: { headerName: 'Available to Sell', ...available }
  };
}

function getTradesColumnConfig() {
  return {
    [TRADE_KEY]: { hide: true },
    executed_at: {
      headerName: 'Executed At',
      width: 200,
      sort: 'desc',
      valueFormatter: params => localTime(params.value)
    },
    quantity: {
      headerName: 'Quantity',
      valueFormatter: formatQuantity,
      cellStyle: params => ({ color: signColor(params.value) })
    },
    price: {
      headerName: 'Price',
      valueFormatter: formatPrice
    }
  };
}

// The share of a limit that is used, as a bar that fills from the left with the percentage on it. The
// bar is green, amber from 80%, and red from 100%.
function getUsedBar(params) {
  if (params.value == null) return null;
  const share = Math.max(0, params.value);
  const bar = document.createElement('div');
  bar.style.cssText = 'position: relative; top: 25%; height: 50%; background: #eee; border-radius: 3px; overflow: hidden;';
  const fill = document.createElement('div');
  const color = share >= 1 ? '#e57373' : share >= 0.8 ? '#e6b566' : '#8bc48b';
  fill.style.cssText = `width: ${Math.min(share, 1) * 100}%; height: 100%; background: ${color};`;
  const label = document.createElement('span');
  label.textContent = `${Math.round(share * 100)}%`;
  label.style.cssText = 'position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11px;';
  bar.append(fill, label);
  return bar;
}

// A cell's number as text: a price to the cent, a quantity with its thousands marked, and dollars
// such as $1,234.50. An empty cell stays empty.
function formatPrice(params) {
  return params.value != null ? Number(params.value).toFixed(2) : '';
}

function formatQuantity(params) {
  return params.value != null ? Number(params.value).toLocaleString() : '';
}

function formatDollars(params) {
  return params.value != null
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(params.value)
    : '';
}

// The colour of a number by its sign: green above zero, red below
function signColor(value) {
  return value > 0 ? 'green' : value < 0 ? 'red' : 'black';
}

// Dollars, coloured by their sign
function getPnlColumnConfig() {
  return {
    valueFormatter: formatDollars,
    cellStyle: params => ({ color: signColor(params.value) })
  };
}

// A grid with the settings all three share: the theme, columns that fit its width, rows known by
// their key, and a line of text while it has no rows
function createAppGrid(selector, keyField, emptyText, options) {
  return createGrid(document.querySelector(selector), {
    overlayNoRowsTemplate: `<span style="padding: 10px">${emptyText}</span>`,
    theme: themeAlpine,
    rowData: [],
    getRowId: params => String(params.data[keyField]),
    defaultColDef: {
      resizable: true
    },
    autoSizeStrategy: {
      type: 'fitGridWidth'
    },
    ...options
  });
}

function createPositionsGrid() {
  return createAppGrid('#positions-grid', POSITION_KEY, 'No positions yet', {
    // Two groups under shared headers: the position, then its limits, which are a nested row
    columnDefs: [
      {
        headerName: 'Position',
        children: positionsFields.map(field => ({ field, ...positionsColumnConfig[field] }))
      },
      {
        headerName: 'Limits',
        children: limitsFields.map(field => ({
          colId: field,
          valueGetter: params => params.data[LIMITS]?.[field],
          ...limitsColumnConfig[field]
        }))
      }
    ],
    rowSelection: { mode: 'singleRow', checkboxes: false, enableClickSelection: true },
    onRowClicked: event => selectPosition(event.data)
  });
}

function createTradesGrid() {
  return createAppGrid('#trades-grid', TRADE_KEY, 'Click a position to see its trades', {
    columnDefs: tradesFields.map(field => ({ field, ...tradesColumnConfig[field] }))
  });
}

function createRequestsGrid() {
  return createAppGrid('#requests-grid', TRADE_KEY, 'No requests for the selected position', {
    columnDefs: getRequestsColumns(),
    // Keeps room for the scrollbar, so the columns still fit once the rows need one
    alwaysShowVerticalScroll: true
  });
}
