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


module.exports = {
    initDB,
    addProduction,
    addSales,
    getStockReport,
    getReportData,
    deleteProduction,
    updateProduction,
    getMonthlySales
};
