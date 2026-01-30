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
            <td>${(inv.rate_per_box * inv.quantity_sold * 1.05).toFixed(2)}</td>
            <td><button class="btn-primary" style="padding: 5px 10px; font-size: 12px;" onclick="reprintInvoice('${inv.invoice_no}')">View/Print</button></td>
        `;
        table.querySelector('tbody').appendChild(tr);
    });

    list.appendChild(table);
}

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
    if (!confirm('Are you sure you want to delete this entry? Stock will be reversed.')) return;

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
    const baseAmount = data.rate * data.quantity;
    const cgst = baseAmount * 0.025;
    const sgst = baseAmount * 0.025;
    const total = baseAmount + cgst + sgst;

    const html = `
        <div style="font-family: monospace; line-height: 1.5;">
            <p><strong>Invoice No:</strong> ${invoiceNo} <span style="float:right"><strong>Date:</strong> ${data.date}</span></p>
            <p><strong>Customer:</strong> ${data.customer}</p>
            <p><strong>PO No:</strong> ${data.poNo}</p>
            <hr>
            <table style="width:100%; text-align:left;">
                <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Rate</th>
                    <th>Amount</th>
                </tr>
                <tr>
                    <td>Carton Box ${data.length}x${data.width}x${data.height} ${data.flute}</td>
                    <td>${data.quantity}</td>
                    <td>${data.rate}</td>
                    <td>${baseAmount.toFixed(2)}</td>
                </tr>
            </table>
            <hr>
            <p style="text-align:right">Subtotal: ${baseAmount.toFixed(2)}</p>
            <p style="text-align:right">CGST (2.5%): ${cgst.toFixed(2)}</p>
            <p style="text-align:right">SGST (2.5%): ${sgst.toFixed(2)}</p>
            <h3 style="text-align:right">Total: ${total.toFixed(2)}</h3>
        </div>
    `;

    document.getElementById('print-area').innerHTML = html;
    document.getElementById('invoice-preview').style.display = 'block';
    openTab('invoice');
}

function printInvoice() {
    window.print();
}

function closePreview() {
    document.getElementById('invoice-preview').style.display = 'none';
}
