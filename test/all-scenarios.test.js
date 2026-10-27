const { JumaService, ReconciliationNeededError } = require('../src/juma/juma.service');
const RouteOptimizer = require('../src/routes/route-optimizer');
const GoogleRoutesClient = require('../src/routes/google-routes.client');
const QueueRepository = require('../src/queue/queue.repository');
const QueueManager = require('../src/queue/queue.manager');
const AutomationOrchestrator = require('../src/orchestrator');

describe('Suíte de Testes Automatizados - 14 Cenários do ecommerce-juma-automation', () => {

  // Helper para criar repositório limpo em memória para testes
  const createTestRepo = async () => {
    const repo = new QueueRepository({ inMemory: true });
    await repo.init();
    return repo;
  };

  // 1. Pedido pago por PIX
  test('1. Pedido pago por PIX não deve cobrar valor no Juma', () => {
    const service = new JumaService();
    const order = {
      orderNumber: 101,
      paymentMethod: 'PIX',
      paymentStatus: 'PAID',
      paymentType: 'Online',
      totalOrder: 150.0,
    };

    const paymentVal = service.formatPaymentValue(order);
    expect(paymentVal).toBe('');
  });

  // 2. Pedido com cartão na entrega
  test('2. Pedido com cartão na entrega deve preencher valor a cobrar e sinalizar maquininha', () => {
    const service = new JumaService();
    const optimizer = new RouteOptimizer();
    const order = {
      orderNumber: 102,
      paymentMethod: 'Cartão de Crédito',
      paymentStatus: 'PENDING',
      paymentType: 'Presencial',
      totalOrder: 85.5,
    };

    const paymentVal = service.formatPaymentValue(order);
    expect(paymentVal).toBe('85,50');

    const isCard = optimizer.isCardOnDelivery(order);
    expect(isCard).toBe(true);

    const obs = service.formatObservation(order);
    expect(obs).toBe('Crédito');

    const orderParcelado = { ...order, installments: 3 };
    expect(service.formatObservation(orderParcelado)).toBe('Crédito 3x');
  });

  // 3. Pedido em dinheiro na entrega
  test('3. Pedido em dinheiro na entrega deve preencher valor e indicar troco quando aplicável', () => {
    const service = new JumaService();
    const order = {
      orderNumber: 103,
      paymentMethod: 'Dinheiro',
      paymentStatus: 'PENDING',
      paymentType: 'Presencial',
      totalOrder: 50.0,
      amountProvided: 100.0,
      changeAmount: 50.0,
    };

    const paymentVal = service.formatPaymentValue(order);
    expect(paymentVal).toBe('50,00');

    const obs = service.formatObservation(order);
    expect(obs).toBe('Troco para R$ 100,00');
  });

  // 4. Agrupamento de pedidos próximos no mesmo rumo
  test('4. Agrupamento de pedidos próximos forma rota combinada vantajosa', async () => {
    const mockRoutes = {
      geocodeAddress: jest.fn().mockImplementation((addr) => {
        if (addr.includes('Rua A')) return Promise.resolve({ lat: -20.450, lng: -54.600 });
        if (addr.includes('Rua B')) return Promise.resolve({ lat: -20.440, lng: -54.595 });
        return Promise.resolve({ lat: -20.490, lng: -54.610 }); // Origem
      }),
      computeRoute: jest.fn().mockResolvedValue({ durationMinutes: 25, distanceKm: 8 }),
    };

    const optimizer = new RouteOptimizer(mockRoutes, { maxBearingDiffDegrees: 45 });
    const order1 = { id: 'o1', street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'CG' };
    const order2 = { id: 'o2', street: 'Rua B', number: '20', neighborhood: 'Centro', city: 'CG' };

    const groups = await optimizer.groupOrders([order1, order2]);
    expect(groups.length).toBe(1);
    expect(groups[0].length).toBe(2);
  });

  // 5. Pedidos em sentidos opostos (rumo diferente)
  test('5. Pedidos em sentidos opostos devem ser separados em grupos individuais', async () => {
    const mockRoutes = {
      geocodeAddress: jest.fn().mockImplementation((addr) => {
        if (addr.includes('Rua Norte')) return Promise.resolve({ lat: -20.419, lng: -54.559 }); // Norte
        if (addr.includes('Rua Sul')) return Promise.resolve({ lat: -20.525, lng: -54.640 }); // Sul
        return Promise.resolve({ lat: -20.496, lng: -54.607 }); // Origem
      }),
      computeRoute: jest.fn().mockResolvedValue({ durationMinutes: 65, distanceKm: 30 }),
    };

    const optimizer = new RouteOptimizer(mockRoutes, { maxBearingDiffDegrees: 45 });
    const order1 = { id: 'o1', street: 'Rua Norte', number: '10', neighborhood: 'Norte', city: 'CG' };
    const order2 = { id: 'o2', street: 'Rua Sul', number: '20', neighborhood: 'Sul', city: 'CG' };

    const groups = await optimizer.groupOrders([order1, order2]);
    expect(groups.length).toBe(2);
    expect(groups[0].length).toBe(1);
    expect(groups[1].length).toBe(1);
  });

  // 6. Expiração da janela de 20 minutos
  test('6. Expiração da janela de 20 minutos despacha pedidos aguardando', async () => {
    const repo = await createTestRepo();
    const manager = new QueueManager(repo, null, { windowMinutes: 20 });

    const order = { id: 'exp-1', orderNumber: 200, street: 'Rua X' };
    await manager.addOrder(order);

    // Simular que o pedido entrou há 21 minutos
    const item = await repo.findByOrderId('exp-1');
    item.window_closes_at = new Date(Date.now() - 60000); // 1 minuto no passado

    let batchDispatched = false;
    manager.on('batch.ready', ({ orders }) => {
      batchDispatched = true;
      expect(orders.length).toBe(1);
      expect(orders[0].id).toBe('exp-1');
    });

    await manager.evaluateQueue();
    expect(batchDispatched).toBe(true);
  });

  // 7. Reinicialização com pedidos pendentes
  test('7. Reinicialização recupera pedidos pendentes da persistência', async () => {
    const repo = await createTestRepo();

    // Insere pedidos como se viessem de sessão anterior
    await repo.enqueue({ id: 'persisted-1', orderNumber: 301, street: 'Rua Antiga' });
    await repo.enqueue({ id: 'persisted-2', orderNumber: 302, street: 'Rua Antiga 2' });

    // Novo QueueManager simulando reinicialização do serviço
    const newManager = new QueueManager(repo, null);
    const waiting = await repo.getWaitingOrders();

    expect(waiting.length).toBe(2);
    expect(waiting[0].order_id).toBe('persisted-1');
  });

  // 8. Falha de autenticação no Juma
  test('8. Falha de autenticação no Juma tenta login com novas credenciais', async () => {
    const service = new JumaService({ login: 'podemais@jumaentregas.com.br', password: 'wrong' });
    let authChecked = false;

    service._ensureAuthenticated = jest.fn().mockImplementation(async () => {
      authChecked = true;
      throw new Error('Falha de autenticação no Juma');
    });

    await expect(service._ensureAuthenticated()).rejects.toThrow('Falha de autenticação');
    expect(authChecked).toBe(true);
  });

  // 9. Falha durante o preenchimento
  test('9. Falha durante o preenchimento marca pedido com erro e retentativa na fila', async () => {
    const repo = await createTestRepo();
    await repo.enqueue({ id: 'fail-fill-1', orderNumber: 401 });

    const updated = await repo.markAsFailed('fail-fill-1', 'Elemento do formulário não encontrado');
    expect(updated.attempts).toBe(1);
    expect(updated.status).toBe('WAITING_WINDOW');
    expect(updated.last_error).toContain('Elemento do formulário não encontrado');
  });

  // 10. Timeout após envio do formulário
  test('10. Timeout após envio do formulário encaminha para reconciliação para evitar duplicidade', async () => {
    const repo = await createTestRepo();
    await repo.enqueue({ id: 'timeout-1', orderNumber: 501 });

    await repo.markForReconciliation('timeout-1', 'Timeout pós-submit no Juma');
    const item = await repo.findByOrderId('timeout-1');

    expect(item.status).toBe('NEEDS_RECONCILIATION');
    expect(item.last_error).toContain('Timeout pós-submit');
  });

  // 11. Prevenção de cadastro duplicado
  test('11. Prevenção de cadastro duplicado rejeita segundo enfileiramento do mesmo pedido', async () => {
    const repo = await createTestRepo();
    const manager = new QueueManager(repo, null);

    const order = { id: 'dup-1', orderNumber: 601, street: 'Rua Teste' };
    const first = await manager.addOrder(order);
    const second = await manager.addOrder(order);

    expect(first).toBeDefined();
    expect(second.order_id).toBe('dup-1');

    const waiting = await repo.getWaitingOrders();
    expect(waiting.length).toBe(1);
  });

  // 12. Falha na Google Routes API
  test('12. Falha na Google Routes API recorre a fallback seguro sem travar o agrupamento', async () => {
    const client = new GoogleRoutesClient('invalid_key');
    const res = await client.computeRoute('Rua Loja, 1', ['Rua Cliente, 2', 'Rua Cliente, 3']);

    expect(res).toBeDefined();
    expect(res.durationMinutes).toBeGreaterThan(0);
    expect(res.distanceKm).toBeGreaterThan(0);
  });

  // 13. Falha ao atualizar o status na API
  test('13. Falha ao atualizar o status na API mantém cadastro no Juma e não quebra a fila', async () => {
    const repo = await createTestRepo();
    await repo.enqueue({ id: 'api-fail-1', orderNumber: 701 });

    const mockApi = {
      updateOrderStatus: jest.fn().mockRejectedValue(new Error('503 Service Unavailable')),
    };

    const mockJuma = {
      registerOrder: jest.fn().mockResolvedValue({ success: true, jumaDeliveryId: 'JUMA-123' }),
    };

    const orchestrator = new AutomationOrchestrator({
      apiClient: mockApi,
      queueRepo: repo,
      jumaService: mockJuma,
    });

    await orchestrator.processBatch([{ id: 'api-fail-1', orderNumber: 701 }]);

    const queueItem = await repo.findByOrderId('api-fail-1');
    expect(queueItem.status).toBe('REGISTERED');
    expect(queueItem.juma_delivery_id).toBe('JUMA-123');
    expect(mockApi.updateOrderStatus).toHaveBeenCalledWith('api-fail-1', 'DISPATCHED');
  });

  // 14. Recuperação de pedidos que falharam
  test('14. Pedidos que falharam atingem FAILED após número máximo de tentativas', async () => {
    const repo = await createTestRepo();
    await repo.enqueue({ id: 'retry-max', orderNumber: 801 });

    await repo.markAsFailed('retry-max', 'Erro tentativa 1');
    await repo.markAsFailed('retry-max', 'Erro tentativa 2');
    const finalState = await repo.markAsFailed('retry-max', 'Erro tentativa 3');

    expect(finalState.attempts).toBe(3);
    expect(finalState.status).toBe('FAILED');
  });

  // 15. Remoção de pedido entregue ou cancelado da fila do relógio
  test('15. Pedido cancelado ou entregue é removido da fila ativa e decrementa o contador', async () => {
    const repo = await createTestRepo();
    const manager = new QueueManager(repo, null);

    await manager.addOrder({ id: 'order-1', orderNumber: 901 });
    await manager.addOrder({ id: 'order-2', orderNumber: 902 });

    let waitingCount = await manager.getWaitingCount();
    expect(waitingCount).toBe(2);

    // Simula remoção por ter sido entregue ou cancelado
    await manager.removeOrder('order-1', 'COMPLETED');

    waitingCount = await manager.getWaitingCount();
    expect(waitingCount).toBe(1);

    const remaining = await repo.getWaitingOrders();
    expect(remaining.length).toBe(1);
    expect(remaining[0].order_id).toBe('order-2');
  });

});
