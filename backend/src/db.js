import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool, types } = pg;

// Supabase/PostgREST devolvía bigint y numeric como número JSON.
// El driver pg los devuelve como string por defecto (evita perder precisión
// en enteros de 64 bits) — replicamos el comportamiento anterior para no
// romper comparaciones estrictas ni claves de Map/Set en todo el código migrado.
types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10)));   // int8 / bigint
types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));   // numeric

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: false }
    : false,
});

export async function query(text, params = []) {
  return pool.query(text, params);
}
