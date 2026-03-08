const mysql = require('mysql2/promise');
const config = require('./config');

let pool;

async function initDB() {
    try {
        // Create connection without database to check/create database
        const connection = await mysql.createConnection({
            host: config.host,
            user: config.user,
            password: config.password
        });

        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\``);
        await connection.end();

        // Now create pool with database
        pool = mysql.createPool(config);

        // Create tables
        await pool.query(`
            CREATE TABLE IF NOT EXISTS production (
                production_id INT AUTO_INCREMENT PRIMARY KEY,
                date DATE NOT NULL,
                board_or_production_order_no VARCHAR(255),
                box_length INT,
                box_width INT,
                box_height INT,
                flute_type ENUM('S', 'N', 'B', 'C', 'E', 'BC', 'CB'),
                quantity_produced INT,
                remarks VARCHAR(255)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS sales (
                sales_id INT AUTO_INCREMENT PRIMARY KEY,
                date DATE NOT NULL,
                customer_name VARCHAR(255),
                customer_po_no VARCHAR(255),
                box_length INT,
                box_width INT,
                box_height INT,
                flute_type ENUM('S', 'N', 'B', 'C', 'E', 'BC', 'CB'),
                rate_per_box DECIMAL(10, 2),
                quantity_sold INT,
                invoice_no VARCHAR(50)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS stock (
                stock_id INT AUTO_INCREMENT PRIMARY KEY,
                box_length INT,
                box_width INT,
                box_height INT,
                flute_type ENUM('S', 'N', 'B', 'C', 'E', 'BC', 'CB'),
                stock_quantity INT,
                UNIQUE KEY unique_stock (box_length, box_width, box_height, flute_type)
            )
        `);

        // Customers and Invoices tables (optional/future expansion as per requirements, strictly necessary ones above)
        // Adding invoices table for GST record keeping
        await pool.query(`
            CREATE TABLE IF NOT EXISTS invoices (
                invoice_id INT AUTO_INCREMENT PRIMARY KEY,
                invoice_no VARCHAR(50) UNIQUE,
                invoice_date DATE,
                customer_name VARCHAR(255),
                total_amount DECIMAL(10, 2),
                cgst_amount DECIMAL(10, 2),
                sgst_amount DECIMAL(10, 2)
            )
        `);

        // Boards table for Raw Material Stock
        await pool.query(`
            CREATE TABLE IF NOT EXISTS boards (
                board_id INT AUTO_INCREMENT PRIMARY KEY,
                quality VARCHAR(50),
                length INT,
                width INT,
                quantity INT
            )
        `);

        // Customer Requests table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS customer_requests (
                request_id INT AUTO_INCREMENT PRIMARY KEY,
                customer_name VARCHAR(255),
                flute_type ENUM('S', 'N', 'B', 'C', 'E', 'BC', 'CB'),
                box_length INT,
                box_width INT,
                box_height INT,
                quantity INT,
                rate_per_box DECIMAL(10, 2),
                status ENUM('pending', 'delivered') DEFAULT 'pending',
                created_date DATE,
                delivered_date DATE NULL
            )
        `);

        // Remove weight column if it exists (migration)
        try {
            await pool.query(`ALTER TABLE customer_requests DROP COLUMN weight`);
        } catch (err) {
            // Column might not exist, ignore error
        }

        console.log("Database initialized successfully");
        return true;
    } catch (err) {
        console.error("Database initialization failed:", err);
        throw err;
    }
}

async function getStock(length, width, height, flute) {
    const [rows] = await pool.query(
        'SELECT * FROM stock WHERE box_length=? AND box_width=? AND box_height=? AND flute_type=?',
        [length, width, height, flute]
    );
    return rows[0];
}

async function addProduction(data) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        await connection.query(
            'INSERT INTO production (date, board_or_production_order_no, box_length, box_width, box_height, flute_type, quantity_produced) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [data.date, data.orderNo, data.length, data.width, data.height, data.flute, data.quantity]
        );

        // Update stock
        const [existingStock] = await connection.query(
            'SELECT stock_quantity FROM stock WHERE box_length=? AND box_width=? AND box_height=? AND flute_type=?',
            [data.length, data.width, data.height, data.flute]
        );

        if (existingStock.length > 0) {
            await connection.query(
                'UPDATE stock SET stock_quantity = stock_quantity + ? WHERE box_length=? AND box_width=? AND box_height=? AND flute_type=?',
                [data.quantity, data.length, data.width, data.height, data.flute]
            );
        } else {
            await connection.query(
                'INSERT INTO stock (box_length, box_width, box_height, flute_type, stock_quantity) VALUES (?, ?, ?, ?, ?)',
                [data.length, data.width, data.height, data.flute, data.quantity]
            );
        }

        await connection.commit();
        return { success: true };
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
}

async function addSales(data) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Check stock
        const [stockRows] = await connection.query(
            'SELECT stock_quantity FROM stock WHERE box_length=? AND box_width=? AND box_height=? AND flute_type=?',
            [data.length, data.width, data.height, data.flute]
        );

        if (stockRows.length === 0 || stockRows[0].stock_quantity < data.quantity) {
            throw new Error('Insufficient stock');
        }

        const invoiceNo = 'INV-' + Date.now(); // Simple auto-gen

        await connection.query(
            'INSERT INTO sales (date, customer_name, customer_po_no, box_length, box_width, box_height, flute_type, rate_per_box, quantity_sold, invoice_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [data.date, data.customer, data.poNo, data.length, data.width, data.height, data.flute, data.rate, data.quantity, invoiceNo]
        );

        await connection.query(
            'UPDATE stock SET stock_quantity = stock_quantity - ? WHERE box_length=? AND box_width=? AND box_height=? AND flute_type=?',
            [data.quantity, data.length, data.width, data.height, data.flute]
        );

        // Record Invoice Summary
        const baseAmount = data.rate * data.quantity;
        const cgst = baseAmount * 0.025;
        const sgst = baseAmount * 0.025;
        const total = baseAmount + cgst + sgst;

        await connection.query(
            'INSERT INTO invoices (invoice_no, invoice_date, customer_name, total_amount, cgst_amount, sgst_amount) VALUES (?, ?, ?, ?, ?, ?)',
            [invoiceNo, data.date, data.customer, total, cgst, sgst]
        );

        await connection.commit();
        return { success: true, invoiceNo };
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
}

async function getStockReport(filters) {
    // User requested: sl.no(auto increment),date, size , flute type , quantity
    // This maps to the PRODUCTION history.
    const [rows] = await pool.query('SELECT * FROM production ORDER BY date DESC, production_id DESC');
    return rows;
}

async function getMonthlySales() {
    const [rows] = await pool.query(`
        SELECT 
            DATE_FORMAT(date, '%M %Y') as month_label,
            DATE_FORMAT(date, '%Y-%m') as sort_key,
            SUM(rate_per_box * quantity_sold) as total_sales,
            SUM(quantity_sold) as total_quantity
        FROM sales
        GROUP BY sort_key, month_label
        ORDER BY sort_key ASC
    `);
    return rows;
}

async function getReportData(type, filters) {
    // Dynamic reporting
    if (type === 'sales') {
        const [rows] = await pool.query('SELECT * FROM sales');
        return rows;
    }
    return [];
}

async function deleteProduction(id) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get original details to reverse stock
        const [rows] = await connection.query('SELECT * FROM production WHERE production_id = ?', [id]);
        if (rows.length === 0) throw new Error('Entry not found');
        const entry = rows[0];

        // 2. Reduce stock
        await connection.query(
            'UPDATE stock SET stock_quantity = stock_quantity - ? WHERE box_length=? AND box_width=? AND box_height=? AND flute_type=?',
            [entry.quantity_produced, entry.box_length, entry.box_width, entry.box_height, entry.flute_type]
        );

        // 3. Delete record
        await connection.query('DELETE FROM production WHERE production_id = ?', [id]);

        await connection.commit();
        return { success: true };
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
}

async function updateProduction(data) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get original details
        const [rows] = await connection.query('SELECT * FROM production WHERE production_id = ?', [data.id]);
        if (rows.length === 0) throw new Error('Entry not found');
        const oldEntry = rows[0];

        // 2. Revert old stock
        await connection.query(
            'UPDATE stock SET stock_quantity = stock_quantity - ? WHERE box_length=? AND box_width=? AND box_height=? AND flute_type=?',
            [oldEntry.quantity_produced, oldEntry.box_length, oldEntry.box_width, oldEntry.box_height, oldEntry.flute_type]
        );

        // 3. Update production record
        await connection.query(
            'UPDATE production SET date=?, board_or_production_order_no=?, box_length=?, box_width=?, box_height=?, flute_type=?, quantity_produced=? WHERE production_id=?',
            [data.date, data.orderNo, data.length, data.width, data.height, data.flute, data.quantity, data.id]
        );

        // 4. Add new stock (reuse logic would be better but simple query is fine here)
        // Check if stock entry exists for NEW dimensions
        const [existingStock] = await connection.query(
            'SELECT stock_quantity FROM stock WHERE box_length=? AND box_width=? AND box_height=? AND flute_type=?',
            [data.length, data.width, data.height, data.flute]
        );

        if (existingStock.length > 0) {
            await connection.query(
                'UPDATE stock SET stock_quantity = stock_quantity + ? WHERE box_length=? AND box_width=? AND box_height=? AND flute_type=?',
                [data.quantity, data.length, data.width, data.height, data.flute]
            );
        } else {
            await connection.query(
                'INSERT INTO stock (box_length, box_width, box_height, flute_type, stock_quantity) VALUES (?, ?, ?, ?, ?)',
                [data.length, data.width, data.height, data.flute, data.quantity]
            );
        }

        await connection.commit();
        return { success: true };
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
}



// Board Functions
async function addBoard(data) {
    const connection = await pool.getConnection();
    try {
        await connection.query(
            'INSERT INTO boards (quality, length, width, quantity) VALUES (?, ?, ?, ?)',
            [data.quality, data.length, data.width, data.quantity]
        );
        return { success: true };
    } catch (err) {
        console.error(err);
        return { success: false, error: err.message };
    } finally {
        connection.release();
    }
}

async function getBoards() {
    const [rows] = await pool.query('SELECT * FROM boards ORDER BY quality, length DESC, width DESC');
    return rows;
}

async function deleteBoard(id) {
    try {
        await pool.query('DELETE FROM boards WHERE board_id = ?', [id]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Customer Request Functions
async function addCustomerRequest(data) {
    try {
        await pool.query(
            'INSERT INTO customer_requests (customer_name, flute_type, box_length, box_width, box_height, quantity, rate_per_box, created_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [data.customerName, data.flute, data.length, data.width, data.height, data.quantity, data.rate, data.date]
        );
        return { success: true };
    } catch (err) {
        console.error(err);
        return { success: false, error: err.message };
    }
}

async function getCustomerRequests() {
    const [rows] = await pool.query('SELECT * FROM customer_requests WHERE status = "pending" ORDER BY created_date DESC, request_id DESC');
    return rows;
}

async function getAllCustomerRequests() {
    const [rows] = await pool.query('SELECT * FROM customer_requests ORDER BY created_date DESC, request_id DESC');
    return rows;
}

async function deliverCustomerRequest(requestId, deliveryData) {
    console.log('=== deliverCustomerRequest called ===');
    console.log('requestId:', requestId);
    console.log('deliveryData:', deliveryData);
    console.log('pool exists:', !!pool);
    
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Get the customer request details
        const [requestRows] = await connection.query('SELECT * FROM customer_requests WHERE request_id = ?', [requestId]);
        console.log('Found request rows:', requestRows.length);
        if (requestRows.length === 0) {
            throw new Error('Request not found');
        }
        const request = requestRows[0];

        console.log('Processing delivery for request:', request);

        // Check stock
        const [stockRows] = await connection.query(
            'SELECT stock_quantity FROM stock WHERE box_length=? AND box_width=? AND box_height=? AND flute_type=?',
            [request.box_length, request.box_width, request.box_height, request.flute_type]
        );

        if (stockRows.length === 0 || stockRows[0].stock_quantity < request.quantity) {
            throw new Error('Insufficient stock. Available: ' + (stockRows.length > 0 ? stockRows[0].stock_quantity : 0) + ', Required: ' + request.quantity);
        }

        const invoiceNo = 'INV-' + Date.now();

        // Add sales entry
        await connection.query(
            'INSERT INTO sales (date, customer_name, customer_po_no, box_length, box_width, box_height, flute_type, rate_per_box, quantity_sold, invoice_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [deliveryData.date, request.customer_name, deliveryData.poNo || 'N/A', request.box_length, request.box_width, request.box_height, request.flute_type, request.rate_per_box, request.quantity, invoiceNo]
        );

        // Update stock
        await connection.query(
            'UPDATE stock SET stock_quantity = stock_quantity - ? WHERE box_length=? AND box_width=? AND box_height=? AND flute_type=?',
            [request.quantity, request.box_length, request.box_width, request.box_height, request.flute_type]
        );

        // Record Invoice Summary
        const baseAmount = request.rate_per_box * request.quantity;
        const cgst = baseAmount * 0.025;
        const sgst = baseAmount * 0.025;
        const total = baseAmount + cgst + sgst;

        await connection.query(
            'INSERT INTO invoices (invoice_no, invoice_date, customer_name, total_amount, cgst_amount, sgst_amount) VALUES (?, ?, ?, ?, ?, ?)',
            [invoiceNo, deliveryData.date, request.customer_name, total, cgst, sgst]
        );

        // Update customer request status
        await connection.query(
            'UPDATE customer_requests SET status = "delivered", delivered_date = ? WHERE request_id = ?',
            [deliveryData.date, requestId]
        );

        await connection.commit();
        console.log('Delivery processed successfully. Invoice:', invoiceNo);
        return { success: true, invoiceNo };
    } catch (err) {
        await connection.rollback();
        console.error('Error in deliverCustomerRequest:', err);
        throw err;
    } finally {
        connection.release();
    }
}

async function deleteCustomerRequest(id) {
    try {
        await pool.query('DELETE FROM customer_requests WHERE request_id = ?', [id]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}


module.exports = {
    initDB,
    addProduction,
    addSales,
    getStockReport,
    getReportData,
    deleteProduction,
    updateProduction,
    getMonthlySales,
    addBoard,
    getBoards,
    deleteBoard,
    addCustomerRequest,
    getCustomerRequests,
    getAllCustomerRequests,
    deliverCustomerRequest,
    deleteCustomerRequest
};
