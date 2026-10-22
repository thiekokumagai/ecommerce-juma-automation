const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const AUTH_DIR = path.join(__dirname, '..', '.auth');
const SESSION_FILE = path.join(AUTH_DIR, 'juma-session.json');

function sanitizePhone(rawPhone) {
  let digits = (rawPhone || '').replace(/\D/g, '');
  // Remove 55 se vier com DDI Brasil (12 ou 13 dígitos)
  if (digits.startsWith('55') && digits.length > 11) {
    digits = digits.substring(2);
  }
  return digits;
}

async function testFullFill() {
  console.log('--- TESTANDO PREENCHIMENTO COMPLETO APERFEIÇOADO ---');

  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({ storageState: SESSION_FILE, viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  try {
    await page.goto('https://app.jumaentregas.com/solicitacao/gestaoPedido', { waitUntil: 'networkidle' });
    await page.locator('#info-parada_btn').click();
    await page.waitForTimeout(1500);

    // Dados de teste realistas
    const mockOrder = {
      orderNumber: 12345,
      customerName: 'Lucas Oliveira',
      customerPhone: '+55 67 99123-4567',
      street: 'Rua Opala',
      number: '4',
      neighborhood: 'Coopharadio',
      city: 'Campo Grande',
      complement: 'Casa 2 portão branco',
      observation: 'Interfone não funciona',
      paymentMethod: 'PIX',
      paymentStatus: 'PAID',
      paymentType: 'Online',
      totalOrder: 120.0
    };

    // 1. Telefone do Cliente
    const cleanPhone = sanitizePhone(mockOrder.customerPhone);
    console.log(`Preenchendo telefone limpo: ${cleanPhone} (original: ${mockOrder.customerPhone})`);
    const phoneInput = page.locator('#Pedido_telefone_passageiro');
    await phoneInput.click();
    await phoneInput.fill('');
    await phoneInput.pressSequentially(cleanPhone, { delay: 40 });
    await page.waitForTimeout(500);

    // 2. Nome do Cliente
    console.log(`Preenchendo nome: ${mockOrder.customerName}`);
    const nameInput = page.locator('#Pedido_nome_passageiro');
    await nameInput.click();
    await nameInput.fill('');
    await nameInput.pressSequentially(mockOrder.customerName, { delay: 30 });
    await page.waitForTimeout(500);

    // 3. Endereço completo com clique em sugestão do autocomplete
    const searchAddress = `${mockOrder.street}, ${mockOrder.number}, ${mockOrder.neighborhood}, ${mockOrder.city}`;
    console.log(`Buscando endereço: ${searchAddress}`);
    const addressInput = page.locator('#Pedido_endereco_parada_completo');
    await addressInput.click();
    await addressInput.fill('');
    await addressInput.pressSequentially(searchAddress, { delay: 60 });

    // Aguardar o dropdown typeahead de sugestão aparecer
    const suggestionLocator = page.locator('ul.typeahead.drop-autocomplete li a, .pac-item').first();
    try {
      await suggestionLocator.waitFor({ state: 'visible', timeout: 5000 });
      console.log(`Sugestão encontrada: "${await suggestionLocator.innerText()}". Clicando...`);
      await suggestionLocator.click();
    } catch (e) {
      console.warn('Timeout aguardando sugestão. Tentando ArrowDown + Enter...');
      await addressInput.press('ArrowDown');
      await page.waitForTimeout(300);
      await addressInput.press('Enter');
    }
    await page.waitForTimeout(1500);

    // 4. Complemento
    if (mockOrder.complement) {
      console.log(`Preenchendo complemento: ${mockOrder.complement}`);
      const compInput = page.locator('#Pedido_complemento');
      if (await compInput.isVisible()) {
        await compInput.fill(mockOrder.complement);
      }
    }

    // 5. Número do pedido
    console.log(`Preenchendo número do pedido: ${mockOrder.orderNumber}`);
    const idExternoInput = page.locator('#Pedido_id_externo');
    await idExternoInput.fill(String(mockOrder.orderNumber));

    // 6. Valor a cobrar (PIX = vazio)
    const valorInput = page.locator('#Pedido_total_cobrado');
    await valorInput.fill('');

    // 7. Observação
    const obsInput = page.locator('#Pedido_observacao_pos_aceite');
    await obsInput.fill(mockOrder.observation);

    await page.waitForTimeout(1000);

    const btnAvancar = page.locator('#botao_confirmar_parada');
    const classes = await btnAvancar.getAttribute('class');
    const isReady = !classes.includes('opacity');
    console.log(`\nStatus final do botão Avançar: classes="${classes}", Liberado=${isReady}`);

    const screenshotPath = path.join(AUTH_DIR, 'perfect-fill-result.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 Screenshot salvo em: ${screenshotPath}`);

  } finally {
    await browser.close();
  }
}

testFullFill();
