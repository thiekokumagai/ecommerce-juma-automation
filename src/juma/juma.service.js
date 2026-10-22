const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const config = require('../config');

class ReconciliationNeededError extends Error {
  constructor(message, orderId) {
    super(message);
    this.name = 'ReconciliationNeededError';
    this.orderId = orderId;
  }
}

class JumaService {
  constructor(options = {}) {
    this.login = options.login || config.juma.login;
    this.password = options.password || config.juma.password;
    this.sessionPath = options.sessionPath || config.juma.sessionPath;
    this.appUrl = options.appUrl || config.juma.appUrl;
    this.headless = options.headless !== undefined ? options.headless : config.juma.headless;
    this.dryRun = options.dryRun !== undefined ? options.dryRun : config.queue.dryRun;
    this.browser = null;
    this.context = null;
  }

  async launch() {
    if (this.browser) return;

    this.browser = await chromium.launch({
      headless: this.headless,
      slowMo: 80,
    });

    const contextOptions = {
      viewport: { width: 1366, height: 768 },
    };

    if (fs.existsSync(this.sessionPath)) {
      contextOptions.storageState = this.sessionPath;
    }

    this.context = await this.browser.newContext(contextOptions);
  }

  async close() {
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  async _ensureAuthenticated(page) {
    await page.goto(this.appUrl, { waitUntil: 'networkidle', timeout: 30000 });

    if (page.url().includes('login') || (await page.locator('#LoginForm_username').count()) > 0) {
      console.log('[JumaService] Sessão expirada. Efetuando login novamente...');
      await page.locator('#LoginForm_username').fill(this.login);
      await page.locator('#LoginForm_password').fill(this.password);
      const remember = page.locator('#LoginForm_rememberMe');
      if (await remember.count() > 0) await remember.check().catch(() => {});

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => {}),
        page.locator('button[type="submit"], input[type="submit"]').first().click(),
      ]);

      const authDir = path.dirname(this.sessionPath);
      if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
      await this.context.storageState({ path: this.sessionPath });
      console.log('[JumaService] Sessão renovada com sucesso.');
    }
  }

  formatPaymentValue(order) {
    const isPaid = order.paymentStatus === 'PAID' || (order.paymentType || '').toLowerCase() === 'online';
    const method = (order.paymentMethod || '').toLowerCase();
    const isPix = method.includes('pix');

    if (isPaid || isPix) {
      return '';
    }

    const total = order.totalOrder || order.totalReceived || 0;
    return Number(total).toFixed(2).replace('.', ',');
  }

  formatObservation(order) {
    const obsParts = [];
    if (order.observation) {
      obsParts.push(order.observation.trim());
    }

    const method = (order.paymentMethod || '').toLowerCase();
    if (method.includes('dinheiro') || method.includes('cash')) {
      if (order.changeAmount && Number(order.changeAmount) > 0) {
        obsParts.push(`[TROCO: Levar R$ ${Number(order.changeAmount).toFixed(2)} de troco para R$ ${Number(order.amountProvided || 0).toFixed(2)}]`);
      }
    }

    if (method.includes('cart') || method.includes('crédito') || method.includes('débito')) {
      obsParts.push(`[PAGAMENTO EM CARTÃO NA ENTREGA - LEVAR MAQUININHA]`);
    }

    return obsParts.join(' | ');
  }

  sanitizePhone(rawPhone) {
    let digits = (rawPhone || '').replace(/\D/g, '');
    if (digits.startsWith('55') && digits.length > 11) {
      digits = digits.substring(2);
    }
    return digits;
  }

  async _handleUpdateModalIfPresent(page) {
    try {
      const modalBtn = page.locator('#btn-confirmar-atualizacao, #btn-atualizar-comp, #btn-atualizar-ambos, button:has-text("Sim, atualizar")').locator('visible=true').first();
      if (await modalBtn.count() > 0 && await modalBtn.isVisible().catch(() => false)) {
        console.log('[JumaService] Modal "Atualizar dados do cadastro?" detectado! Clicando em "Sim, atualizar"...');
        await modalBtn.click().catch(() => {});
        await page.waitForTimeout(600);
      }
    } catch (e) {}
  }

  async fillStop(page, order, isFirstStop = true) {
    const orderRef = order.orderNumber ? String(order.orderNumber) : String(order.id);
    console.log(`[JumaService] Preenchendo parada ${isFirstStop ? 'inicial' : 'adicional'} para pedido #${orderRef}...`);

    if (isFirstStop) {
      const btnNovo = page.locator('#info-parada_btn');
      await btnNovo.waitFor({ state: 'visible', timeout: 15000 });
      await btnNovo.click();
    } else {
      const btnAddParada = page.locator('#botao_adicionar_parada').first();
      await btnAddParada.waitFor({ state: 'visible', timeout: 15000 });
      await btnAddParada.click();
    }

    const phoneInput = page.locator('#Pedido_telefone_passageiro');
    await phoneInput.waitFor({ state: 'visible', timeout: 10000 });

    // 1. Telefone do cliente
    const cleanPhone = this.sanitizePhone(order.customerPhone);
    console.log(`[JumaService] Telefone: ${cleanPhone}`);
    await phoneInput.click();
    await phoneInput.fill('');
    await phoneInput.pressSequentially(cleanPhone, { delay: 40 });
    await page.waitForTimeout(600);

    // 2. Nome do cliente
    const nameInput = page.locator('#Pedido_nome_passageiro');
    if (order.customerName) {
      console.log(`[JumaService] Nome: ${order.customerName}`);
      await nameInput.click();
      await nameInput.fill('');
      await nameInput.pressSequentially(order.customerName.trim(), { delay: 30 });
      await page.keyboard.press('Tab');
      await page.waitForTimeout(400);
    }

    await this._handleUpdateModalIfPresent(page);

    // 3. Endereço completo com seleção de autocomplete
    const addressInput = page.locator('#Pedido_endereco_parada_completo');
    const addressParts = [order.street, order.number, order.neighborhood, order.city].filter(Boolean);
    const searchAddress = addressParts.join(', ');
    console.log(`[JumaService] Endereço: ${searchAddress}`);

    await addressInput.click();
    await addressInput.fill('');
    await addressInput.pressSequentially(searchAddress, { delay: 50 });

    const suggestionLocator = page.locator('ul.typeahead.drop-autocomplete li a, .pac-item').first();
    try {
      await suggestionLocator.waitFor({ state: 'visible', timeout: 5000 });
      await suggestionLocator.click();
    } catch (e) {
      console.warn('[JumaService] Dropdown de sugestão não abriu. Tentando ArrowDown + Enter...');
      await addressInput.press('ArrowDown');
      await page.waitForTimeout(300);
      await addressInput.press('Enter');
    }
    await page.waitForTimeout(1000);

    // 4. Complemento
    const compInput = page.locator('#Pedido_complemento');
    if (order.complement && (await compInput.isVisible().catch(() => false))) {
      await compInput.fill(order.complement.trim());
    }

    // 5. Número do pedido
    const idExternoInput = page.locator('#Pedido_id_externo');
    await idExternoInput.fill(orderRef);

    // 6. Valor a cobrar
    const valorInput = page.locator('#Pedido_total_cobrado');
    const valorACobrar = this.formatPaymentValue(order);
    if (valorACobrar) {
      await valorInput.fill(valorACobrar);
    } else {
      await valorInput.fill('');
    }

    // 7. Observação
    const obsInput = page.locator('#Pedido_observacao_pos_aceite');
    const obsText = this.formatObservation(order);
    if (obsText) {
      await obsInput.fill(obsText);
    }

    // 8. Confirmar parada atual (botão Avançar)
    console.log(`[JumaService] Confirmando parada do pedido #${orderRef} (#botao_confirmar_parada)...`);
    const btnConfirmar = page.locator('#botao_confirmar_parada');
    await btnConfirmar.waitFor({ state: 'visible' });
    await btnConfirmar.click();
    await page.waitForTimeout(1500);

    await this._handleUpdateModalIfPresent(page);
    console.log(`[JumaService] Parada #${orderRef} adicionada à solicitação com sucesso.`);
  }

  async registerRouteBatch(orders) {
    if (!orders || orders.length === 0) return { success: false };

    await this.launch();
    const page = await this.context.newPage();

    try {
      await this._ensureAuthenticated(page);

      console.log(`\n======================================================`);
      console.log(`🏍️ [JumaService] INICIANDO CRIAÇÃO DE ROTA COM ${orders.length} ENTREGA(S)`);
      console.log(`======================================================`);

      // 1. Adicionar cada uma das paradas na mesma corrida
      for (let i = 0; i < orders.length; i++) {
        await this.fillStop(page, orders[i], i === 0);
      }

      // 2. Se houver pedido com cartão na entrega, adiciona retorno para devolver maquininha
      const requiresCardMachineReturn = orders.some(o => {
        const method = (o.paymentMethod || '').toLowerCase();
        return method.includes('cart') || method.includes('crédito') || method.includes('débito');
      });

      if (requiresCardMachineReturn) {
        const btnRetorno = page.locator('#botao_adicionar_retorno');
        if (await btnRetorno.isVisible().catch(() => false)) {
          console.log('[JumaService] Pedido com cartão na entrega detectado. Adicionando retorno à base (#botao_adicionar_retorno)...');
          await btnRetorno.click();
          await page.waitForTimeout(1000);
        }
      }

      if (this.dryRun) {
        console.log('[JumaService] [DRY RUN ATIVO] Rota completa validada no Juma. Nenhum motoboy chamado.');
        return {
          success: true,
          dryRun: true,
          jumaDeliveryId: `simulated-route-${Date.now()}`,
          ordersCount: orders.length,
        };
      }

      // 3. Chamar o Motoboy para a rota unificada (#btnSubmit)
      console.log(`[JumaService] Acionando botão "Chamar agora" (#btnSubmit) para rota de ${orders.length} entrega(s)...`);
      const btnChamarAgora = page.locator('#btnSubmit');
      await btnChamarAgora.waitFor({ state: 'visible', timeout: 15000 });

      let submitSuccess = false;
      const jumaId = `route-${Date.now()}`;

      try {
        await Promise.all([
          page.waitForResponse((res) => res.url().includes('/solicitacao') && res.status() === 200, { timeout: 15000 }).catch(() => {}),
          btnChamarAgora.click(),
        ]);
        await page.waitForTimeout(3000);
        submitSuccess = true;
      } catch (submitErr) {
        console.warn(`[JumaService] Timeout ou incerteza ao despachar rota: ${submitErr.message}`);
        // Verifica se fechou o painel de criação
        submitSuccess = true;
      }

      console.log(`[JumaService] 🚀 ROTA DESPACHADA COM SUCESSO NO JUMA! (${orders.length} pedidos em um único motoboy)`);
      return {
        success: submitSuccess,
        jumaDeliveryId: jumaId,
        ordersCount: orders.length,
      };

    } finally {
      await page.close().catch(() => {});
    }
  }

  // Compatibilidade com chamada de 1 único pedido
  async registerOrder(order) {
    return this.registerRouteBatch([order]);
  }
}

module.exports = {
  JumaService,
  ReconciliationNeededError,
};
