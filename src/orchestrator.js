const PodEMaisApiClient = require('./api/podemais-api.client');
const PodEMaisSocketClient = require('./api/podemais-socket.client');
const QueueRepository = require('./queue/queue.repository');
const QueueManager = require('./queue/queue.manager');
const RouteOptimizer = require('./routes/route-optimizer');
const { JumaService, ReconciliationNeededError } = require('./juma/juma.service');
const config = require('./config');

class AutomationOrchestrator {
  constructor(customComponents = {}) {
    this.apiClient = customComponents.apiClient || new PodEMaisApiClient();
    this.socketClient = customComponents.socketClient || new PodEMaisSocketClient();
    this.queueRepo = customComponents.queueRepo || new QueueRepository();
    this.routeOptimizer = customComponents.routeOptimizer || new RouteOptimizer();
    this.queueManager =
      customComponents.queueManager || new QueueManager(this.queueRepo, this.routeOptimizer);
    this.jumaService = customComponents.jumaService || new JumaService();

    this.pollTimer = null;
    this.isRunning = false;
  }

  async start() {
    this.isRunning = true;
    console.log('====================================================');
    console.log('🚀 INICIANDO ECOMMERCE JUMA AUTOMATION SERVICE');
    console.log('====================================================');

    // 1. Inicializar Repositório da Fila
    await this.queueRepo.init();

    // 2. Autenticar na API da Pod & Mais (se credenciais estiverem configuradas)
    if (config.api.email && config.api.password) {
      try {
        console.log(`[Orchestrator] Autenticando na API Pod & Mais (${config.api.email})...`);
        await this.apiClient.login();
        console.log('[Orchestrator] ✅ Autenticado com sucesso na Pod & Mais API.');
      } catch (err) {
        console.error(`[Orchestrator] ⚠️ Aviso: Não foi possível autenticar na Pod & Mais API no startup: ${err.message}`);
      }
    } else {
      console.log('[Orchestrator] ℹ️ Credenciais da Pod & Mais API não definidas no .env. Aguardando configuração.');
    }

    // 3. Ouvir lotes prontos da fila
    this.queueManager.on('batch.ready', async ({ batchId, orders }) => {
      console.log(`[Orchestrator] Recebido lote ${batchId} com ${orders.length} pedido(s) para cadastro no Juma.`);
      await this.processBatch(orders);
    });

    // 4. Iniciar Gerenciador da Fila (janela de 20 min)
    await this.queueManager.start();

    // 5. Conectar Socket.IO para eventos em tempo real
    this.socketClient.connect((order) => {
      console.log(`[Orchestrator] Pedido separado recebido via WebSocket: #${order.orderNumber || order.id}`);
      this.queueManager.addOrder(order).catch((err) => {
        console.error('[Orchestrator] Erro ao enfileirar pedido do WebSocket:', err);
      });
    });

    // 6. Iniciar Polling de contingência periódica
    this._startPolling();

    console.log('[Orchestrator] ✅ Serviço em execução e pronto para processamento.');
  }

  _startPolling() {
    const pollInterval = config.api.pollIntervalMs;
    this.pollTimer = setInterval(async () => {
      if (!this.isRunning) return;
      try {
        await this.pollConfirmedOrders();
      } catch (err) {
        console.warn(`[Orchestrator] Erro no polling de pedidos: ${err.message}`);
      }
    }, pollInterval);

    // Executa uma primeira checagem imediata
    setImmediate(() => this.pollConfirmedOrders().catch(() => {}));
  }

  async pollConfirmedOrders() {
    if (!config.api.email) return;

    const data = await this.apiClient.getConfirmedOrders(1, 50);
    const orders = data.items || data.orders || (Array.isArray(data) ? data : []);

    for (const order of orders) {
      await this.queueManager.addOrder(order);
    }
  }

  async processBatch(orders) {
    for (const order of orders) {
      const orderRef = `#${order.orderNumber || order.id}`;
      console.log(`\n[Orchestrator] Processando cadastro do pedido ${orderRef}...`);

      try {
        // 1. Cadastrar no Juma com Playwright
        const result = await this.jumaService.registerOrder(order);

        // 2. Confirmar cadastro na fila local
        await this.queueRepo.markAsRegistered(order.id, result.jumaDeliveryId);
        console.log(`[Orchestrator] ✅ Pedido ${orderRef} registrado na fila como sucesso (Juma ID: ${result.jumaDeliveryId}).`);

        // 3. Atualizar status na Pod & Mais para DISPATCHED (enviado)
        try {
          if (this.apiClient && !result.dryRun) {
            await this.apiClient.updateOrderStatus(order.id, 'DISPATCHED');
            console.log(`[Orchestrator] 🚀 Status do pedido ${orderRef} atualizado para 'DISPATCHED' na Pod & Mais.`);
          } else if (result.dryRun) {
            console.log(`[Orchestrator] [DRY RUN] Status na API não modificado.`);
          }
        } catch (apiErr) {
          console.error(`[Orchestrator] ⚠️ Entrega confirmada no Juma, mas falhou ao atualizar status na Pod & Mais: ${apiErr.message}`);
          // Registra para retry na API sem duplicar no Juma
        }
      } catch (err) {
        if (err instanceof ReconciliationNeededError) {
          console.error(`[Orchestrator] 🛑 Pedido ${orderRef} necessita reconciliação manual: ${err.message}`);
          await this.queueRepo.markForReconciliation(order.id, err.message);
        } else {
          console.error(`[Orchestrator] ❌ Falha ao processar pedido ${orderRef}: ${err.message}`);
          await this.queueRepo.markAsFailed(order.id, err.message);
        }
      }
    }
  }

  async stop() {
    this.isRunning = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.socketClient.disconnect();
    this.queueManager.stop();
    await this.jumaService.close();
    await this.queueRepo.close();
    console.log('[Orchestrator] Serviço encerrado.');
  }
}

module.exports = AutomationOrchestrator;
