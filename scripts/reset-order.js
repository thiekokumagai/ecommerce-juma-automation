const { Pool } = require('pg');
const config = require('../src/config');

async function resetOrder() {
  const orderRef = process.argv[2];

  if (!orderRef) {
    console.log('Uso: node scripts/reset-order.js <numero_do_pedido ou id>');
    console.log('Exemplo: node scripts/reset-order.js 65481');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: config.database.url,
    ssl: config.database.url && !config.database.url.includes('localhost') ? { rejectUnauthorized: false } : false,
  });

  try {
    console.log(`Buscando pedido #${orderRef} no banco de dados da fila...`);
    
    // Deleta o registro da fila para permitir que ele entre novamente como novo
    const res = await pool.query(
      `DELETE FROM delivery_queue 
       WHERE order_number = $1 OR order_id = $2::text
       RETURNING *;`,
      [isNaN(Number(orderRef)) ? -1 : Number(orderRef), String(orderRef)]
    );

    if (res.rows.length > 0) {
      console.log(`✅ [SUCESSO] Pedido #${orderRef} removido da fila com sucesso!`);
      console.log('Agora a automação irá recebê-lo e processá-lo normalmente pelo novo fluxo.');
    } else {
      console.log(`ℹ️ Pedido #${orderRef} não foi encontrado na tabela delivery_queue.`);
    }
  } catch (err) {
    console.error('Erro ao resetar pedido:', err.message);
  } finally {
    await pool.end();
  }
}

resetOrder();
