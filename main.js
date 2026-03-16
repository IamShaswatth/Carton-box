const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const db = require('./database');

async function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false // For simple prototype/offline app
        }
    });

    try {
        await db.initDB();
        console.log("Database initialized");
    } catch (e) {
        console.error("DB init failed", e);
    }

    mainWindow.loadFile('index.html');
    
    // Open DevTools for debugging
    mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.handle('add-production', async (event, data) => {
    try {
        return await db.addProduction(data);
    } catch (e) {
        console.error(e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('add-sales', async (event, data) => {
    try {
        return await db.addSales(data);
    } catch (e) {
        console.error(e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-stock-report', async (event, filters) => {
    return await db.getStockReport(filters);
});

ipcMain.handle('get-current-stock-summary', async (event) => {
    return await db.getCurrentStockSummary();
});

ipcMain.handle('get-sales-report', async (event, filters) => {
    return await db.getReportData('sales', filters);
});

ipcMain.handle('delete-production', async (event, id) => {
    try {
        return await db.deleteProduction(id);
    } catch (e) {
        console.error(e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('update-production', async (event, data) => {
    try {
        return await db.updateProduction(data);
    } catch (e) {
        console.error(e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-monthly-sales', async (event) => {
    try {
        return await db.getMonthlySales();
    } catch (e) {
        console.error(e);
        return [];
    }
});

// Board IPC Handlers
ipcMain.handle('add-board', async (event, data) => {
    return await db.addBoard(data);
});

ipcMain.handle('get-boards', async (event) => {
    return await db.getBoards();
});

ipcMain.handle('delete-board', async (event, id) => {
    try {
        return await db.deleteBoard(id);
    } catch (e) {
        console.error(e);
        return { success: false, error: e.message };
    }
});

// Customer Request IPC Handlers
ipcMain.handle('add-customer-request', async (event, data) => {
    try {
        return await db.addCustomerRequest(data);
    } catch (e) {
        console.error(e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-customer-requests', async (event) => {
    try {
        return await db.getCustomerRequests();
    } catch (e) {
        console.error(e);
        return [];
    }
});

ipcMain.handle('get-all-customer-requests', async (event) => {
    try {
        return await db.getAllCustomerRequests();
    } catch (e) {
        console.error(e);
        return [];
    }
});

ipcMain.handle('deliver-customer-request', async (event, data) => {
    console.log('=== IPC deliver-customer-request called ===');
    console.log('Received data:', JSON.stringify(data));
    try {
        const result = await db.deliverCustomerRequest(data.requestId, data.deliveryData);
        console.log('Database result:', result);
        return result;
    } catch (e) {
        console.error('Error in deliver-customer-request handler:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('delete-customer-request', async (event, id) => {
    try {
        return await db.deleteCustomerRequest(id);
    } catch (e) {
        console.error(e);
        return { success: false, error: e.message };
    }
});

// Stock Movement IPC Handlers
ipcMain.handle('add-stock-movement', async (event, data) => {
    try {
        return await db.addStockMovement(data);
    } catch (e) {
        console.error(e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-stock-movements', async (event) => {
    try {
        return await db.getStockMovements();
    } catch (e) {
        console.error(e);
        return [];
    }
});

ipcMain.handle('delete-stock-movement', async (event, id) => {
    try {
        return await db.deleteStockMovement(id);
    } catch (e) {
        console.error(e);
        return { success: false, error: e.message };
    }
});

// Optimization IPC Handler
const optimizer = require('./optimizer');
ipcMain.handle('calculate-optimization', async (event, data) => {
    try {
        // data = { customers: [{ name, quality, length, width, height, quantity }, ... ] }
        // 1. Get current board stock
        const boards = await db.getBoards();

        // 2. Run optimization
        const result = optimizer.calculateOptimization(data.customers, boards);
        return { success: true, result };
    } catch (e) {
        console.error(e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('reduce-board-stock', async (event, data) => {
    try {
        const result = await db.reduceBoardStock(data.quality, data.length, data.width, data.quantity);
        return result;
    } catch (e) {
        console.error(e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('update-stock-from-optimization', async (event, data) => {
    try {
        const result = await db.updateStockFromOptimization(data.board, data.cuts);
        return result;
    } catch (e) {
        console.error(e);
        return { success: false, error: e.message };
    }
});
