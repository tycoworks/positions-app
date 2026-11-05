import { createGrid, ModuleRegistry, AllCommunityModule, themeAlpine } from 'ag-grid-community';
import { subscribe } from './sse.js';

ModuleRegistry.registerModules([AllCommunityModule]);

// Setup positions grid
const positionsColumnConfig = getPositionsColumnConfig();
const positionsFields = Object.keys(positionsColumnConfig);
const positionsGridApi = createPositionsGrid();

// Subscribe to positions
subscribe('/live_pnl', 'instrument_id', (operation, rowData, changedFields) => {
  handleGridUpdate(positionsGridApi, operation, rowData, changedFields, 'instrument_id');
});

function handleGridUpdate(gridApi, operation, rowData, changedFields, idField, addIndex) {
  switch (operation) {
    case 'DELETE':
      gridApi.applyTransaction({ remove: [rowData] });
      break;
    case 'UPDATE':
      const updatedRow = mergeWithExistingRow(gridApi, rowData, changedFields, idField);
      if (updatedRow) {
        gridApi.applyTransaction({ update: [updatedRow] });
      } else {
        console.warn(`UPDATE received for non-existent row with ${idField}=${rowData[idField]}`);
      }
      break;
    case 'INSERT':
      const options = addIndex !== undefined
        ? { add: [rowData], addIndex }
        : { add: [rowData] };
      gridApi.applyTransaction(options);
      break;
  }
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
    defaultColDef: {
      resizable: true
    },
    autoSizeStrategy: {
      type: 'fitGridWidth'
    }
  });
}
