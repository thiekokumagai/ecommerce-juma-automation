const EventEmitter = require('events');
const config = require('../config');

class QueueManager extends EventEmitter {
  constructor(repository, routeOptimizer, options = {}) {
    super();
    this.repository = repository;
    this.routeOptimizer = routeOptimizer;
    this.windowMinutes = options.windowMinutes || config.queue.groupingWindowMinutes;
    this.maxOrdersPerRoute = options.maxOrdersPerRoute || config.queue.maxOrdersPerRoute;
    this.checkIntervalMs = options.checkIntervalMs || 15000; // Avalia a cada 15 segundos
    this.timer = null;
    this.isRunning = false;
  }

  async start() {
    this.isRunning = true;
    console.log(`[QueueManager] Iniciado com janela de ${this.windowMinutes} minutos e máx ${this.maxOrdersPerRoute} pedidos/rota.`);
    this._scheduleNextCheck();
  }

  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('[QueueManager] Parado.');
  }

  _scheduleNextCheck() {
    if (!this.isRunning) return;
    this.timer = setTimeout(async () => {
      try {
        await this.evaluateQueue();
      } catch (err) {
        console.error('[QueueManager] Erro ao avaliar fila:', err);
      } finally {
        this._scheduleNextCheck();
      }
    }, this.checkIntervalMs);
  }

  async addOrder(order) {
    const existing = await this.repository.findByOrderId(order.id);
    if (existing) {
      console.log(`[QueueManager] Pedido #${order.orderNumber || order.id} já existe na fila (status: ${existing.status}). Ignorando.`);
      return existing;
    }

    const item = await this.repository.enqueue(order, this.windowMinutes);
    console.log(`[QueueManager] Pedido #${order.orderNumber || order.id} enfileirado. Janela fecha em: ${item.window_closes_at}`);
    this.emit('order.enqueued', item);

    // Se atingiu o limite de capacidade imediata por rota, antecipa a avaliação
    const waiting = await this.repository.getWaitingOrders();
    if (waiting.length >= this.maxOrdersPerRoute) {
      console.log(`[QueueManager] Limite de capacidade atingido (${waiting.length} pedidos). Antecipando processamento...`);
      setImmediate(() => this.evaluateQueue());
    }

    return item;
  }

  async removeOrder(orderId, reason = 'Entregue ou Cancelado') {
    const removed = await this.repository.removeOrder(orderId, reason);
    if (removed) {
      console.log(`[QueueManager] Pedido ${orderId} removido da fila ativa (${reason}).`);
      this.emit('order.removed', { orderId, reason });
    }
    return removed;
  }

  async getWaitingCount() {
    return this.repository.getWaitingCount();
  }

  async evaluateQueue() {
    const waitingOrders = await this.repository.getWaitingOrders();
    if (waitingOrders.length === 0) return;

    const now = new Date();
    const oldestOrder = waitingOrders[0];
    const oldestWindowExpired = new Date(oldestOrder.window_closes_at) <= now;
    const capacityReached = waitingOrders.length >= this.maxOrdersPerRoute;

    if (!oldestWindowExpired && !capacityReached) {
      const remainingSecs = Math.round((new Date(oldestOrder.window_closes_at).getTime() - now.getTime()) / 1000);
      console.log(`[QueueManager] Janela aberta. ${waitingOrders.length} pedido(s) aguardando. Restam ~${remainingSecs}s para expiração do lote.`);
      return;
    }

    console.log(`[QueueManager] Processando fila! Motivo: ${capacityReached ? 'Capacidade máxima atingida' : 'Janela de 20 minutos expirada'}. Total: ${waitingOrders.length}`);

    // Extrair payloads dos pedidos
    const candidateOrders = waitingOrders.map((row) => (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload));

    // Otimizar e calcular agrupamentos por rota
    let routesToDispatch = [];
    if (this.routeOptimizer && typeof this.routeOptimizer.groupOrders === 'function') {
      routesToDispatch = await this.routeOptimizer.groupOrders(candidateOrders, {
        maxPerRoute: this.maxOrdersPerRoute,
        forceDispatchExpiredOnly: !capacityReached,
        now,
      });
    } else {
      // Fallback sem otimizador de rota: lotes de até maxOrdersPerRoute
      routesToDispatch = [candidateOrders.slice(0, this.maxOrdersPerRoute)];
    }

    for (const routeGroup of routesToDispatch) {
      if (!routeGroup || routeGroup.length === 0) continue;

      const orderIds = routeGroup.map((o) => o.id);
      const batchId = `batch-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      // Bloquear atômicamente os pedidos para processamento
      const locked = await this.repository.lockOrdersForProcessing(orderIds, batchId);
      if (locked.length > 0) {
        console.log(`[QueueManager] Lote ${batchId} bloqueado com ${locked.length} pedido(s) para cadastro.`);
        this.emit('batch.ready', {
          batchId,
          orders: routeGroup,
        });
      }
    }
  }
}

module.exports = QueueManager;
