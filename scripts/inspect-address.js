const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const AUTH_DIR = path.join(__dirname, '..', '.auth');
const SESSION_FILE = path.join(AUTH_DIR, 'juma-session.json');

async function inspectAddressDropdown() {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({ storageState: SESSION_FILE, viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  try {
    await page.goto('https://app.jumaentregas.com/solicitacao/gestaoPedido', { waitUntil: 'networkidle' });
    await page.locator('#info-parada_btn').click();
    await page.waitForTimeout(1500);

    const addressInput = page.locator('#Pedido_endereco_parada_completo');
    await addressInput.click();
    await addressInput.pressSequentially('Rua Opala, 4, Coopharadio, Campo Grande', { delay: 50 });
    await page.waitForTimeout(2000);

    // Inspecionar todos os elementos visíveis próximos ou abaixo do input de endereço
    const dropdownElements = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      return all
        .filter(el => {
          const text = (el.innerText || '').trim();
          return (text.includes('Rua Opala') || text.includes('Sugestões') || text.includes('powered by Google')) && el.offsetWidth > 0;
        })
        .map(el => ({
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          className: el.className || null,
          text: (el.innerText || '').substring(0, 100),
          childrenCount: el.children.length
        }));
    });

    console.log('Elementos do dropdown de endereço:');
    console.log(JSON.stringify(dropdownElements, null, 2));

    // Testar clicar no item da sugestão
    const suggestionItem = page.locator('div:has-text("Rua Opala"), li:has-text("Rua Opala"), p:has-text("Rua Opala")').last();
    console.log(`Tentando clicar na sugestão encontrada... count: ${await suggestionItem.count()}`);
    if (await suggestionItem.count() > 0) {
      await suggestionItem.click();
      await page.waitForTimeout(2000);
      console.log('Sugestão clicada!');
    }

    // Verificar se o botão Avançar foi liberado (se mudou a classe opacity ou disabled)
    const btnAvancar = page.locator('#botao_confirmar_parada');
    console.log('Classes do botão avançar após clique na sugestão:', await btnAvancar.getAttribute('class'));
    console.log('Botão avançar está visível/habilitado?', await btnAvancar.isVisible(), !(await btnAvancar.getAttribute('class')).includes('opacity'));

    await page.screenshot({ path: path.join(AUTH_DIR, 'after-suggestion-click.png'), fullPage: true });

  } finally {
    await browser.close();
  }
}

inspectAddressDropdown();
