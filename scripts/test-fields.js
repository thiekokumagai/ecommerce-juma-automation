const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const AUTH_DIR = path.join(__dirname, '..', '.auth');
const SESSION_FILE = path.join(AUTH_DIR, 'juma-session.json');

async function testFormFieldBehavior() {
  console.log('--- TESTANDO COMPORTAMENTO DOS CAMPOS NO JUMA ---');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 300,
  });

  const context = await browser.newContext({
    storageState: SESSION_FILE,
    viewport: { width: 1366, height: 768 },
  });

  const page = await context.newPage();

  try {
    await page.goto('https://app.jumaentregas.com/solicitacao/gestaoPedido', { waitUntil: 'networkidle' });

    // Abrir o formulário de nova parada
    const btnNovo = page.locator('#info-parada_btn');
    await btnNovo.click();
    await page.waitForTimeout(2000);

    // Dados de teste reais de Campo Grande - MS (onde o lojista opera)
    const testPhone = '67999998888';
    const testName = 'Cliente Teste Pod e Mais';
    const testAddress = 'Rua Opala, 4, Coopharadio, Campo Grande';

    console.log('\n1. Testando campo de TELEFONE (#Pedido_telefone_passageiro)...');
    const phoneInput = page.locator('#Pedido_telefone_passageiro');
    await phoneInput.click();
    // Digita com teclado real caractere por caractere
    await phoneInput.pressSequentially(testPhone, { delay: 100 });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1500);

    console.log('Valor após digitação do telefone:', await phoneInput.inputValue());

    console.log('\n2. Testando campo de NOME (#Pedido_nome_passageiro)...');
    const nameInput = page.locator('#Pedido_nome_passageiro');
    await nameInput.click();
    await nameInput.fill('');
    await nameInput.pressSequentially(testName, { delay: 50 });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1000);

    console.log('Valor após digitação do nome:', await nameInput.inputValue());

    console.log('\n3. Testando campo de ENDEREÇO (#Pedido_endereco_parada_completo)...');
    const addressInput = page.locator('#Pedido_endereco_parada_completo');
    await addressInput.click();
    await addressInput.fill('');
    // Digita pausadamente para disparar o autocomplete do Google Places / sugestões
    await addressInput.pressSequentially(testAddress, { delay: 100 });
    await page.waitForTimeout(2500);

    // Verificar se surgiram dropdowns de sugestão (como .pac-container, .pac-item, li, ul, dropdown)
    const suggestions = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.pac-item, .pac-container, .autocomplete-suggestions, .dropdown-menu, .ui-autocomplete, [class*="suggestion"], [class*="pac-"]'));
      return items.map(el => ({
        tag: el.tagName.toLowerCase(),
        className: el.className,
        text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' '),
        isVisible: el.offsetWidth > 0 && el.offsetHeight > 0
      })).filter(s => s.isVisible);
    });

    console.log('Sugestões de endereço encontradas na tela:');
    console.log(JSON.stringify(suggestions, null, 2));

    // Se houver .pac-item visível, tentar selecionar com ArrowDown + Enter ou clique
    const pacItem = page.locator('.pac-item').first();
    if (await pacItem.count() > 0 && await pacItem.isVisible()) {
      console.log('Sugestão do Google Places (.pac-item) visível! Clicando...');
      await pacItem.click();
      await page.waitForTimeout(1500);
    } else {
      console.log('Nenhum .pac-item visível clicável diretamente. Tentando ArrowDown + Enter...');
      await addressInput.press('ArrowDown');
      await page.waitForTimeout(500);
      await addressInput.press('Enter');
      await page.waitForTimeout(1500);
    }

    console.log('Valor do campo de endereço após seleção:', await addressInput.inputValue());

    // Inspecionar se existem outros campos ocultos de latitude, longitude, número ou endereço
    const hiddenGeoFields = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="hidden"], input[id*="lat" i], input[id*="lng" i], input[id*="endereco" i], input[id*="numero" i], input[id*="bairro" i], input[id*="cidade" i]'));
      return inputs.map(i => ({
        id: i.id || null,
        name: i.name || null,
        type: i.type,
        value: i.value
      }));
    });

    console.log('\nCampos relacionados a endereço/geo/número no formulário:');
    console.log(JSON.stringify(hiddenGeoFields, null, 2));

    await page.screenshot({ path: path.join(AUTH_DIR, 'test-fill-result.png'), fullPage: true });

    console.log('\nAguardando 15 segundos para observação visual antes de fechar...');
    await page.waitForTimeout(15000);

  } finally {
    await browser.close();
  }
}

testFormFieldBehavior();
