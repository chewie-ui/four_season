import mysql from 'mysql2/promise';
import env from '../config/env.js';

let pool = null;

/**
 * Pool MySQL paresseux : rien n'est ouvert tant qu'une requête n'est pas nécessaire.
 * Renvoie null si la base n'est pas configurée — le site vitrine doit tourner sans.
 */
export function getPool() {
  if (!env.db.configured) return null;
  if (!pool) {
    pool = mysql.createPool({
      host: env.db.host,
      port: env.db.port,
      user: env.db.user,
      password: env.db.password,
      database: env.db.database,
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4',
      timezone: 'Z',
      namedPlaceholders: true,
      dateStrings: false,
    });
  }
  return pool;
}

export async function query(sql, params = {}) {
  const p = getPool();
  if (!p) throw new Error('Base de données non configurée (voir .env)');
  const [rows] = await p.execute(sql, params);
  return rows;
}

/** Exécute un bloc dans une transaction. Indispensable pour débit de crédit + création de job. */
export async function transaction(fn) {
  const p = getPool();
  if (!p) throw new Error('Base de données non configurée (voir .env)');
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function ping() {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
