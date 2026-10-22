const { Pool } = require('pg');
const config = require('../src/config');

async function listQueue() {
  const pool = new Pool({
    connectionString: config.database.url,
    ssl: config.database.url && !config.database.url.includes('localhost') ? { rejectUnauthorized: false } : false,
  });

  try {
    const res = await pool.query(
      `SELECT order_number, status, enqueued_at, scheduled_for, attempts, last_error, juma_delivery_id 
       FROM delivery_queue 
       ORDER BY enqueued_at DESC 
       LIMIT 20;`
    );

    console.log('\n--- ÚLTIMOS PEDIDOS NA FILA DO BANCO DE DADOS ---');
    if (res.rows.length === 0) {
      console.log('Fila vazia.');
    } else {
      console.table(res.rows);
    }
  } catch (err) {
    console.error('Erro ao listar fila:', err.message);
  } finally {
    await pool.end();
  }
}

listQueue();
