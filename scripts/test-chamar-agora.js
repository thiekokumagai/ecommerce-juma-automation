const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const AUTH_DIR = path.join(__dirname, '..', '.auth');
const SESSION_FILE = path.join(AUTH_DIR, 'juma-session.json');

async function testAvancarEChamarAgora() {
  console.log('--- TESTANDO FLUXO: AVANÇAR -> CHAMAR AGORA ---');

  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({ storageState: SESSION_FILE, viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  async function handleUpdateModalIfPresent() {
    const visibleBtn = page.locator('#btn-confirmar-atualizacao, #btn-atualizar-comp, #btn-atualizar-ambos, button:has-text("Sim, atualizar")').locator('visible=true').first();
    if (await visibleBtn.count() > 0) {
      console.log('Modal de atualizar cadastro detectado! Clicando em "Sim, atualizar"...');
      await visibleBtn.click();
      await page.waitForTimeout(800);
    }
  }

  try {
    await page.goto('https://app.jumaentregas.com/solicitacao/gestaoPedido', { waitUntil: 'networkidle' });
    await page.locator('#info-parada_btn').click();
    await page.waitForTimeout(1000);

    // 1. Telefone e Nome
    const phoneInput = page.locator('#Pedido_telefone_passageiro');
    await phoneInput.click();
    await phoneInput.pressSequentially('43996112594', { delay: 30 });
    await page.waitForTimeout(1000);

    const nameInput = page.locator('#Pedido_nome_passageiro');
    const existingName = await nameInput.inputValue();
    console.log(`Nome que veio auto-preenchido: "${existingName}"`);

    if (!existingName) {
      await nameInput.fill('Carlos Gabriel');
    }

    await handleUpdateModalIfPresent();

    // 2. Endereço
    const addressInput = page.locator('#Pedido_endereco_parada_completo');
    await addressInput.click();
    await addressInput.pressSequentially('Av. Cel. Antonino, 805, Campo Grande', { delay: 40 });

    const suggestion = page.locator('ul.typeahead.drop-autocomplete li a, .pac-item').first();
    await suggestion.waitFor({ state: 'visible', timeout: 5000 });
    await suggestion.click();
    await page.waitForTimeout(1000);

    // Preencher complemento
    const compInput = page.locator('#Pedido_complemento');
    if (await compInput.isVisible()) {
      await compInput.fill('Prédio do sicoob');
    }

    // Preencher número do pedido
    await page.locator('#Pedido_id_externo').fill('65481');

    // Observação
    await page.locator('#Pedido_observacao_pos_aceite').fill('Teste automação');
    await page.waitForTimeout(1000);

    // 3. Clicar em Avançar (#botao_confirmar_parada)
    console.log('Clicando em Avançar (#botao_confirmar_parada)...');
    const btnAvancar = page.locator('#botao_confirmar_parada');
    await btnAvancar.click();
    await page.waitForTimeout(2000);

    // Tratar modal caso surja após Avançar
    await handleUpdateModalIfPresent();
    await page.waitForTimeout(2000);

    // 4. Inspecionar o botão "Chamar agora" (#btnSubmit)
    const btnChamarAgora = page.locator('#btnSubmit');
    const isChamarVisivel = await btnChamarAgora.isVisible();
    const textoChamar = isChamarVisivel ? (await btnChamarAgora.innerText()).replace(/\s+/g, ' ') : null;
    console.log(`\n🎉 Botão #btnSubmit está visível? ${isChamarVisivel} | Texto: "${textoChamar}"`);

    const screenshotPath = path.join(AUTH_DIR, 'tela-antes-de-chamar-agora.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 Screenshot salvo em: ${screenshotPath}`);

  } finally {
    await browser.close();
  }
}

testAvancarEChamarAgora();
