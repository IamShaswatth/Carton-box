const { ipcRenderer } = require('electron');
const Chart = require('chart.js/auto');

// Tab switching logic
function openTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    document.getElementById(tabId).classList.add('active');

    // Find the button that calls this function and add active class (simple heuristic)
    // In a real app, bind this better.
    const buttons = document.querySelectorAll('.tab-btn');
    // Just resetting all for now, need strict matching

    if (tabId === 'stock-report') loadStockReport();
    if (tabId === 'sales-report') loadSalesReport();
    if (tabId === 'invoice') loadInvoiceHistory();
    if (tabId === 'chart-tab') loadSalesChart();
    if (tabId === 'board-entry') loadBoards();
    if (tabId === 'customer-request') loadCustomerRequests();
    if (tabId === 'stock-movement') loadStockMovements();
}

function showToast(message, isError = false) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.backgroundColor = isError ? '#ef4444' : '#22c55e';
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 2500); // 2.5s total life (matches CSS fadeOut delay+duration)
}

// Global state
let productionData = [];

// Event Delegation for Table Actions (Edit/Delete)
// Event Delegation for Table Actions (Edit/Delete)
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('edit-btn')) {
        const index = parseInt(e.target.getAttribute('data-index'));
        editEntryByIndex(index);
    }
    if (e.target.classList.contains('delete-btn')) {
        const id = parseInt(e.target.getAttribute('data-id'));
        deleteEntry(id);
    }
});

// ... existing code ...

async function loadInvoiceHistory() {
    const invoices = await ipcRenderer.invoke('get-sales-report'); // Re-using sales data as it has invoice info
    const list = document.getElementById('invoice-list');
    list.innerHTML = '<h3>Recent Invoices</h3>';

    if (invoices.length === 0) {
        list.innerHTML += '<p>No invoices found.</p>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Invoice No</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Action</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;

    invoices.forEach(inv => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${inv.invoice_no}</td>
            <td>${new Date(inv.date).toLocaleDateString()}</td>
            <td>${inv.customer_name}</td>
            <td>₹${(inv.rate_per_box * inv.quantity_sold * 1.05).toFixed(2)}</td>
            <td><button class="reprint-invoice-btn btn-primary" style="padding: 5px 10px; font-size: 12px;" data-invoice-no="${inv.invoice_no}">View/Print</button></td>
        `;
        table.querySelector('tbody').appendChild(tr);
    });

    list.appendChild(table);
}

// Event delegation for reprint invoice button
document.addEventListener('click', async (e) => {
    if (e.target.classList.contains('reprint-invoice-btn')) {
        const invoiceNo = e.target.getAttribute('data-invoice-no');
        await reprintInvoice(invoiceNo);
    }
});

async function reprintInvoice(invoiceNo) {
    const sales = await ipcRenderer.invoke('get-sales-report');
    const invoiceData = sales.find(s => s.invoice_no === invoiceNo);

    if (invoiceData) {
        generateInvoicePreview({
            date: new Date(invoiceData.date).toISOString().split('T')[0],
            customer: invoiceData.customer_name,
            poNo: invoiceData.customer_po_no,
            length: invoiceData.box_length,
            width: invoiceData.box_width,
            height: invoiceData.box_height,
            flute: invoiceData.flute_type,
            rate: invoiceData.rate_per_box,
            quantity: invoiceData.quantity_sold
        }, invoiceNo);
    } else {
        showToast('Invoice not found!', true);
    }
}


// Production Form
const prodForm = document.getElementById('production-form');
prodForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        date: document.getElementById('prod-date').value,
        orderNo: document.getElementById('prod-order-no').value,
        length: parseInt(document.getElementById('prod-length').value),
        width: parseInt(document.getElementById('prod-width').value),
        height: parseInt(document.getElementById('prod-height').value),
        flute: document.getElementById('prod-flute').value,
        quantity: parseInt(document.getElementById('prod-qty').value)
    };

    const btn = prodForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerText = 'Saving...';

    try {
        const result = await ipcRenderer.invoke('add-production', data);

        if (result.success) {
            showToast('Production Entry Saved!');
            prodForm.reset();
            // Small timeout to ensure DOM is ready for focus, solving unresponsiveness
            setTimeout(() => {
                document.getElementById('prod-date').focus();
            }, 100);
        } else {
            showToast('Error: ' + result.error, true);
        }
    } catch (err) {
        showToast('System Error: ' + err.message, true);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Save Entry';
    }
});

// Sales Form
const salesForm = document.getElementById('sales-form');
salesForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        date: document.getElementById('sales-date').value,
        customer: document.getElementById('sales-customer').value,
        poNo: document.getElementById('sales-po').value,
        length: parseInt(document.getElementById('sales-length').value),
        width: parseInt(document.getElementById('sales-width').value),
        height: parseInt(document.getElementById('sales-height').value),
        flute: document.getElementById('sales-flute').value,
        rate: parseFloat(document.getElementById('sales-rate').value),
        quantity: parseInt(document.getElementById('sales-qty').value)
    };

    const btn = salesForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerText = 'Processing...';

    try {
        const result = await ipcRenderer.invoke('add-sales', data);
        if (result.success) {
            showToast('Sales Entry Saved: ' + result.invoiceNo);
            salesForm.reset();
            // Ideally, show invoice preview immediately
            generateInvoicePreview(data, result.invoiceNo);
        } else {
            showToast('Error: ' + result.error, true);
        }
    } catch (err) {
        showToast('System Error: ' + err.message, true);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Save & Generate Invoice';
    }
});

// Reports
async function loadStockReport() {
    // Load current stock summary
    const stockSummary = await ipcRenderer.invoke('get-current-stock-summary');
    const summaryDiv = document.getElementById('stock-summary-content');
    
    if (stockSummary.length === 0) {
        summaryDiv.innerHTML = '<p style="color:#666;">No stock available</p>';
    } else {
        let summaryHTML = '<table class="data-table" style="background:white;">';
        summaryHTML += '<thead><tr><th>Size (LxWxH)</th><th>Flute</th><th>Available Qty</th></tr></thead><tbody>';
        stockSummary.forEach(stock => {
            summaryHTML += `<tr>
                <td><strong>${stock.box_length} x ${stock.box_width} x ${stock.box_height}</strong></td>
                <td>${stock.flute_type}</td>
                <td style="color:#16a34a; font-weight:600; font-size:16px;">${stock.stock_quantity}</td>
            </tr>`;
        });
        summaryHTML += '</tbody></table>';
        summaryDiv.innerHTML = summaryHTML;
    }
    
    // Load stock movement history
    const data = await ipcRenderer.invoke('get-stock-report');
    // Cache only production data for edit
    productionData = data.filter(row => row.type === 'STOCK IN');
    
    const tbody = document.getElementById('stock-table-body');
    tbody.innerHTML = '';
    
    data.forEach((row, index) => {
        const tr = document.createElement('tr');
        const isStockOut = row.type === 'STOCK OUT' || row.type === 'MANUAL OUT';
        const isManual = row.type.startsWith('MANUAL');
        const quantity = Math.abs(row.quantity);
        
        // Different styling for stock in vs out and manual
        let rowStyle = '';
        if (isManual && isStockOut) {
            rowStyle = 'background:#fef2f2;'; // Light red for manual OUT
        } else if (isManual) {
            rowStyle = 'background:#f0fdf4;'; // Light green for manual IN
        } else if (isStockOut) {
            rowStyle = 'background:#fee2e2;'; // Regular red for sales OUT
        }
        
        const typeColor = isStockOut ? 'color:#dc2626; font-weight:600;' : 'color:#16a34a; font-weight:600;';
        const quantityDisplay = isStockOut ? `-${quantity}` : `+${quantity}`;
        const quantityStyle = isStockOut ? 'color:#dc2626; font-weight:600;' : 'color:#16a34a; font-weight:600;';
        
        // Reference/Customer column - include username for manual movements
        let refColumn = row.reference || 'N/A';
        if (isManual && row.user_name) {
            refColumn = `${row.reference}<br><small style="color:#1e40af; font-weight:500;">By: ${row.user_name}</small>`;
        } else if (isStockOut && row.customer_name && !isManual) {
            refColumn = `<strong>${row.customer_name}</strong><br><small style="color:#666;">${row.reference}</small>`;
        }
        
        // Find index in productionData for edit button (only for regular STOCK IN)
        const prodIndex = (row.type === 'STOCK IN') ? productionData.findIndex(p => p.id === row.id) : -1;
        
        // Action column - different for manual movements vs regular
        let actionColumn;
        if (row.type === 'STOCK IN') {
            actionColumn = `
                <button class="edit-btn" data-index="${prodIndex}" style="padding:4px 8px; margin-right:5px; background:#fbbf24; border:none; border-radius:4px; cursor:pointer;">Edit</button>
                <button class="delete-btn" data-id="${row.id}" style="padding:4px 8px; background:#ef4444; color:white; border:none; border-radius:4px; cursor:pointer;">Del</button>
            `;
        } else if (isManual) {
            actionColumn = '<span style="color:#666; font-size:12px;">Manual</span>';
        } else {
            actionColumn = '<span style="color:#666; font-size:12px;">Delivered</span>';
        }
        
        // Format time from created_at timestamp
        let timeCell = '<span style="color:#999;">-</span>';
        if (row.created_at) {
            const createdDate = new Date(row.created_at);
            timeCell = '<strong>' + createdDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '</strong>';
        }
        
        tr.style.cssText = rowStyle;
        tr.innerHTML = `
            <td>${index + 1}</td>
            <td>${new Date(row.date).toLocaleDateString()}</td>
            <td style="font-size:12px; color:#6b7280;">${timeCell}</td>
            <td style="${typeColor}">${row.type}</td>
            <td>${row.box_length} x ${row.box_width} x ${row.box_height}</td>
            <td>${row.flute_type}</td>
            <td style="${quantityStyle}">${quantityDisplay}</td>
            <td style="font-size:13px;">${refColumn}</td>
            <td>${actionColumn}</td>
        `;
        tbody.appendChild(tr);
    });
}

async function deleteEntry(id) {
    const confirmed = await showConfirmModal('Are you sure you want to delete this entry? Stock will be reversed.');
    if (!confirmed) return;

    const result = await ipcRenderer.invoke('delete-production', id);
    if (result.success) {
        showToast('Entry Deleted');
        loadStockReport();
    } else {
        showToast('Error: ' + result.error, true);
    }
}

// Store current edit data references
let currentEditData = null;

function editEntryByIndex(index) {
    openEditModalByIndex(index);
}

// Helper to find data (since we don't have global state, let's just query row or fetch)
// Simplest for now: The row button click passed the ID. Let's assume we can't easily get the data without storing it.
// Let's modify loadStockReport to store data globally or fetch.
// BETTER: Just fetch the single row info via a new IPC or passing params?
// Let's cheat slightly and grab data from DOM? No, that's brittle.
// Let's make `loadStockReport` save to a global variable `productionData`

// let productionData = []; // Moved to top

async function openEditModalByIndex(index) {
    console.log('Opening edit modal for Index:', index);
    console.log('Current Data:', productionData);

    // Find item
    const item = productionData[index];

    if (!item) {
        console.error('Item not found for Index:', index);
        showToast('Error: Could not load entry details', true);
        return;
    }

    document.getElementById('edit-id').value = item.id;
    document.getElementById('edit-date').value = new Date(item.date).toISOString().split('T')[0];
    document.getElementById('edit-order-no').value = item.reference;
    document.getElementById('edit-length').value = item.box_length;
    document.getElementById('edit-width').value = item.box_width;
    document.getElementById('edit-height').value = item.box_height;
    document.getElementById('edit-flute').value = item.flute_type;
    document.getElementById('edit-qty').value = item.quantity;

    const modal = document.getElementById('edit-modal');
    modal.style.display = 'flex';
}

function closeEditModal() {
    document.getElementById('edit-modal').style.display = 'none';
}

// Edit Form Submit
document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = {
        id: parseInt(document.getElementById('edit-id').value),
        date: document.getElementById('edit-date').value,
        orderNo: document.getElementById('edit-order-no').value,
        length: parseInt(document.getElementById('edit-length').value),
        width: parseInt(document.getElementById('edit-width').value),
        height: parseInt(document.getElementById('edit-height').value),
        flute: document.getElementById('edit-flute').value,
        quantity: parseInt(document.getElementById('edit-qty').value),
    };

    const result = await ipcRenderer.invoke('update-production', data);

    if (result.success) {
        showToast('Entry Updated');
        closeEditModal();
        loadStockReport();
    } else {
        showToast('Update Failed: ' + result.error, true);
    }
});

async function loadSalesReport() {
    const data = await ipcRenderer.invoke('get-sales-report');
    const tbody = document.getElementById('sales-table-body');
    tbody.innerHTML = '';
    data.forEach(row => {
        const tr = document.createElement('tr');
        const total = row.rate_per_box * row.quantity_sold; // Rough calc for display
        tr.innerHTML = `
            <td>${new Date(row.date).toLocaleDateString()}</td>
            <td>${row.invoice_no}</td>
            <td>${row.customer_name}</td>
            <td>${row.box_length}x${row.box_width}x${row.box_height} (${row.flute_type})</td>
            <td>${row.quantity_sold}</td>
            <td>${row.rate_per_box}</td>
            <td>${total.toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
    });
}

let salesChartInstance = null;

async function loadSalesChart() {
    console.log("Loading Sales Chart...");
    try {
        const salesData = await ipcRenderer.invoke('get-monthly-sales');
        console.log("Sales Data Received:", salesData);

        if (!salesData || salesData.length === 0) {
            console.warn("No sales data available to chart.");
            showToast("No sales data found for chart", true);
            return;
        }

        const labels = salesData.map(d => d.month_label);
        const values = salesData.map(d => d.total_sales);
        const quantities = salesData.map(d => d.total_quantity);

        const ctx = document.getElementById('salesChart').getContext('2d');

        if (salesChartInstance) {
            salesChartInstance.destroy();
        }

        salesChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Total Revenue (₹)',
                        data: values,
                        backgroundColor: 'rgba(59, 130, 246, 0.7)',
                        borderColor: 'rgba(59, 130, 246, 1)',
                        borderWidth: 1,
                        yAxisID: 'y',
                        borderRadius: 5
                    },
                    {
                        label: 'Quantity Sold (Boxes)',
                        data: quantities,
                        type: 'line',
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        borderWidth: 2,
                        tension: 0.3,
                        yAxisID: 'y1',
                        pointRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Monthly Sales Performance',
                        font: { size: 18 }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                },
                scales: {
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: 'Revenue (₹)' },
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: { display: true, text: 'Quantity' },
                        grid: { drawOnChartArea: false } // only want the grid lines for one axis to show up
                    },
                    x: {
                        grid: { display: false }
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                }
            }
        });
        console.log("Chart rendered successfully.");
    } catch (error) {
        console.error("Error rendering chart:", error);
        showToast("Error loading chart: " + error.message, true);
    }
}

function generateInvoicePreview(data, invoiceNo) {
    // Ensure all numeric values are properly converted to numbers
    const rate = parseFloat(data.rate) || 0;
    const quantity = parseInt(data.quantity) || 0;
    const length = parseInt(data.length) || 0;
    const width = parseInt(data.width) || 0;
    const height = parseInt(data.height) || 0;
    
    const baseAmount = rate * quantity;
    const cgst = baseAmount * 0.025;
    const sgst = baseAmount * 0.025;
    const total = baseAmount + cgst + sgst;

    const html = `
        <div style="font-family: 'Courier New', Courier, monospace; line-height: 1.8; color: #000; max-width: 100%; box-sizing: border-box;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 2px solid #333;">
                <div style="flex: 1;">
                    <h4 style="margin: 0; color: #333; font-family: 'Courier New', Courier, monospace; font-size: 18px; font-weight: bold;">SP TEX</h4>
                    <p style="margin: 5px 0; font-size: 11px; line-height: 1.6;">
                    Carton Box Manufacturing<br>
                    Pathmavathipuram Gandhi Nagar, Tiruppur<br>
                    Tamil Nadu - 641603
                    </p>
                </div>
                <div style="text-align: right; flex: 1;">
                    <p style="margin: 3px 0;"><strong>Invoice No:</strong> ${invoiceNo}</p>
                    <p style="margin: 3px 0;"><strong>GSTIN:</strong>33JNJPS9834P1ZS<p>
                    <p style="margin: 3px 0;"><strong>Date:</strong> ${new Date(data.date).toLocaleDateString('en-IN')}</p>
                </div>
            </div>
            
            <div style="margin-bottom: 15px;">
                <p style="margin: 5px 0;"><strong>Bill To:</strong></p>
                <p style="margin: 5px 0; font-size: 13px;">${data.customer}</p>
                <p style="margin: 5px 0; font-size: 12px; color: #666;"><strong>PO No:</strong> ${data.poNo}</p>
            </div>
            
            <table style="width: 100%; border-collapse: collapse; margin: 15px 0; font-family: 'Courier New', Courier, monospace; table-layout: fixed; box-sizing: border-box;">
                <thead>
                    <tr style="background-color: #f0f0f0;">
                        <th style="border: 1px solid #333; padding: 8px; text-align: left; font-family: 'Courier New', Courier, monospace; width: 50%;">Description</th>
                        <th style="border: 1px solid #333; padding: 8px; text-align: center; font-family: 'Courier New', Courier, monospace; width: 15%;">Qty</th>
                        <th style="border: 1px solid #333; padding: 8px; text-align: right; font-family: 'Courier New', Courier, monospace; width: 17.5%;">Rate</th>
                        <th style="border: 1px solid #333; padding: 8px; text-align: right; font-family: 'Courier New', Courier, monospace; width: 17.5%;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="border: 1px solid #333; padding: 8px; word-wrap: break-word;">Carton Box<br><small style="color: #666;">Dimensions: ${length} x ${width} x ${height} mm (${data.flute})</small></td>
                        <td style="border: 1px solid #333; padding: 8px; text-align: center;">${quantity}</td>
                        <td style="border: 1px solid #333; padding: 8px; text-align: right;">₹${rate.toFixed(2)}</td>
                        <td style="border: 1px solid #333; padding: 8px; text-align: right;">₹${baseAmount.toFixed(2)}</td>
                    </tr>
                </tbody>
            </table>
            
            <div style="margin-top: 15px; text-align: right;">
                <table style="width: 280px; max-width: 100%; margin-left: auto; border-collapse: collapse; font-family: 'Courier New', Courier, monospace; box-sizing: border-box;">
                    <tr>
                        <td style="padding: 4px; text-align: left;">Subtotal:</td>
                        <td style="padding: 4px; text-align: right; font-weight: normal;">₹${baseAmount.toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td style="padding: 4px; text-align: left;">CGST (2.5%):</td>
                        <td style="padding: 4px; text-align: right;">₹${cgst.toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td style="padding: 4px; text-align: left;">SGST (2.5%):</td>
                        <td style="padding: 4px; text-align: right;">₹${sgst.toFixed(2)}</td>
                    </tr>
                    <tr style="border-top: 2px solid #333;">
                        <td style="padding: 8px 4px; text-align: left; font-weight: bold; font-size: 15px;">Grand Total:</td>
                        <td style="padding: 8px 4px; text-align: right; font-weight: bold; font-size: 15px;">₹${total.toFixed(2)}</td>
                    </tr>
                </table>
            </div>
            
            <div style="margin-top: 30px; padding-top: 15px; border-top: 1px solid #ccc; font-size: 11px; color: #666;">
                <p style="margin: 5px 0;"><strong>Terms & Conditions:</strong></p>
                <p style="margin: 5px 0;">Thank you for your business!</p>
            </div>
        </div>
    `;

    document.getElementById('print-area').innerHTML = html;
    document.getElementById('invoice-preview').style.display = 'block';
    openTab('invoice');
}

function printInvoice() {
    // Show toast to indicate print preview is opening
    showToast('Opening print preview...');
    
    // Small delay to ensure rendering is complete
    setTimeout(() => {
        window.print();
    }, 100);
}

function closePreview() {
    document.getElementById('invoice-preview').style.display = 'none';
}

// ==========================================
// Board Audit & Stock Management
// ==========================================

async function loadBoards() {
    const boards = await ipcRenderer.invoke('get-boards');
    const tbody = document.getElementById('board-list-body');
    tbody.innerHTML = '';

    boards.forEach(b => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${b.quality}</td>
            <td>${b.length} x ${b.width}</td>
            <td>${b.quantity}</td>
            <td><button style="padding:4px 8px; background:#ef4444; color:white; border:none; border-radius:4px; cursor:pointer;" onclick="deleteBoard(${b.board_id})">Delete</button></td>
        `;
        tbody.appendChild(tr);
    });
}

document.getElementById('board-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        quality: document.getElementById('board-quality').value,
        length: parseInt(document.getElementById('board-length').value),
        width: parseInt(document.getElementById('board-width').value),
        quantity: parseInt(document.getElementById('board-qty').value)
    };

    const result = await ipcRenderer.invoke('add-board', data);
    if (result.success) {
        showToast('Board Stock Added');
        document.getElementById('board-form').reset();
        loadBoards();
    } else {
        showToast('Error: ' + result.error, true);
    }
});

async function deleteBoard(id) {
    const confirmed = await showConfirmModal('Are you sure you want to delete this board stock?');
    if (!confirmed) return;
    const result = await ipcRenderer.invoke('delete-board', id);
    if (result.success) {
        showToast('Board Deleted');
        loadBoards();
    } else {
        showToast('Error: ' + result.error, true);
    }
}

// ==========================================
// Customer Request Management
// ==========================================

// Custom Confirm Modal
function showConfirmModal(message) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 10000;';
        
        const modalContent = document.createElement('div');
        modalContent.style.cssText = 'background: white; padding: 30px; border-radius: 8px; width: 400px; max-width: 90%;';
        
        modalContent.innerHTML = `
            <h3 style="margin-top: 0; color: #333;">Confirm Action</h3>
            <p style="color: #666; margin-bottom: 20px;">${message}</p>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="confirm-cancel-btn" style="padding: 10px 20px; background: #6b7280; color: white; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
                <button id="confirm-ok-btn" style="padding: 10px 20px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer;">Confirm</button>
            </div>
        `;
        
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        
        document.getElementById('confirm-ok-btn').onclick = () => {
            document.body.removeChild(modal);
            resolve(true);
        };
        
        document.getElementById('confirm-cancel-btn').onclick = () => {
            document.body.removeChild(modal);
            resolve(false);
        };
        
        modal.onkeydown = (e) => {
            if (e.key === 'Escape') {
                document.body.removeChild(modal);
                resolve(false);
            }
        };
    });
}

// Custom PO Number Modal
function showPONumberModal() {
    return new Promise((resolve) => {
        // Create modal
        const modal = document.createElement('div');
        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 10000;';
        
        const modalContent = document.createElement('div');
        modalContent.style.cssText = 'background: white; padding: 30px; border-radius: 8px; width: 400px; max-width: 90%;';
        
        modalContent.innerHTML = `
            <h3 style="margin-top: 0; color: #333;">Process Delivery</h3>
            <p style="color: #666; margin-bottom: 20px;">Enter PO Number to proceed with delivery</p>
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; color: #333; font-weight: 500;">PO Number (Optional)</label>
                <input type="text" id="po-number-input" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;" placeholder="Enter PO Number or leave blank">
            </div>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="po-cancel-btn" style="padding: 10px 20px; background: #6b7280; color: white; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
                <button id="po-confirm-btn" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;">Process Delivery</button>
            </div>
        `;
        
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        
        const input = document.getElementById('po-number-input');
        input.focus();
        
        // Handle confirm
        document.getElementById('po-confirm-btn').onclick = () => {
            const value = input.value.trim();
            document.body.removeChild(modal);
            resolve(value || 'N/A');
        };
        
        // Handle cancel
        document.getElementById('po-cancel-btn').onclick = () => {
            document.body.removeChild(modal);
            resolve(null);
        };
        
        // Handle Enter key
        input.onkeypress = (e) => {
            if (e.key === 'Enter') {
                const value = input.value.trim();
                document.body.removeChild(modal);
                resolve(value || 'N/A');
            }
        };
        
        // Handle Escape key
        modal.onkeydown = (e) => {
            if (e.key === 'Escape') {
                document.body.removeChild(modal);
                resolve(null);
            }
        };
    });
}

// Customer Request Form
const customerRequestForm = document.getElementById('customer-request-form');
customerRequestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        date: document.getElementById('cr-date').value,
        customerName: document.getElementById('cr-customer').value,
        length: parseInt(document.getElementById('cr-length').value),
        width: parseInt(document.getElementById('cr-width').value),
        height: parseInt(document.getElementById('cr-height').value),
        flute: document.getElementById('cr-flute').value,
        quantity: parseInt(document.getElementById('cr-quantity').value),
        rate: parseFloat(document.getElementById('cr-rate').value)
    };

    const btn = customerRequestForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerText = 'Saving...';

    try {
        const result = await ipcRenderer.invoke('add-customer-request', data);
        if (result.success) {
            showToast('Customer Request Saved!');
            customerRequestForm.reset();
            loadCustomerRequests();
            setTimeout(() => {
                document.getElementById('cr-date').focus();
            }, 100);
        } else {
            showToast('Error: ' + result.error, true);
        }
    } catch (err) {
        showToast('System Error: ' + err.message, true);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Save Customer Request';
    }
});

async function loadCustomerRequests() {
    const requests = await ipcRenderer.invoke('get-customer-requests');
    const tbody = document.getElementById('customer-request-table-body');
    tbody.innerHTML = '';

    if (requests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No pending customer requests</td></tr>';
        return;
    }

    requests.forEach(req => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${new Date(req.created_date).toLocaleDateString()}</td>
            <td>${req.customer_name}</td>
            <td>${req.box_length} x ${req.box_width} x ${req.box_height}</td>
            <td>${req.flute_type}</td>
            <td>${req.quantity}</td>
            <td>₹${req.rate_per_box}</td>
            <td>
                <button class="deliver-btn btn-primary" style="padding: 5px 10px; font-size: 12px; margin-right: 5px;" data-request-id="${req.request_id}">Deliver</button>
                <button class="delete-request-btn" style="padding: 5px 10px; font-size: 12px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer;" data-request-id="${req.request_id}">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Event delegation for deliver and delete buttons
document.addEventListener('click', async (e) => {
    try {
        console.log('Click event detected on:', e.target, 'classes:', e.target.className);
        
        if (e.target.classList.contains('deliver-btn')) {
            console.log('Deliver button clicked!');
            const requestId = parseInt(e.target.getAttribute('data-request-id'));
            console.log('Extracted requestId:', requestId);
            await deliverCustomerRequest(requestId);
        }
        if (e.target.classList.contains('delete-request-btn')) {
            console.log('Delete button clicked!');
            const requestId = parseInt(e.target.getAttribute('data-request-id'));
            await deleteCustomerRequestEntry(requestId);
        }
    } catch (error) {
        console.error('Error in event delegation:', error);
        showToast('Event handler error: ' + error.message, true);
    }
});

async function deliverCustomerRequest(requestId) {
    console.log('=== deliverCustomerRequest frontend called ===');
    console.log('requestId:', requestId, 'type:', typeof requestId);
    
    // Get PO number via custom modal
    const poNo = await showPONumberModal();
    if (poNo === null) {
        console.log('User cancelled delivery');
        return;
    }

    const deliveryDate = new Date().toISOString().split('T')[0];

    const deliveryData = {
        date: deliveryDate,
        poNo: poNo || 'N/A'
    };

    console.log('Calling IPC with:', { requestId, deliveryData });

    try {
        const result = await ipcRenderer.invoke('deliver-customer-request', { requestId, deliveryData });
        console.log('IPC result received:', result);
        
        if (result.success) {
            showToast('Delivery processed! Invoice: ' + result.invoiceNo);
            loadCustomerRequests();
            loadStockReport(); // Refresh stock report to show STOCK OUT movement
            
            // Get the request details to show invoice
            const requests = await ipcRenderer.invoke('get-all-customer-requests');
            const request = requests.find(r => r.request_id === requestId);
            
            if (request) {
                generateInvoicePreview({
                    date: deliveryDate,
                    customer: request.customer_name,
                    poNo: poNo,
                    length: request.box_length,
                    width: request.box_width,
                    height: request.box_height,
                    flute: request.flute_type,
                    rate: request.rate_per_box,
                    quantity: request.quantity
                }, result.invoiceNo);
            }
        } else {
            showToast('Delivery failed: ' + (result.error || 'Unknown error'), true);
        }
    } catch (err) {
        console.error('Error delivering customer request:', err);
        showToast('System Error: ' + err.message, true);
    }
}

async function deleteCustomerRequestEntry(id) {
    const confirmed = await showConfirmModal('Are you sure you want to delete this customer request?');
    if (!confirmed) return;
    
    const result = await ipcRenderer.invoke('delete-customer-request', id);
    if (result.success) {
        showToast('Customer Request Deleted');
        loadCustomerRequests();
    } else {
        showToast('Error: ' + result.error, true);
    }
}


// ==========================================
// Stock Movement Management
// ==========================================

// Stock Movement Form
const stockMovementForm = document.getElementById('stock-movement-form');
stockMovementForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        date: document.getElementById('sm-date').value,
        userName: document.getElementById('sm-username').value.trim(),
        movementType: document.getElementById('sm-movement-type').value,
        length: parseInt(document.getElementById('sm-length').value),
        width: parseInt(document.getElementById('sm-width').value),
        height: parseInt(document.getElementById('sm-height').value),
        flute: document.getElementById('sm-flute').value,
        quantity: parseInt(document.getElementById('sm-quantity').value),
        reason: document.getElementById('sm-reason').value.trim()
    };

    if (!data.userName) {
        showToast('Please enter your name', true);
        return;
    }

    if (!data.reason) {
        showToast('Please enter a reason for this movement', true);
        return;
    }

    const btn = stockMovementForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerText = 'Processing...';

    try {
        const result = await ipcRenderer.invoke('add-stock-movement', data);
        if (result.success) {
            showToast('Stock Movement Recorded!');
            stockMovementForm.reset();
            loadStockMovements();
            loadStockReport(); // Refresh stock report to update current stock
            setTimeout(() => {
                document.getElementById('sm-date').focus();
            }, 100);
        } else {
            showToast('Error: ' + result.error, true);
        }
    } catch (err) {
        showToast('System Error: ' + err.message, true);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Record Movement';
    }
});

async function loadStockMovements() {
    // Set today's date as default
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('sm-date').value = today;
    
    const movements = await ipcRenderer.invoke('get-stock-movements');
    console.log('=== Stock Movements Received (Latest First) ===');
    console.log('Total movements:', movements.length);
    
    // Log all movements to verify order
    movements.forEach((mov, idx) => {
        const time = new Date(mov.created_at).toLocaleTimeString('en-IN');
        console.log(`#${idx + 1}: [${time}] ${mov.movement_type} - ${mov.reason} (ID: ${mov.movement_id})`);
    });
    
    const tbody = document.getElementById('stock-movement-table-body');
    tbody.innerHTML = '';

    if (movements.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;">No stock movements recorded</td></tr>';
        return;
    }

    movements.forEach((mov, index) => {
        const tr = document.createElement('tr');
        const isOut = mov.movement_type === 'OUT';
        const rowStyle = isOut ? 'background:#fee2e2;' : 'background:#dcfce7;';
        const typeColor = isOut ? 'color:#dc2626; font-weight:600;' : 'color:#16a34a; font-weight:600;';
        const quantityDisplay = isOut ? `-${mov.quantity}` : `+${mov.quantity}`;
        const quantityStyle = isOut ? 'color:#dc2626; font-weight:600;' : 'color:#16a34a; font-weight:600;';
        
        // Format time from created_at timestamp
        const createdDate = new Date(mov.created_at);
        const timeStr = createdDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        tr.style.cssText = rowStyle;
        tr.innerHTML = `
            <td><strong>${index + 1}</strong></td>
            <td>${new Date(mov.date).toLocaleDateString()}</td>
            <td style="font-size:12px; color:#6b7280;"><strong>${timeStr}</strong></td>
            <td style="${typeColor}">${mov.movement_type}</td>
            <td>${mov.box_length} x ${mov.box_width} x ${mov.box_height}</td>
            <td>${mov.flute_type}</td>
            <td style="${quantityStyle}">${quantityDisplay}</td>
            <td style="font-size:13px;">${mov.reason}</td>
            <td style="font-weight:500; color:#4b5563;">${mov.user_name}</td>
            <td>
                <button class="delete-movement-btn" data-movement-id="${mov.movement_id}" style="padding:4px 8px; background:#ef4444; color:white; border:none; border-radius:4px; cursor:pointer;">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Event delegation for delete movement button
document.addEventListener('click', async (e) => {
    if (e.target.classList.contains('delete-movement-btn')) {
        const movementId = parseInt(e.target.getAttribute('data-movement-id'));
        await deleteStockMovement(movementId);
    }
});

async function deleteStockMovement(id) {
    const confirmed = await showConfirmModal('Are you sure you want to delete this stock movement? Stock will be reversed.');
    if (!confirmed) return;

    const result = await ipcRenderer.invoke('delete-stock-movement', id);
    if (result.success) {
        showToast('Stock Movement Deleted');
        loadStockMovements();
        loadStockReport(); // Refresh stock report to update current stock
    } else {
        showToast('Error: ' + result.error, true);
    }
}


// ==========================================
// Order Automation & Optimization
// ==========================================

let customerCounter = 0;

function addCustomerRow() {
    customerCounter++;
    const container = document.getElementById('automation-forms-container');
    const div = document.createElement('div');
    div.className = 'customer-order-row';
    div.style.border = "1px solid #ddd";
    div.style.padding = "10px";
    div.style.marginBottom = "10px";
    div.style.borderRadius = "5px";
    div.style.backgroundColor = "#f9fafb";
    div.id = `cust-row-${customerCounter}`;

    div.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
            <h4 style="margin:0;">Customer #${customerCounter}</h4>
            <button onclick="removeCustomerRow(${customerCounter})" style="color:red; background:none; border:none; cursor:pointer;">Remove</button>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <div class="form-group" style="flex:2;">
                <label>Name</label>
                <input type="text" class="c-name" placeholder="Customer Name" style="width:100%; padding:6px;">
            </div>
            <div class="form-group" style="flex:1;">
                <label>Quality</label>
                <select class="c-quality" style="width:100%; padding:6px;">
                    <option value="S">S</option>
                    <option value="N">N</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                    <option value="E">E</option>
                    <option value="BC">BC</option>
                    <option value="CB">CB</option>
                </select>
            </div>
            <div class="form-group" style="flex:1;">
                <label>L (mm)</label>
                <input type="number" class="c-len" style="width:100%; padding:6px;">
            </div>
            <div class="form-group" style="flex:1;">
                <label>W (mm)</label>
                <input type="number" class="c-wid" style="width:100%; padding:6px;">
            </div>
            <div class="form-group" style="flex:1;">
                <label>H (mm)</label>
                <input type="number" class="c-hei" style="width:100%; padding:6px;">
            </div>
            <div class="form-group" style="flex:1;">
                <label>Qty</label>
                <input type="number" class="c-qty" style="width:100%; padding:6px;">
            </div>
        </div>
    `;
    container.appendChild(div);
}

function removeCustomerRow(id) {
    document.getElementById(`cust-row-${id}`).remove();
}

async function calculateOptimization() {
    // Gather data
    const rows = document.querySelectorAll('.customer-order-row');
    const customers = [];

    rows.forEach(row => {
        const name = row.querySelector('.c-name').value.trim();
        customers.push({
            name: name || 'Customer',
            quality: row.querySelector('.c-quality').value,
            length: parseInt(row.querySelector('.c-len').value) || 0,
            width: parseInt(row.querySelector('.c-wid').value) || 0,
            height: parseInt(row.querySelector('.c-hei').value) || 0,
            quantity: parseInt(row.querySelector('.c-qty').value) || 0
        });
    });

    if (customers.length === 0) {
        showToast("Please add at least one customer order", true);
        return;
    }

    // Call Backend
    const btn = document.querySelector('#order-automation .btn-primary');
    btn.disabled = true;
    btn.innerText = "Optimizing...";

    try {
        const result = await ipcRenderer.invoke('calculate-optimization', { customers });
        if (result.success) {
            renderOptimizationResults(result.result);
        } else {
            showToast("Optimization failed: " + result.error, true);
        }
    } catch (e) {
        showToast("System error: " + e.message, true);
    } finally {
        btn.disabled = false;
        btn.innerText = "Calculate Best Fit";
    }
}

function renderOptimizationResults(results) {
    const container = document.getElementById('results-content');
    container.innerHTML = '';
    document.getElementById('optimization-results').style.display = 'block';

    if (results.length === 0) {
        container.innerHTML = '<p>No boards found or no orders match available board qualities.</p>';
        return;
    }

    results.forEach(group => {
        const groupDiv = document.createElement('div');
        groupDiv.style.marginBottom = '20px';
        groupDiv.style.padding = '10px';
        groupDiv.style.border = '1px solid #ccc';
        groupDiv.style.background = '#f0fdf4';

        let html = `<h4>Quality Group: ${group.quality} (Total Sheets Required: ${group.totalSheets})</h4>`;

        // Unproduced
        if (group.unproduced.length > 0) {
            html += `<div style="color:#dc2626; margin-bottom:15px; padding:12px; background:#fee2e2; border-left:4px solid #dc2626; border-radius:4px;">
                <strong>⚠ Could not produce:</strong> ${group.unproduced.length} sheets (No suitable board found or insufficient stock)
            </div>`;

            // Show board recommendation if available
            if (group.recommendation) {
                const rec = group.recommendation;
                html += `<div style="margin-bottom:20px;">
                    <h4 style="margin:0 0 12px 0; color:#ea580c; font-size:16px;">📋 Recommended Raw Board Production:</h4>
                    <table class="data-table" style="background:#fffbeb;">
                        <thead>
                            <tr style="background:#fef3c7;">
                                <th>Quality</th>
                                <th>Length (mm)</th>
                                <th>Width (mm)</th>
                                <th>Quantity</th>
                                <th>Expected Utilization</th>
                                <th>Will Produce Sheets</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style="font-weight:600;">${rec.quality}</td>
                                <td><strong>${rec.length}</strong></td>
                                <td><strong>${rec.width}</strong></td>
                                <td style="font-weight:600; color:#dc2626;">${rec.quantity} board(s)</td>
                                <td style="font-weight:600; color:#16a34a; font-size:15px;">${rec.expectedUtilization}%</td>
                                <td>${rec.sheetsCount}</td>
                            </tr>
                        </tbody>
                    </table>
                    <p style="margin:8px 0 0 0; font-size:13px; color:#92400e; font-style:italic;">
                        💡 Produce ${rec.quantity} board(s) of ${rec.length}×${rec.width}mm (Quality: ${rec.quality}) to complete all orders with ${rec.expectedUtilization}% efficiency
                    </p>
                </div>`;
            }
        }

        // Produced
        if (group.produced.length > 0) {
            const totalProduced = group.produced.reduce((sum, p) => sum + p.sheetCount, 0);
            html += `<div style="margin-bottom:10px; padding:8px; background:#e0f2fe; border-radius:4px;">
                <strong>✓ Successfully planned:</strong> ${totalProduced} sheets on ${group.produced.length} board(s)
            </div>`;
            
            html += `<table class="data-table">
                <thead>
                    <tr>
                        <th>Board #</th>
                        <th>Board Size (mm)</th>
                        <th>Utilization</th>
                        <th>Sheets Cut</th>
                        <th>Leftover/Waste</th>
                        <th>Cut Details</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>`;

            group.produced.forEach((p, index) => {
                // Summarize cuts
                // e.g. "Customer A (120x30): 5 pcs" from this board? 
                // Our optimizer returns individual cuts. Let's aggregate for display.
                const cutSummary = {};
                p.cuts.forEach(c => {
                    const customerName = c.customer || 'No Name';
                    const key = `${customerName} (${c.sheetL}x${c.sheetW})`;
                    cutSummary[key] = (cutSummary[key] || 0) + 1;
                });

                const cutStr = Object.entries(cutSummary).map(([k, v]) => `${k}: ${v}`).join('<br>');

                // Calculate leftover
                const boardArea = p.boardLength * p.boardWidth;
                const usedArea = (parseFloat(p.utilization) / 100) * boardArea;
                const leftoverArea = boardArea - usedArea;
                const leftoverPercent = (100 - parseFloat(p.utilization)).toFixed(2);

                // Format leftover pieces info
                let leftoverInfo = `<span style="color:#dc2626; font-weight:600;">${leftoverPercent}%</span><br>
                    <small style="color:#666;">(${Math.round(leftoverArea).toLocaleString()} mm²)</small>`;
                
                if (p.leftoverPieces && p.leftoverPieces.length > 0) {
                    leftoverInfo += '<br><small style="color:#2563eb; font-weight:500;">Usable pieces:</small>';
                    p.leftoverPieces.forEach((piece, idx) => {
                        leftoverInfo += `<br><small style="color:#059669;">${piece.length}×${piece.width}mm</small>`;
                    });
                }

                html += `<tr>
                    <td><strong>#${index + 1}</strong></td>
                    <td>${p.boardSize}</td>
                    <td><strong>${p.utilization}%</strong></td>
                    <td>${p.sheetCount}</td>
                    <td>${leftoverInfo}</td>
                    <td style="font-size:12px;">${cutStr}</td>
                    <td>
                        <button class="btn-primary reduce-stock-btn" 
                            data-quality="${group.quality}" 
                            data-length="${p.boardLength}" 
                            data-width="${p.boardWidth}"
                            data-cuts='${JSON.stringify(p.cuts)}'
                            style="padding:6px 12px; font-size:12px; margin-bottom:4px; display:block; width:100%;">
                            Update Stock
                        </button>
                        ${p.leftoverPieces && p.leftoverPieces.length > 0 ? `
                        <button class="btn-secondary save-leftover-btn" 
                            data-quality="${group.quality}" 
                            data-leftovers='${JSON.stringify(p.leftoverPieces)}'
                            style="padding:6px 12px; font-size:12px; display:block; width:100%;">
                            Save Leftover
                        </button>` : ''}
                    </td>
                </tr>`;
            });

            html += `</tbody></table>`;
        }

        groupDiv.innerHTML = html;
        container.appendChild(groupDiv);
    });
}

// Handle reduce stock button clicks (event delegation)
document.addEventListener('click', async (e) => {
    if (e.target.classList.contains('reduce-stock-btn')) {
        const quality = e.target.getAttribute('data-quality');
        const length = parseInt(e.target.getAttribute('data-length'));
        const width = parseInt(e.target.getAttribute('data-width'));
        const cuts = JSON.parse(e.target.getAttribute('data-cuts'));

        // Summarize cuts to show user what will be added to stock
        const boxSummary = {};
        cuts.forEach(c => {
            const key = `${c.boxL}×${c.boxW}×${c.boxH}mm (${quality})`;
            boxSummary[key] = (boxSummary[key] || 0) + 1;
        });
        
        const summaryText = Object.entries(boxSummary)
            .map(([size, qty]) => `  • ${qty}x boxes of ${size}`)
            .join('\n');

        const confirmed = await showConfirmModal(
            `Update stock?\n\nThis will:\n1. Reduce 1 raw board (${length}x${width}mm, Quality: ${quality})\n2. Add finished boxes to stock:\n${summaryText}`
        );
        if (!confirmed) return;

        // Disable button and show loading
        e.target.disabled = true;
        e.target.textContent = 'Updating...';

        try {
            const result = await ipcRenderer.invoke('update-stock-from-optimization', {
                board: { quality, length, width },
                cuts: cuts
            });

            if (result.success) {
                showToast(`Stock updated! Board reduced, ${cuts.length} boxes added to inventory`);
                // Change button to show it's done
                e.target.textContent = '✓ Updated';
                e.target.style.backgroundColor = '#16a34a';
                setTimeout(() => {
                    e.target.disabled = true;
                }, 500);
            } else {
                showToast('Error: ' + result.error, true);
                e.target.disabled = false;
                e.target.textContent = 'Update Stock';
            }
        } catch (err) {
            showToast('System error: ' + err.message, true);
            e.target.disabled = false;
            e.target.textContent = 'Update Stock';
        }
    }

    // Handle save leftover button
    if (e.target.classList.contains('save-leftover-btn')) {
        const quality = e.target.getAttribute('data-quality');
        const leftovers = JSON.parse(e.target.getAttribute('data-leftovers'));

        if (leftovers.length === 0) {
            showToast('No usable leftover pieces found', true);
            return;
        }

        // Show selection if multiple pieces
        let selectedPiece = leftovers[0];
        if (leftovers.length > 1) {
            const options = leftovers.map((p, idx) => 
                `${idx + 1}. ${p.length}×${p.width}mm (${Math.round(p.area).toLocaleString()} mm²)`
            ).join('\n');
            
            const choice = prompt(`Select leftover piece to save:\n\n${options}\n\nEnter number (1-${leftovers.length}):`);
            const index = parseInt(choice) - 1;
            
            if (isNaN(index) || index < 0 || index >= leftovers.length) {
                showToast('Invalid selection', true);
                return;
            }
            
            selectedPiece = leftovers[index];
        }

        const confirmed = await showConfirmModal(
            `Add leftover piece to stock?\n\nQuality: ${quality}\nSize: ${selectedPiece.length}×${selectedPiece.width}mm\nQuantity: 1 board`
        );
        
        if (!confirmed) return;

        // Disable button
        e.target.disabled = true;
        e.target.textContent = 'Saving...';

        try {
            const result = await ipcRenderer.invoke('add-board', {
                quality: quality,
                length: selectedPiece.length,
                width: selectedPiece.width,
                quantity: 1
            });

            if (result.success) {
                showToast(`Leftover piece saved to stock! (${selectedPiece.length}×${selectedPiece.width}mm)`);
                e.target.textContent = '✓ Saved';
                e.target.style.backgroundColor = '#16a34a';
                setTimeout(() => {
                    e.target.disabled = true;
                }, 500);
            } else {
                showToast('Error: ' + result.error, true);
                e.target.disabled = false;
                e.target.textContent = 'Save Leftover';
            }
        } catch (err) {
            showToast('System error: ' + err.message, true);
            e.target.disabled = false;
            e.target.textContent = 'Save Leftover';
        }
    }
});

// Initial Init
// Add one customer row by default
addCustomerRow();
