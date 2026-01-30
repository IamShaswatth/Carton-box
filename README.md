# SP TEX - Carton ERP System

A comprehensive, offline desktop ERP solution designed specifically for Carton Box Manufacturing companies. Built with Electron, Node.js, and MySQL.

## 🚀 Features

- **Stock Management**
  - **Inward Entry:** Record daily production totals with details on Size (LxWxH), Flute Type, and Quantity.
  - **Stock Report:** View production history with options to **Edit** or **Delete** entries (Auto-stock adjustment included).
- **Sales & Delivery**
  - **Delivery Entry:** Create delivery records against customer POs.
  - **Invoice Generation:** Automatic GST calculations (CGST/SGST @ 2.5%) and invoice printing.
- **Reporting**
  - **Sales Report:** Detailed tabular view of all sales transactions.
  - **Dashboard:** Visual **Monthly Sales Chart** comparing Revenue vs. Quantity sold.
- **Data Integrity**
  - Robust error handling and transaction management.
  - Local MySQL database for data security and offline access.

## 🛠️ Technology Stack

- **Frontend:** HTML5, CSS3 (Premium UI), JavaScript
- **Backend:** Node.js, Electron (IPC)
- **Database:** MySQL
- **Charts:** Chart.js

## ⚙️ Installation & Setup

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/yourusername/carton-erp.git
    cd carton-erp
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    ```

3.  **Database Configuration**
    - Ensure you have MySQL installed and running.
    - Create a database named `carton_erp`.
    - Create a file named `config.js` in the root directory (this file is git-ignored for security).
    - Add your database credentials:

    ```javascript
    // config.js
    module.exports = {
        host: 'localhost',
        user: 'root',
        password: 'YOUR_MYSQL_PASSWORD',
        database: 'carton_erp'
    };
    ```

4.  **Run the Application**
    ```bash
    npm start
    ```

## 📝 License

Proprietary Software - Developed for SP TEX.
