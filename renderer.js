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
    const data = await ipcRenderer.invoke('get-stock-report');
    productionData = data; // Cache for edit
    const tbody = document.getElementById('stock-table-body');
    tbody.innerHTML = '';
    data.forEach((row, index) => {
        // Ensure ID is number
        row.production_id = parseInt(row.production_id);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${index + 1}</td>
            <td>${new Date(row.date).toLocaleDateString()}</td>
            <td>${row.box_length} x ${row.box_width} x ${row.box_height}</td>
            <td>${row.flute_type}</td>
            <td>${row.quantity_produced}</td>
            <td>${row.quantity_produced}</td>
            <td>
                <button class="edit-btn" data-index="${index}" style="padding:4px 8px; margin-right:5px; background:#fbbf24; border:none; border-radius:4px; cursor:pointer;">Edit</button>
                <button class="delete-btn" data-id="${row.production_id}" style="padding:4px 8px; background:#ef4444; color:white; border:none; border-radius:4px; cursor:pointer;">Del</button>
            </td>
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

    document.getElementById('edit-id').value = item.production_id;
    document.getElementById('edit-date').value = new Date(item.date).toISOString().split('T')[0];
    document.getElementById('edit-order-no').value = item.board_or_production_order_no;
    document.getElementById('edit-length').value = item.box_length;
    document.getElementById('edit-width').value = item.box_width;
    document.getElementById('edit-height').value = item.box_height;
    document.getElementById('edit-flute').value = item.flute_type;
    document.getElementById('edit-qty').value = item.quantity_produced;

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
        <div style="font-family: 'Courier New', Courier, monospace; line-height: 1.8; color: #000;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #333;">
                <div>
                    <h4 style="margin: 0; color: #333; font-family: 'Courier New', Courier, monospace; font-size: 18px; font-weight: bold;">SP TEX</h4>
                    <p style="margin: 5px 0; font-size: 12px; line-height: 1.6;">
                    Carton Box Manufacturing<br>
                    Pathmavathipuram Gandhi Nagar, Tiruppur<br>
                    Tamil Nadu - 641603
                    </p>
                </div>
                <div style="text-align: right;">
                    <p style="margin: 5px 0;"><strong>Invoice No:</strong> ${invoiceNo}</p>
                    <p style="margin: 5px 0;"><strong>Date:</strong> ${new Date(data.date).toLocaleDateString('en-IN')}</p>
                </div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <p style="margin: 5px 0;"><strong>Bill To:</strong></p>
                <p style="margin: 5px 0; font-size: 14px;">${data.customer}</p>
                <p style="margin: 5px 0; font-size: 13px; color: #666;"><strong>PO No:</strong> ${data.poNo}</p>
            </div>
            
            <table style="width:100%; border-collapse: collapse; margin: 20px 0; font-family: 'Courier New', Courier, monospace;">
                <thead>
                    <tr style="background-color: #f0f0f0;">
                        <th style="border: 1px solid #333; padding: 10px; text-align: left; font-family: 'Courier New', Courier, monospace;">Description</th>
                        <th style="border: 1px solid #333; padding: 10px; text-align: center; width: 80px; font-family: 'Courier New', Courier, monospace;">Qty</th>
                        <th style="border: 1px solid #333; padding: 10px; text-align: right; width: 100px; font-family: 'Courier New', Courier, monospace;">Rate</th>
                        <th style="border: 1px solid #333; padding: 10px; text-align: right; width: 120px; font-family: 'Courier New', Courier, monospace;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="border: 1px solid #333; padding: 10px;">Carton Box<br><small style="color: #666;">Dimensions: ${length} x ${width} x ${height} mm (${data.flute})</small></td>
                        <td style="border: 1px solid #333; padding: 10px; text-align: center;">${quantity}</td>
                        <td style="border: 1px solid #333; padding: 10px; text-align: right;">₹${rate.toFixed(2)}</td>
                        <td style="border: 1px solid #333; padding: 10px; text-align: right;">₹${baseAmount.toFixed(2)}</td>
                    </tr>
                </tbody>
            </table>
            
            <div style="margin-top: 20px; text-align: right;">
                <table style="width: 300px; margin-left: auto; border-collapse: collapse; font-family: 'Courier New', Courier, monospace;">
                    <tr>
                        <td style="padding: 5px; text-align: left;">Subtotal:</td>
                        <td style="padding: 5px; text-align: right; font-weight: normal;">₹${baseAmount.toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td style="padding: 5px; text-align: left;">CGST (2.5%):</td>
                        <td style="padding: 5px; text-align: right;">₹${cgst.toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td style="padding: 5px; text-align: left;">SGST (2.5%):</td>
                        <td style="padding: 5px; text-align: right;">₹${sgst.toFixed(2)}</td>
                    </tr>
                    <tr style="border-top: 2px solid #333;">
                        <td style="padding: 10px 5px; text-align: left; font-weight: bold; font-size: 16px;">Grand Total:</td>
                        <td style="padding: 10px 5px; text-align: right; font-weight: bold; font-size: 16px;">₹${total.toFixed(2)}</td>
                    </tr>
                </table>
            </div>
            
            <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ccc; font-size: 12px; color: #666;">
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
                <label>L</label>
                <input type="number" class="c-len" style="width:100%; padding:6px;">
            </div>
            <div class="form-group" style="flex:1;">
                <label>W</label>
                <input type="number" class="c-wid" style="width:100%; padding:6px;">
            </div>
            <div class="form-group" style="flex:1;">
                <label>H</label>
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
        customers.push({
            name: row.querySelector('.c-name').value,
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

        let html = `<h4>Quality Group: ${group.quality} (Total Sheets: ${group.totalSheets})</h4>`;

        // Unproduced
        if (group.unproduced.length > 0) {
            html += `<div style="color:red; margin-bottom:10px;"><strong>Could not produce:</strong> ${group.unproduced.length} sheets (No suitable board found)</div>`;
        }

        // Produced
        if (group.produced.length > 0) {
            html += `<table class="data-table">
                <thead>
                    <tr>
                        <th>Board Size</th>
                        <th>Utilization</th>
                        <th>Cuts (Sheets to make)</th>
                    </tr>
                </thead>
                <tbody>`;

            group.produced.forEach(p => {
                // Summarize cuts
                // e.g. "Customer A (120x30): 5 pcs" from this board? 
                // Our optimizer returns individual cuts. Let's aggregate for display.
                const cutSummary = {};
                p.cuts.forEach(c => {
                    const key = `${c.customer} (${c.sheetL}x${c.sheetW})`;
                    cutSummary[key] = (cutSummary[key] || 0) + 1;
                });

                const cutStr = Object.entries(cutSummary).map(([k, v]) => `${k}: ${v}`).join('<br>');

                html += `<tr>
                    <td>${p.boardSize}</td>
                    <td>${p.utilization}%</td>
                    <td style="font-size:12px;">${cutStr}</td>
                </tr>`;
            });

            html += `</tbody></table>`;
        }

        groupDiv.innerHTML = html;
        container.appendChild(groupDiv);
    });
}

// Initial Init
// Add one customer row by default
addCustomerRow();
