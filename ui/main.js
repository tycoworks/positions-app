import { createGrid, ModuleRegistry, AllCommunityModule, themeAlpine } from 'ag-grid-community';
import { Operation, gql, subscribe } from './graphql.js';

ModuleRegistry.registerModules([AllCommunityModule]);

// The source the app subscribes to and its list, and each one's key
const POSITIONS = 'positions';
const TRADES = 'trades';
const POSITION_KEY = 'instrument_id';
const TRADE_KEY = 'id';

// Setup positions grid
const positionsColumnConfig = getPositionsColumnConfig();
const positionsFields = Object.keys(positionsColumnConfig);
const positionsGridApi = createPositionsGrid();

// Setup trades grid, for the selected position
const tradesColumnConfig = getTradesColumnConfig();
const tradesFields = Object.keys(tradesColumnConfig);
const tradesGridApi = createTradesGrid();

// The rows as they are now, by key: the positions, and each position's trades
const positions = new Map();
const tradesByPosition = new Map();
let selectedPosition = null;

// One subscription: the positions with all their trades, each timestamp as one message
subscribe(POSITIONS, gql`subscription {
  ${POSITIONS} {
    operation fields data { ${positionsFields.join(' ')} }
    ${TRADES} { operation fields data { ${tradesFields.join(' ')} } }
  }
}`, (updates) => {
  let selectedTrades = null;
  for (const { data, [TRADES]: trades } of updates) {
    const id = data[POSITION_KEY];
    const transaction = applyUpdates(rowsOf(tradesByPosition, id), trades, TRADE_KEY);
    if (id === selectedPosition) selectedTrades = transaction;
  }
  // Both grids change together, so they never show different timestamps
  positionsGridApi.applyTransaction(applyUpdates(positions, updates, POSITION_KEY));
  if (selectedTrades) tradesGridApi.applyTransaction(selectedTrades);
});

// Show the trades of the clicked position, which are already here
function selectPosition(position) {
  selectedPosition = position[POSITION_KEY];
  document.querySelector('#trades-title').textContent = `Trades: ${position.symbol}`;
  tradesGridApi.setGridOption('rowData', [...rowsOf(tradesByPosition, selectedPosition).values()]);
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

function getPositionsColumnConfig() {
  return {
    [POSITION_KEY]: { hide: true },
    symbol: { headerName: 'Symbol' },
    latest_price: {
      headerName: 'Latest Price',
      valueFormatter: params => params.value != null ? Number(params.value).toFixed(2) : '',
      cellRenderer: 'agAnimateShowChangeCellRenderer',
      minWidth: 120
    },
    net_position: {
      headerName: 'Net Position',
      valueFormatter: params => params.value != null ? Number(params.value).toLocaleString() : ''
    },
    market_value: {
      headerName: 'Market Value',
      valueFormatter: params => params.value != null
        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(params.value)
        : ''
    },
    avg_cost_basis: {
      headerName: 'Avg Cost',
      valueFormatter: params => params.value != null ? Number(params.value).toFixed(2) : ''
    },
    theoretical_pnl: {
      headerName: 'Theoretical P&L',
      ...getPnlColumnConfig()
    }
  };
}

function getTradesColumnConfig() {
  return {
    [TRADE_KEY]: { hide: true },
    executed_at: {
      headerName: 'Executed At',
      width: 200,
      sort: 'desc',
      valueFormatter: params => params.value ? new Date(params.value).toLocaleString() : ''
    },
    quantity: {
      headerName: 'Quantity',
      valueFormatter: params => params.value != null ? Number(params.value).toLocaleString() : '',
      cellStyle: params => ({ color: params.value > 0 ? 'green' : params.value < 0 ? 'red' : 'black' })
    },
    price: {
      headerName: 'Price',
      valueFormatter: params => params.value != null ? Number(params.value).toFixed(2) : ''
    }
  };
}

function getPnlColumnConfig() {
  return {
    valueFormatter: params => params.value != null
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(params.value)
      : '',
    cellStyle: params => ({
      color: params.value > 0 ? 'green' : params.value < 0 ? 'red' : 'black'
    })
  };
}

function createPositionsGrid() {
  return createGrid(document.querySelector('#positions-grid'), {
    overlayNoRowsTemplate: '<span style="padding: 10px">No positions yet</span>',
    theme: themeAlpine,
    columnDefs: positionsFields.map(field => ({ field, ...positionsColumnConfig[field] })),
    rowData: [],
    getRowId: params => String(params.data[POSITION_KEY]),
    rowSelection: { mode: 'singleRow', checkboxes: false, enableClickSelection: true },
    onRowClicked: event => selectPosition(event.data),
    defaultColDef: {
      resizable: true
    },
    autoSizeStrategy: {
      type: 'fitGridWidth'
    }
  });
}

function createTradesGrid() {
  return createGrid(document.querySelector('#trades-grid'), {
    overlayNoRowsTemplate: '<span style="padding: 10px">Click a position to see its trades</span>',
    theme: themeAlpine,
    columnDefs: tradesFields.map(field => ({ field, ...tradesColumnConfig[field] })),
    rowData: [],
    getRowId: params => String(params.data[TRADE_KEY]),
    defaultColDef: {
      resizable: true
    },
    autoSizeStrategy: {
      type: 'fitGridWidth'
    }
  });
}
