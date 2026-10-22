const { Pool } = require('pg');
const config = require('../config');

class QueueRepository {
  constructor(options = {}) {
    if (options.inMemory || options.connectionString === null) {
      this.connectionString = null;
    } else {
      this.connectionString = options.connectionString || config.database.url;
    }
    this.pool = null;
    this.isInMemory = !this.connectionString;
    this.memoryItems = new Map(); // Fallback para desenvolvimento local ou testes sem DB
  }

  async init() {
    if (this.connectionString) {
      this.pool = new Pool({
        connectionString: this.connectionString,
        ssl: this.connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
      });

      // Criar tabela de fila se não existir
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS delivery_queue (
          id VARCHAR(100) PRIMARY KEY,
          order_id VARCHAR(100) NOT NULL UNIQUE,
          order_number INT,
          batch_id VARCHAR(100),
          status VARCHAR(50) NOT NULL DEFAULT 'WAITING_WINDOW',
          enqueued_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
          window_closes_at TIMESTAMP WITH TIME ZONE NOT NULL,
          attempts INT DEFAULT 0,
          max_attempts INT DEFAULT 3,
          last_error TEXT,
          juma_delivery_id VARCHAR(100),
          confirmed_at TIMESTAMP WITH TIME ZONE,
          payload JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_delivery_queue_status ON delivery_queue(status);
        CREATE INDEX IF NOT EXISTS idx_delivery_queue_window ON delivery_queue(window_closes_at);
      `);
      console.log('[QueueRepository] Conectado ao PostgreSQL e tabela delivery_queue inicializada.');
    } else {
      console.log('[QueueRepository] Nenhuma DATABASE_URL configurada. Operando em modo de persistência em memória (testes/dev).');
    }
  }

  async enqueue(order, windowMinutes = 20) {
    const orderId = order.id;
    const now = new Date();
    const windowClosesAt = new Date(now.getTime() + windowMinutes * 60 * 1000);

    if (this.pool) {
      const query = `
        INSERT INTO delivery_queue (
          id, order_id, order_number, status, enqueued_at, scheduled_for, window_closes_at, attempts, payload
        ) VALUES (
          gen_random_uuid(), $1, $2, 'WAITING_WINDOW', $3, $4, $5, 0, $6
        )
        ON CONFLICT (order_id) DO NOTHING
        RETURNING *;
      `;
      const res = await this.pool.query(query, [
        orderId,
        order.orderNumber,
        now,
        windowClosesAt,
        windowClosesAt,
        JSON.stringify(order),
      ]);
      return res.rows[0] || null;
    } else {
      if (this.memoryItems.has(orderId)) {
        return null; // Já existe
      }
      const record = {
        id: `queue-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        order_id: orderId,
        order_number: order.orderNumber,
        batch_id: null,
        status: 'WAITING_WINDOW',
        enqueued_at: now,
        scheduled_for: windowClosesAt,
        window_closes_at: windowClosesAt,
        attempts: 0,
        max_attempts: 3,
        last_error: null,
        juma_delivery_id: null,
        confirmed_at: null,
        payload: order,
        created_at: now,
        updated_at: now,
      };
      this.memoryItems.set(orderId, record);
      return record;
    }
  }

  async findByOrderId(orderId) {
    if (this.pool) {
      const res = await this.pool.query('SELECT * FROM delivery_queue WHERE order_id = $1', [orderId]);
      return res.rows[0] || null;
    }
    return this.memoryItems.get(orderId) || null;
  }

  async getWaitingOrders() {
    if (this.pool) {
      const res = await this.pool.query(
        "SELECT * FROM delivery_queue WHERE status = 'WAITING_WINDOW' ORDER BY enqueued_at ASC"
      );
      return res.rows;
    }
    return Array.from(this.memoryItems.values())
      .filter((item) => item.status === 'WAITING_WINDOW')
      .sort((a, b) => new Date(a.enqueued_at) - new Date(b.enqueued_at));
  }

  async lockOrdersForProcessing(orderIds, batchId) {
    if (this.pool) {
      const res = await this.pool.query(
        `UPDATE delivery_queue 
         SET status = 'PROCESSING', batch_id = $1, updated_at = NOW()
         WHERE order_id = ANY($2::text[]) AND status = 'WAITING_WINDOW'
         RETURNING *;`,
        [batchId, orderIds]
      );
      return res.rows;
    }
    const locked = [];
    for (const id of orderIds) {
      const item = this.memoryItems.get(id);
      if (item && item.status === 'WAITING_WINDOW') {
        item.status = 'PROCESSING';
        item.batch_id = batchId;
        item.updated_at = new Date();
        locked.push(item);
      }
    }
    return locked;
  }

  async markAsRegistered(orderId, jumaDeliveryId = null) {
    const now = new Date();
    if (this.pool) {
      const res = await this.pool.query(
        `UPDATE delivery_queue
         SET status = 'REGISTERED', juma_delivery_id = $1, confirmed_at = $2, updated_at = $2
         WHERE order_id = $3
         RETURNING *;`,
        [jumaDeliveryId, now, orderId]
      );
      return res.rows[0];
    }
    const item = this.memoryItems.get(orderId);
    if (item) {
      item.status = 'REGISTERED';
      item.juma_delivery_id = jumaDeliveryId;
      item.confirmed_at = now;
      item.updated_at = now;
    }
    return item;
  }

  async markAsFailed(orderId, errorMessage) {
    const now = new Date();
    if (this.pool) {
      const res = await this.pool.query(
        `UPDATE delivery_queue
         SET attempts = attempts + 1,
             last_error = $1,
             status = CASE WHEN attempts + 1 >= max_attempts THEN 'FAILED' ELSE 'WAITING_WINDOW' END,
             updated_at = $2
         WHERE order_id = $3
         RETURNING *;`,
        [errorMessage, now, orderId]
      );
      return res.rows[0];
    }
    const item = this.memoryItems.get(orderId);
    if (item) {
      item.attempts += 1;
      item.last_error = errorMessage;
      item.status = item.attempts >= item.max_attempts ? 'FAILED' : 'WAITING_WINDOW';
      item.updated_at = now;
    }
    return item;
  }

  async markForReconciliation(orderId, reason) {
    const now = new Date();
    if (this.pool) {
      const res = await this.pool.query(
        `UPDATE delivery_queue
         SET status = 'NEEDS_RECONCILIATION',
             last_error = $1,
             updated_at = $2
         WHERE order_id = $3
         RETURNING *;`,
        [reason, now, orderId]
      );
      return res.rows[0];
    }
    const item = this.memoryItems.get(orderId);
    if (item) {
      item.status = 'NEEDS_RECONCILIATION';
      item.last_error = reason;
      item.updated_at = now;
    }
    return item;
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

module.exports = QueueRepository;
