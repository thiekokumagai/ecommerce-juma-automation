const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const AUTH_DIR = path.join(__dirname, '..', '.auth');
const SESSION_FILE = path.join(AUTH_DIR, 'juma-session.json');

async function inspectPostParadaFlow() {
  console.log('--- INSPECIONANDO MODAIS E FLUXO PÓS-AVANÇAR NO JUMA ---');

  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({ storageState: SESSION_FILE, viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  try {
    await page.goto('https://app.jumaentregas.com/solicitacao/gestaoPedido', { waitUntil: 'networkidle' });
    await page.locator('#info-parada_btn').click();
    await page.waitForTimeout(1500);

    // 1. Simular o preenchimento de um telefone já existente para reproduzir o modal
    const testPhone = '43996112594'; // Telefone do print do usuário
    const phoneInput = page.locator('#Pedido_telefone_passageiro');
    await phoneInput.click();
    await phoneInput.fill('');
    await phoneInput.pressSequentially(testPhone, { delay: 40 });
    await page.waitForTimeout(1500);

    const nameInput = page.locator('#Pedido_nome_passageiro');
    const autoFilledName = await nameInput.inputValue();
    console.log(`Nome que veio auto-preenchido pelo Juma: "${autoFilledName}"`);

    // Preencher nome limpando totalmente antes
    await nameInput.click();
    await nameInput.fill('');
    await nameInput.pressSequentially('Carlos Gabriel', { delay: 30 });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1000);

    // Verificar se o modal apareceu
    const modalConfirmUpdate = page.locator('button:has-text("Sim, atualizar"), button:has-text("Sim"), .swal2-confirm, .modal button.primary');
    console.log(`Modal de confirmação visível? Count: ${await modalConfirmUpdate.count()}`);
    if (await modalConfirmUpdate.count() > 0 && await modalConfirmUpdate.first().isVisible()) {
      console.log('Modal detectado! Clicando em "Sim, atualizar"...');
      await modalConfirmUpdate.first().click();
      await page.waitForTimeout(1000);
    }

    // Endereço
    const addressInput = page.locator('#Pedido_endereco_parada_completo');
    await addressInput.click();
    await addressInput.fill('');
    await addressInput.pressSequentially('Av. Cel. Antonino, 805, Campo Grande', { delay: 50 });

    const suggestion = page.locator('ul.typeahead.drop-autocomplete li a, .pac-item').first();
    await suggestion.waitFor({ state: 'visible', timeout: 5000 });
    await suggestion.click();
    await page.waitForTimeout(1500);

    // Inspecionar todos os botões da tela antes e depois de clicar em Avançar
    console.log('\n--- Clicando em Avançar (#botao_confirmar_parada) ---');
    const btnAvancar = page.locator('#botao_confirmar_parada');
    await btnAvancar.click();
    await page.waitForTimeout(3000);

    // Tirar screenshot da tela após clicar em Avançar
    const screenPostAvancar = path.join(AUTH_DIR, 'screen-post-avancar.png');
    await page.screenshot({ path: screenPostAvancar, fullPage: true });
    console.log(`📸 Screenshot salvo em: ${screenPostAvancar}`);

    // Inspecionar novos botões e ações visíveis na tela (como "Solicitar motoboy", "Chamar", etc.)
    const currentActions = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a, input[type="submit"], input[type="button"], [role="button"]'));
      return btns.map(b => ({
        tag: b.tagName.toLowerCase(),
        id: b.id || null,
        className: b.className || null,
        text: (b.innerText || b.textContent || b.value || '').trim().replace(/\s+/g, ' '),
        isVisible: b.offsetWidth > 0 && b.offsetHeight > 0
      })).filter(b => b.isVisible && b.text.length > 0);
    });

    console.log('Ações visíveis após adicionar a parada:');
    console.log(JSON.stringify(currentActions, null, 2));

  } finally {
    await browser.close();
  }
}

inspectPostParadaFlow();
