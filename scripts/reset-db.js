#!/usr/bin/env node
/*
 * scripts/reset-db.js
 *
 * Usage:
 *   node scripts/reset-db.js            # defaults to 'truncate'
 *   node scripts/reset-db.js truncate  # truncate all tables (keeps DB)
 *   node scripts/reset-db.js drop      # drop + recreate DB and tables
 *
 * This script uses the DB connection in `src/config.js` and the table
 * creation statements in `src/database/dbModel.js`. It avoids the need for
 * a separate `mysql` CLI client on Windows.
 */

const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const config = require('../src/config.js');
const dbModel = require('../src/database/dbModel.js');

const DEFAULT_ADMIN = { name: '常用名字', email: 'a@jwt.com', password: 'admin' };

async function createDefaultAdmin(connection) {
  try {
    const [rows] = await connection.execute('SELECT id FROM user WHERE email=?', [DEFAULT_ADMIN.email]);
    if (rows.length > 0) {
      console.log('Default admin already exists, skipping creation.');
      return;
    }
    const hashed = await bcrypt.hash(DEFAULT_ADMIN.password, 10);
    const [res] = await connection.execute('INSERT INTO user (name,email,password) VALUES (?, ?, ?)', [DEFAULT_ADMIN.name, DEFAULT_ADMIN.email, hashed]);
    const insertId = res.insertId || (Array.isArray(res) && res[0] && res[0].insertId) || null;
    if (insertId) {
      await connection.execute('INSERT INTO userRole (userId, role, objectId) VALUES (?, ?, ?)', [insertId, 'admin', 0]);
      console.log('Default admin created (email: a@jwt.com password: admin)');
    } else {
      console.warn('Could not determine inserted user id; default admin role not created.');
    }
  } catch (err) {
    console.error('Error creating default admin:', err.message);
  }
}

(async function main() {
  const mode = (process.argv[2] || 'truncate').toLowerCase();
  const dbName = config.db.connection.database;

  // Base connection without selecting a database (used for DROP/CREATE)
  const baseConn = {
    host: config.db.connection.host,
    user: config.db.connection.user,
    password: config.db.connection.password,
    connectTimeout: config.db.connection.connectTimeout,
    decimalNumbers: true,
  };

  let connection;
  try {
    if (mode === 'drop') {
      connection = await mysql.createConnection(baseConn);
      console.log(`Dropping and recreating database \`${dbName}\`...`);
      await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      await connection.query(`CREATE DATABASE \`${dbName}\``);
      await connection.query(`USE \`${dbName}\``);

      for (const stmt of dbModel.tableCreateStatements) {
        await connection.query(stmt);
      }

      await createDefaultAdmin(connection);
      console.log('Drop & recreate completed.');
    } else if (mode === 'truncate') {
      connection = await mysql.createConnection({ ...baseConn, database: dbName });
      console.log(`Truncating tables in database \`${dbName}\`...`);
      await connection.query('SET FOREIGN_KEY_CHECKS=0');

      // Order chosen to avoid foreign key constraint errors
      const tables = ['auth', 'orderItem', 'dinerOrder', 'userRole', 'store', 'franchise', 'menu', 'user'];
      for (const t of tables) {
        try {
          await connection.query(`TRUNCATE TABLE \`${t}\``);
        } catch (err) {
          console.warn(`Warning: truncating table ${t} failed: ${err.message}`);
        }
      }

      await connection.query('SET FOREIGN_KEY_CHECKS=1');
      await createDefaultAdmin(connection);
      console.log('Truncate completed.');
    } else {
      console.error('Unknown mode. Use "truncate" (default) or "drop".');
      process.exit(1);
    }
  } catch (err) {
    console.error('Error:', err.message);
    console.error('If you get connection errors, verify MySQL is running and credentials in src/config.js are correct.');
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
})();
