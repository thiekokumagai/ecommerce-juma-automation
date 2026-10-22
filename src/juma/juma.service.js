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
      slowMo: 100,
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

      // Salva sessão atualizada
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
      // PIX ou pago online: não cobrar novamente do cliente
      return '';
    }

    // Cartão na entrega ou Dinheiro na entrega: preencher valor total
    const total = order.totalOrder || order.totalReceived || 0;
    return Number(total).toFixed(2).replace('.', ',');
  }

  formatObservation(order) {
    const obsParts = [];
    if (order.observation) {
      obsParts.push(order.observation.trim());
    }

    // Regra de troco para dinheiro
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
    // Se vier com o DDI 55 do Brasil (12 ou 13 dígitos), remove o 55 pois o Juma já fixa a bandeira +55
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
    } catch (e) {
      // Ignora se não houver modal
    }
  }

  async registerOrder(order) {
    await this.launch();
    const page = await this.context.newPage();

    try {
      await this._ensureAuthenticated(page);

      // Clicar no botão de novo pedido
      console.log(`[JumaService] Abrindo formulário de nova parada para pedido #${order.orderNumber || order.id}...`);
      const btnNovo = page.locator('#info-parada_btn');
      await btnNovo.waitFor({ state: 'visible', timeout: 15000 });
      await btnNovo.click();

      // Aguardar os campos do formulário aparecerem
      const phoneInput = page.locator('#Pedido_telefone_passageiro');
      await phoneInput.waitFor({ state: 'visible', timeout: 10000 });

      // 1. Telefone do cliente (apenas DDD + Número)
      const cleanPhone = this.sanitizePhone(order.customerPhone);
      console.log(`[JumaService] Preenchendo telefone: ${cleanPhone}`);
      await phoneInput.click();
      await phoneInput.fill('');
      await phoneInput.pressSequentially(cleanPhone, { delay: 40 });
      await page.waitForTimeout(600);

      // 2. Nome do cliente (limpa antes de digitar para evitar duplicação do nome existente)
      const nameInput = page.locator('#Pedido_nome_passageiro');
      if (order.customerName) {
        console.log(`[JumaService] Preenchendo nome: ${order.customerName}`);
        await nameInput.click();
        await nameInput.fill('');
        await nameInput.pressSequentially(order.customerName.trim(), { delay: 30 });
        await page.keyboard.press('Tab');
        await page.waitForTimeout(400);
      }

      // Trata modal caso surja após sair do campo de nome
      await this._handleUpdateModalIfPresent(page);

      // 3. Endereço completo com seleção no Autocomplete do Google
      const addressInput = page.locator('#Pedido_endereco_parada_completo');
      const addressParts = [order.street, order.number, order.neighborhood, order.city].filter(Boolean);
      const searchAddress = addressParts.join(', ');
      console.log(`[JumaService] Buscando endereço: ${searchAddress}`);
      
      await addressInput.click();
      await addressInput.fill('');
      await addressInput.pressSequentially(searchAddress, { delay: 60 });

      // Aguarda e clica na sugestão do Google/Typeahead para fixar o pino no mapa
      const suggestionLocator = page.locator('ul.typeahead.drop-autocomplete li a, .pac-item').first();
      try {
        await suggestionLocator.waitFor({ state: 'visible', timeout: 5000 });
        const suggestionText = await suggestionLocator.innerText().catch(() => '');
        console.log(`[JumaService] Clicando na sugestão: "${suggestionText}"`);
        await suggestionLocator.click();
      } catch (e) {
        console.warn('[JumaService] Dropdown de sugestão não abriu em 5s. Tentando ArrowDown + Enter...');
        await addressInput.press('ArrowDown');
        await page.waitForTimeout(300);
        await addressInput.press('Enter');
      }
      await page.waitForTimeout(1000);

      // 4. Complemento (aparece após fixar o endereço)
      const compInput = page.locator('#Pedido_complemento');
      if (order.complement && (await compInput.isVisible().catch(() => false))) {
        console.log(`[JumaService] Preenchendo complemento: ${order.complement}`);
        await compInput.fill(order.complement.trim());
      }

      // 5. Número do pedido
      const idExternoInput = page.locator('#Pedido_id_externo');
      const orderRef = order.orderNumber ? String(order.orderNumber) : String(order.id);
      await idExternoInput.fill(orderRef);

      // 6. Valor a cobrar
      const valorInput = page.locator('#Pedido_total_cobrado');
      const valorACobrar = this.formatPaymentValue(order);
      if (valorACobrar) {
        console.log(`[JumaService] Preenchendo valor a cobrar: R$ ${valorACobrar}`);
        await valorInput.fill(valorACobrar);
      } else {
        console.log(`[JumaService] Pedido já pago online / PIX. Campo valor a cobrar mantido vazio.`);
        await valorInput.fill('');
      }

      // 7. Observação
      const obsInput = page.locator('#Pedido_observacao_pos_aceite');
      const obsText = this.formatObservation(order);
      if (obsText) {
        await obsInput.fill(obsText);
      }

      if (this.dryRun) {
        console.log(`[JumaService] [DRY RUN ATIVO] Dados validados com sucesso no formulário. Nenhuma entrega real criada.`);
        return {
          success: true,
          dryRun: true,
          jumaDeliveryId: `simulated-${Date.now()}`,
          orderNumber: order.orderNumber,
        };
      }

      // 8. Confirmar parada (botão Avançar)
      console.log(`[JumaService] Confirmando parada (#botao_confirmar_parada)...`);
      const btnConfirmar = page.locator('#botao_confirmar_parada');
      await btnConfirmar.waitFor({ state: 'visible' });
      await btnConfirmar.click();
      await page.waitForTimeout(1500);

      // Trata modal se surgir após o Avançar
      await this._handleUpdateModalIfPresent(page);

      // 9. Solicitar Motoboy (botão "Chamar agora" - #btnSubmit)
      console.log(`[JumaService] Acionando botão "Chamar agora" (#btnSubmit)...`);
      const btnChamarAgora = page.locator('#btnSubmit');
      
      let submitSuccess = false;
      let jumaId = null;

      try {
        await btnChamarAgora.waitFor({ state: 'visible', timeout: 15000 });
        console.log('[JumaService] Botão "Chamar agora" visível! Clicando para despachar o motoboy...');

        await Promise.all([
          page.waitForResponse((res) => res.url().includes('/solicitacao') && res.status() === 200, { timeout: 15000 }).catch(() => {}),
          btnChamarAgora.click(),
        ]);

        await page.waitForTimeout(3000);
        submitSuccess = true;
      } catch (submitErr) {
        console.warn(`[JumaService] Timeout ou incerteza ao chamar motoboy: ${submitErr.message}`);
        const createdOnScreen = await page.locator(`text=${orderRef}`).count() > 0;
        if (createdOnScreen) {
          submitSuccess = true;
        } else {
          throw new ReconciliationNeededError(
            `Incerteza na confirmação do motoboy para pedido #${orderRef} no Juma pós-submit. Marcando para reconciliação manual para evitar duplicidade.`,
            order.id
          );
        }
      }

      console.log(`[JumaService] ✅ Motoboy chamado com sucesso no Juma para o pedido #${orderRef}!`);
      return {
        success: submitSuccess,
        jumaDeliveryId: jumaId || `juma-${Date.now()}`,
        orderNumber: order.orderNumber,
      };
    } finally {
      await page.close().catch(() => {});
    }
  }
}

module.exports = {
  JumaService,
  ReconciliationNeededError,
};
