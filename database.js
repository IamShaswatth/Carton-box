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
                remarks VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Add created_at column if it doesn't exist (migration)
        try {
            await pool.query(`ALTER TABLE production ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
        } catch (err) {
            // Column might already exist, ignore error
        }

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
                invoice_no VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Add created_at column if it doesn't exist (migration)
        try {
            await pool.query(`ALTER TABLE sales ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
        } catch (err) {
            // Column might already exist, ignore error
        }

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

        // Stock Movements table for manual stock adjustments
        await pool.query(`
            CREATE TABLE IF NOT EXISTS stock_movements (
                movement_id INT AUTO_INCREMENT PRIMARY KEY,
                date DATE NOT NULL,
                box_length INT,
                box_width INT,
                box_height INT,
                flute_type ENUM('S', 'N', 'B', 'C', 'E', 'BC', 'CB'),
                quantity INT,
                movement_type ENUM('OUT', 'IN') DEFAULT 'OUT',
                reason VARCHAR(255),
                user_name VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    // User requested: Show both production (stock IN) and sales/deliveries (stock OUT)
    // Combined view to track all stock movements including manual adjustments
    
    // Get production entries (STOCK IN)
    const [productionRows] = await pool.query(`
        SELECT 
            date,
            'STOCK IN' as type,
            board_or_production_order_no as reference,
            box_length,
            box_width,
            box_height,
            flute_type,
            quantity_produced as quantity,
            NULL as customer_name,
            NULL as user_name,
            created_at,
            production_id as id
        FROM production
    `);

    // Get sales/delivery entries (STOCK OUT)
    const [salesRows] = await pool.query(`
        SELECT 
            date,
            'STOCK OUT' as type,
            invoice_no as reference,
            box_length,
            box_width,
            box_height,
            flute_type,
            -quantity_sold as quantity,
            customer_name,
            NULL as user_name,
            created_at,
            sales_id as id
        FROM sales
    `);

    // Get manual stock movements (both IN and OUT)
    const [movementRows] = await pool.query(`
        SELECT 
            date,
            CONCAT('MANUAL ', movement_type) as type,
            reason as reference,
            box_length,
            box_width,
            box_height,
            flute_type,
            CASE WHEN movement_type = 'OUT' THEN -quantity ELSE quantity END as quantity,
            NULL as customer_name,
            user_name,
            created_at,
            movement_id as id
        FROM stock_movements
    `);

    // Combine and sort - prioritize by timestamp if available, then by date
    const combined = [...productionRows, ...salesRows, ...movementRows];
    combined.sort((a, b) => {
        // If both have timestamps, sort by timestamp
        if (a.created_at && b.created_at) {
            return new Date(b.created_at) - new Date(a.created_at);
        }
        // If only one has timestamp, prioritize it (more recent)
        if (a.created_at && !b.created_at) return -1;
        if (!a.created_at && b.created_at) return 1;
        // Otherwise sort by date, then ID
        const dateCompare = new Date(b.date) - new Date(a.date);
        if (dateCompare !== 0) return dateCompare;
        return b.id - a.id;
    });

    return combined;
}

async function getCurrentStockSummary() {
    // Get current available stock from stock table
    const [rows] = await pool.query(`
        SELECT 
            box_length,
            box_width,
            box_height,
            flute_type,
            stock_quantity
        FROM stock
        WHERE stock_quantity > 0
        ORDER BY flute_type, box_length DESC, box_width DESC
    `);
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

async function reduceBoardStock(quality, length, width, quantityToReduce) {
    const connection = await pool.getConnection();
    try {
        // Find the board matching the specs
        const [boards] = await connection.query(
            'SELECT board_id, quantity FROM boards WHERE quality = ? AND length = ? AND width = ? LIMIT 1',
            [quality, length, width]
        );

        if (boards.length === 0) {
            return { success: false, error: 'Board not found in stock' };
        }

        const board = boards[0];
        const newQuantity = board.quantity - quantityToReduce;

        if (newQuantity < 0) {
            return { success: false, error: 'Insufficient board quantity' };
        }

        // Update the board quantity
        await connection.query(
            'UPDATE boards SET quantity = ? WHERE board_id = ?',
            [newQuantity, board.board_id]
        );

        return { success: true, newQuantity };
    } catch (err) {
        console.error(err);
        return { success: false, error: err.message };
    } finally {
        connection.release();
    }
}

async function updateStockFromOptimization(boardData, cuts) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Reduce raw board stock
        const [boards] = await connection.query(
            'SELECT board_id, quantity FROM boards WHERE quality = ? AND length = ? AND width = ? LIMIT 1',
            [boardData.quality, boardData.length, boardData.width]
        );

        if (boards.length === 0) {
            await connection.rollback();
            return { success: false, error: 'Board not found in stock' };
        }

        const board = boards[0];
        if (board.quantity < 1) {
            await connection.rollback();
            return { success: false, error: 'Insufficient board quantity' };
        }

        await connection.query(
            'UPDATE boards SET quantity = quantity - 1 WHERE board_id = ?',
            [board.board_id]
        );

        // 2. Group cuts by box dimensions and add to production
        const boxGroups = {};
        cuts.forEach(cut => {
            const key = `${cut.boxL}-${cut.boxW}-${cut.boxH}`;
            if (!boxGroups[key]) {
                boxGroups[key] = {
                    length: cut.boxL,
                    width: cut.boxW,
                    height: cut.boxH,
                    quantity: 0
                };
            }
            boxGroups[key].quantity++;
        });

        // 3. Add production entries AND update stock for each unique box size
        const today = new Date().toISOString().split('T')[0];
        for (const key in boxGroups) {
            const box = boxGroups[key];
            
            // Add production entry
            await connection.query(
                'INSERT INTO production (date, board_or_production_order_no, box_length, box_width, box_height, flute_type, quantity_produced) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [today, 'AUTO-CUT', box.length, box.width, box.height, boardData.quality, box.quantity]
            );

            // Update stock table (same logic as addProduction)
            const [existingStock] = await connection.query(
                'SELECT stock_quantity FROM stock WHERE box_length=? AND box_width=? AND box_height=? AND flute_type=?',
                [box.length, box.width, box.height, boardData.quality]
            );

            if (existingStock.length > 0) {
                await connection.query(
                    'UPDATE stock SET stock_quantity = stock_quantity + ? WHERE box_length=? AND box_width=? AND box_height=? AND flute_type=?',
                    [box.quantity, box.length, box.width, box.height, boardData.quality]
                );
            } else {
                await connection.query(
                    'INSERT INTO stock (box_length, box_width, box_height, flute_type, stock_quantity) VALUES (?, ?, ?, ?, ?)',
                    [box.length, box.width, box.height, boardData.quality, box.quantity]
                );
            }
        }

        await connection.commit();
        return { success: true, boxesAdded: cuts.length };
    } catch (err) {
        await connection.rollback();
        console.error(err);
        return { success: false, error: err.message };
    } finally {
        connection.release();
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

// Stock Movement Functions
async function addStockMovement(data) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Check if enough stock is available for OUT movement
        if (data.movementType === 'OUT') {
            const [stockRows] = await connection.query(
                'SELECT stock_quantity FROM stock WHERE box_length=? AND box_width=? AND box_height=? AND flute_type=?',
                [data.length, data.width, data.height, data.flute]
            );

            if (stockRows.length === 0 || stockRows[0].stock_quantity < data.quantity) {
                throw new Error('Insufficient stock. Available: ' + (stockRows.length > 0 ? stockRows[0].stock_quantity : 0));
            }

            // Reduce stock
            await connection.query(
                'UPDATE stock SET stock_quantity = stock_quantity - ? WHERE box_length=? AND box_width=? AND box_height=? AND flute_type=?',
                [data.quantity, data.length, data.width, data.height, data.flute]
            );
        } else {
            // For IN movement, add to stock
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
        }

        // Record the movement
        await connection.query(
            'INSERT INTO stock_movements (date, box_length, box_width, box_height, flute_type, quantity, movement_type, reason, user_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [data.date, data.length, data.width, data.height, data.flute, data.quantity, data.movementType, data.reason, data.userName]
        );

        await connection.commit();
        return { success: true };
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
}

async function getStockMovements() {
    const [rows] = await pool.query(`
        SELECT 
            movement_id,
            date,
            box_length,
            box_width,
            box_height,
            flute_type,
            quantity,
            movement_type,
            reason,
            user_name,
            created_at
        FROM stock_movements 
        ORDER BY created_at DESC
    `);
    console.log('getStockMovements: Retrieved', rows.length, 'movements');
    if (rows.length > 0) {
        console.log('First movement (latest):', rows[0].movement_id, rows[0].created_at, rows[0].movement_type, rows[0].reason);
        console.log('Last movement (oldest):', rows[rows.length-1].movement_id, rows[rows.length-1].created_at, rows[rows.length-1].movement_type, rows[rows.length-1].reason);
    }
    return rows;
}

async function deleteStockMovement(id) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Get movement details to reverse it
        const [rows] = await connection.query('SELECT * FROM stock_movements WHERE movement_id = ?', [id]);
        if (rows.length === 0) throw new Error('Movement not found');
        const movement = rows[0];

        // Reverse the stock change
        if (movement.movement_type === 'OUT') {
            // Was taken out, so add it back
            const [existingStock] = await connection.query(
                'SELECT stock_quantity FROM stock WHERE box_length=? AND box_width=? AND box_height=? AND flute_type=?',
                [movement.box_length, movement.box_width, movement.box_height, movement.flute_type]
            );

            if (existingStock.length > 0) {
                await connection.query(
                    'UPDATE stock SET stock_quantity = stock_quantity + ? WHERE box_length=? AND box_width=? AND box_height=? AND flute_type=?',
                    [movement.quantity, movement.box_length, movement.box_width, movement.box_height, movement.flute_type]
                );
            } else {
                await connection.query(
                    'INSERT INTO stock (box_length, box_width, box_height, flute_type, stock_quantity) VALUES (?, ?, ?, ?, ?)',
                    [movement.box_length, movement.box_width, movement.box_height, movement.flute_type, movement.quantity]
                );
            }
        } else {
            // Was added in, so reduce it
            await connection.query(
                'UPDATE stock SET stock_quantity = stock_quantity - ? WHERE box_length=? AND box_width=? AND box_height=? AND flute_type=?',
                [movement.quantity, movement.box_length, movement.box_width, movement.box_height, movement.flute_type]
            );
        }

        // Delete the movement record
        await connection.query('DELETE FROM stock_movements WHERE movement_id = ?', [id]);

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
    getCurrentStockSummary,
    getReportData,
    deleteProduction,
    updateProduction,
    getMonthlySales,
    addBoard,
    getBoards,
    deleteBoard,
    reduceBoardStock,
    updateStockFromOptimization,
    addCustomerRequest,
    getCustomerRequests,
    getAllCustomerRequests,
    deliverCustomerRequest,
    deleteCustomerRequest,
    addStockMovement,
    getStockMovements,
    deleteStockMovement
};
