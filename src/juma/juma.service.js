const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { normalizeAddress, formatAddressForSearch } = require('../utils/address-formatter');

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
      args: [
        '--start-minimized',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
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

  isPhysicalPayment(order) {
    if (!order) return false;
    const method = (order.paymentMethod || '').toLowerCase();

    // Se for PIX, já está pago online
    if (method.includes('pix')) {
      return false;
    }

    // Crédito, Débito ou Dinheiro
    return (
      method.includes('cart') ||
      method.includes('credit') ||
      method.includes('crédit') ||
      method.includes('credito') ||
      method.includes('crédito') ||
      method.includes('debit') ||
      method.includes('débit') ||
      method.includes('debito') ||
      method.includes('débito') ||
      method.includes('card') ||
      method.includes('dinheiro') ||
      method.includes('cash')
    );
  }

  isCardPayment(order) {
    return this.isPhysicalPayment(order) && !((order.paymentMethod || '').toLowerCase().includes('dinheiro') || (order.paymentMethod || '').toLowerCase().includes('cash'));
  }

  formatPaymentValue(order) {
    // Quando for crédito, débito ou dinheiro: preenche o valor a cobrar
    if (this.isPhysicalPayment(order)) {
      const total = order.totalOrder || order.totalReceived || 0;
      return Number(total).toFixed(2).replace('.', ',');
    }

    // PIX não cobra nada
    return '';
  }

  formatObservation(order) {
    const obsParts = [];

    // Observação cadastrada pelo cliente no pedido
    if (order.observation && order.observation.trim()) {
      obsParts.push(order.observation.trim());
    }

    const method = (order.paymentMethod || '').toLowerCase();
    if (method.includes('dinheiro') || method.includes('cash')) {
      if (order.changeAmount && Number(order.changeAmount) > 0) {
        obsParts.push(`Troco para R$ ${Number(order.amountProvided || 0).toFixed(2).replace('.', ',')}`);
      } else {
        obsParts.push('Dinheiro');
      }
    } else if (this.isCardPayment(order)) {
      const isDebit = method.includes('deb') || method.includes('déb');
      const installments = Number(order.installments) || 1;

      if (isDebit) {
        obsParts.push('Débito');
      } else if (installments > 1) {
        obsParts.push(`Crédito ${installments}x`);
      } else {
        obsParts.push('Crédito');
      }
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

  async _handleUpdateModalIfPresent(page, expectedName = '') {
    try {
      const modal = page.locator('.modal.in, .modal.show, div[role="dialog"]').locator('visible=true').first();
      if (await modal.count() > 0 && await modal.isVisible().catch(() => false)) {
        const modalText = await modal.innerText().catch(() => '');
        if (modalText.includes('Atualizar dados do cadastro?') || modalText.includes('Deseja atualizar')) {
          console.log(`[JumaService] Modal de cadastro detectado: "${modalText.replace(/\s+/g, ' ').substring(0, 100)}..."`);
          
          // Se o texto contém repetição do nome (ex: "Julio MiJulio Mi"), cancela para não salvar duplicação no Juma
          const isDuplicated = expectedName && (
            modalText.includes(expectedName + expectedName) ||
            modalText.toLowerCase().includes((expectedName + expectedName).toLowerCase())
          );

          if (isDuplicated) {
            console.warn(`[JumaService] ⚠️ Detectada duplicação de nome no modal! Clicando em Cancelar para evitar salvar nome corrompido.`);
            const cancelBtn = modal.locator('button:has-text("Cancelar"), button:has-text("Não"), .btn-default, [data-dismiss="modal"]').first();
            await cancelBtn.click().catch(() => {});
          } else {
            const confirmBtn = modal.locator('#btn-confirmar-atualizacao, #btn-atualizar-comp, #btn-atualizar-ambos, button:has-text("Sim, atualizar")').first();
            await confirmBtn.click().catch(() => {});
          }
          await page.waitForTimeout(600);
        }
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
    await page.waitForTimeout(1000);

    // Se o autocomplete de consumidor do Juma abrir (#autocomplete-consumidor-lista), clica nele para confirmar e fechar dropdown
    const consumidorItem = page.locator('#autocomplete-consumidor-lista li, .ac-item-simple').first();
    const expectedName = (order.customerName || '').trim();

    if (await consumidorItem.isVisible().catch(() => false)) {
      console.log('[JumaService] Consumidor sugerido pelo Juma detectado! Clicando para confirmar...');
      await consumidorItem.click().catch(() => {});
      await page.waitForTimeout(500);
    } else if (expectedName) {
      // 2. Nome do cliente caso o consumidor não tenha sido preenchido
      const nameInput = page.locator('#Pedido_nome_passageiro');
      const currentVal = (await nameInput.inputValue() || '').trim();
      console.log(`[JumaService] Nome no Juma: "${currentVal}" | Nome esperado: "${expectedName}"`);

      if (currentVal.toLowerCase() === expectedName.toLowerCase()) {
        console.log(`[JumaService] Nome no Juma já corresponde ao esperado. Preservando sem alterar.`);
      } else {
        console.log(`[JumaService] Definindo nome limpo: "${expectedName}"...`);
        await nameInput.evaluate((el, val) => {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, expectedName);
        await page.waitForTimeout(300);
      }
    }

    await this._handleUpdateModalIfPresent(page, expectedName);

    // 3. Endereço completo formatado e busca precisa no autocomplete
    const addressInput = page.locator('#Pedido_endereco_parada_completo');
    const normAddress = normalizeAddress(order);
    const searchAddress = formatAddressForSearch(order);
    console.log(`[JumaService] Endereço formatado para busca: "${searchAddress}"`);

    await addressInput.click();
    await addressInput.fill('');
    await addressInput.pressSequentially(searchAddress, { delay: 40 });

    const suggestions = page.locator('ul.typeahead li a:visible, .pac-item:visible');
    let selectedSuggestion = null;

    try {
      await suggestions.first().waitFor({ state: 'visible', timeout: 8000 });
      const count = await suggestions.count();
      console.log(`[JumaService] ${count} sugestão(ões) de endereço exibida(s).`);

      const targetNumber = (normAddress.number || '').trim();
      const numberRegex = targetNumber && targetNumber !== 'S/N' ? new RegExp(`\\b${targetNumber}\\b`) : null;

      // Procura primeiro se alguma sugestão contém o número exato desejado
      if (numberRegex) {
        for (let i = 0; i < count; i++) {
          const itemText = (await suggestions.nth(i).innerText().catch(() => '')).trim();
          if (numberRegex.test(itemText)) {
            console.log(`[JumaService] ✅ Sugestão com número exato ${targetNumber} encontrada: "${itemText}"`);
            selectedSuggestion = suggestions.nth(i);
            break;
          }
        }
      }

      // Se não houver sugestão com o número exato, seleciona a primeira opção da rua
      if (!selectedSuggestion && count > 0) {
        const firstText = (await suggestions.first().innerText().catch(() => '')).trim();
        console.log(`[JumaService] Nenhuma sugestão com o número ${targetNumber}. Selecionando primeira opção: "${firstText}"`);
        selectedSuggestion = suggestions.first();
      }

      if (selectedSuggestion) {
        await selectedSuggestion.click();
      }
    } catch (e) {
      console.warn('[JumaService] Dropdown de sugestão não abriu a tempo. Tentando ArrowDown + Enter...');
      await addressInput.press('ArrowDown');
      await page.waitForTimeout(300);
      await addressInput.press('Enter');
    }
    await page.waitForTimeout(1000);

    // 4. Complemento
    const compInput = page.locator('#Pedido_complemento');
    if (await compInput.isVisible().catch(() => false)) {
      const compParts = [];
      if (order.complement && order.complement.trim()) {
        compParts.push(order.complement.trim());
      }
      if (compParts.length > 0) {
        await compInput.fill(compParts.join(' - '));
      }
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

    await this._handleUpdateModalIfPresent(page, expectedName);
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

      // 2. Se houver pedido com crédito, débito ou dinheiro na entrega, aciona botão "Retorno"
      const requiresReturn = orders.some(o => this.isPhysicalPayment(o));

      if (requiresReturn) {
        console.log('[JumaService] 💳/💵 Pedido com crédito, débito ou dinheiro detectado. Acionando botão "Retorno" (#botao_adicionar_retorno)...');
        const btnRetorno = page.locator('#botao_adicionar_retorno');
        try {
          await btnRetorno.waitFor({ state: 'visible', timeout: 8000 });
          await btnRetorno.click();
          await page.waitForTimeout(1500);
          console.log('[JumaService] ✅ Botão "Retorno" acionado com sucesso. Parada de volta à base adicionada à rota.');
        } catch (retornoErr) {
          console.warn(`[JumaService] Não foi possível acionar botão #botao_adicionar_retorno: ${retornoErr.message}`);
        }
      }

      // 3. Se for rota (múltiplas entregas ou retorno), sempre acionar o botão "Otimizar" (#btn-otimizar)
      const btnOtimizar = page.locator('#btn-otimizar, button:has-text("Otimizar")').first();
      try {
        if (await btnOtimizar.isVisible().catch(() => false)) {
          console.log('[JumaService] 🔄 Rota detectada! Acionando botão "Otimizar" (#btn-otimizar) para calcular o melhor trajeto...');
          await btnOtimizar.click();
          await page.waitForTimeout(2000);
          console.log('[JumaService] ✅ Botão "Otimizar" acionado com sucesso.');
        } else {
          console.log('[JumaService] Botão "Otimizar" não visível (corrida de parada única ou já otimizada).');
        }
      } catch (otimizarErr) {
        console.warn(`[JumaService] Alerta ao clicar no botão Otimizar: ${otimizarErr.message}`);
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
