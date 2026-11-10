import { createGrid, ModuleRegistry, AllCommunityModule, themeAlpine } from 'ag-grid-community';
import { subscribe } from './graphql.js';

ModuleRegistry.registerModules([AllCommunityModule]);

// Setup positions grid
const positionsColumnConfig = getPositionsColumnConfig();
const positionsFields = Object.keys(positionsColumnConfig);
const positionsGridApi = createPositionsGrid();

// Setup trades grid, for the selected position
const tradesColumnConfig = getTradesColumnConfig();
const tradesFields = Object.keys(tradesColumnConfig);
const tradesGridApi = createTradesGrid();
let tradesSubscription = null;

// Subscribe to positions
subscribe('live_pnl', positionsFields, (updates) => {
  applyUpdates(positionsGridApi, updates, 'instrument_id');
});

// Show the trades of the clicked position, through a filtered subscription
function selectPosition(position) {
  tradesSubscription?.unsubscribe();
  tradesGridApi.setGridOption('rowData', []);
  document.querySelector('#trades-title').textContent = `Trades: ${position.symbol}`;

  const where = { instrument_id: { _eq: position.instrument_id } };
  tradesSubscription = subscribe('trades', tradesFields, (updates) => {
    applyUpdates(tradesGridApi, updates, 'id');
  }, where);
}

// Applies one timestamp's updates to a grid as one transaction, so it never shows half a timestamp
function applyUpdates(gridApi, updates, idField) {
  const transaction = { add: [], update: [], remove: [] };
  for (const { operation, data: rowData, fields } of updates) {
    switch (operation) {
      case 'DELETE':
        transaction.remove.push(rowData);
        break;
      case 'UPDATE': {
        const updatedRow = mergeWithExistingRow(gridApi, rowData, fields, idField);
        if (updatedRow) {
          transaction.update.push(updatedRow);
        } else {
          console.warn(`UPDATE received for non-existent row with ${idField}=${rowData[idField]}`);
        }
        break;
      }
      case 'INSERT':
        transaction.add.push(rowData);
        break;
    }
  }
  gridApi.applyTransaction(transaction);
}


function mergeWithExistingRow(gridApi, deltaData, changedFields, idField) {
  const rowNode = gridApi.getRowNode(String(deltaData[idField]));
  if (!rowNode?.data) return null;

  // Start with existing row data
  const merged = { ...rowNode.data };

  // Apply only the changed fields
  if (changedFields && changedFields.length > 0) {
    changedFields.forEach(field => {
      if (field in deltaData) {
        merged[field] = deltaData[field];
      }
    });
  }

  return merged;
}

function getPositionsColumnConfig() {
  return {
    instrument_id: { hide: true },
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
    id: { hide: true },
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
    getRowId: params => String(params.data.instrument_id),
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
    getRowId: params => String(params.data.id),
    defaultColDef: {
      resizable: true
    },
    autoSizeStrategy: {
      type: 'fitGridWidth'
    }
  });
}
