const { Pool } = require('pg');
const config = require('../src/config');

async function clearQueue() {
  const pool = new Pool({
    connectionString: config.database.url,
    ssl: config.database.url && !config.database.url.includes('localhost') ? { rejectUnauthorized: false } : false,
  });

  try {
    const res = await pool.query('DELETE FROM delivery_queue RETURNING *;');
    console.log(`\n🧹 [SUCESSO] ${res.rowCount} pedido(s) removidos da fila. A fila está limpa para novos testes!`);
  } catch (err) {
    console.error('Erro ao limpar fila:', err.message);
  } finally {
    await pool.end();
  }
}

clearQueue();
