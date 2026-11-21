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

// Setup trades grid, which holds every position's trades and shows the selected position's
const tradesColumnConfig = getTradesColumnConfig();
const tradesFields = Object.keys(tradesColumnConfig);
const tradesGridApi = createTradesGrid();
let selectedPosition = null;

// One subscription: the positions with all their trades, each timestamp as one message
const POSITIONS_SUBSCRIPTION = gql`
  subscription Positions {
    positions {
      operation
      key
      data { instrument_id symbol latest_price net_position market_value avg_cost_basis theoretical_pnl }
      trades {
        operation
        key
        data { id instrument_id executed_at quantity price }
      }
    }
  }
`;

subscribe(POSITIONS, POSITIONS_SUBSCRIPTION, (updates) => {
  // Both grids change together, so they never show different timestamps
  positionsGridApi.applyTransaction(toTransaction(updates, POSITION_KEY));
  tradesGridApi.applyTransaction(toTransaction(updates.flatMap((update) => update[TRADES]), TRADE_KEY));
});

// Show the trades of the clicked position, which are already here
function selectPosition(position) {
  selectedPosition = position[POSITION_KEY];
  document.querySelector('#trades-title').textContent = `Trades: ${position.symbol}`;
  tradesGridApi.onFilterChanged();
}

// Turns updates into a grid transaction: an INSERT adds its row, an UPDATE with data replaces the row,
// an UPDATE without data changes nothing here, and a DELETE removes the row by its key
function toTransaction(updates, keyField) {
  const transaction = { add: [], update: [], remove: [] };
  for (const { operation, key, data } of updates) {
    if (operation === Operation.Insert) transaction.add.push(data);
    else if (operation === Operation.Update && data) transaction.update.push(data);
    else if (operation === Operation.Delete) transaction.remove.push({ [keyField]: key });
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
    overlayComponentParams: { noMatchingRows: { overlayText: 'Click a position to see its trades' } },
    theme: themeAlpine,
    columnDefs: tradesFields.map(field => ({ field, ...tradesColumnConfig[field] })),
    rowData: [],
    getRowId: params => String(params.data[TRADE_KEY]),
    // A trade names its position in the same column as the position's key
    isExternalFilterPresent: () => true,
    doesExternalFilterPass: node => node.data[POSITION_KEY] === selectedPosition,
    defaultColDef: {
      resizable: true
    },
    autoSizeStrategy: {
      type: 'fitGridWidth'
    }
  });
}
