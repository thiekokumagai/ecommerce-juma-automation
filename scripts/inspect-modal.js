const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const AUTH_DIR = path.join(__dirname, '..', '.auth');
const SESSION_FILE = path.join(AUTH_DIR, 'juma-session.json');

async function inspectModalStructure() {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({ storageState: SESSION_FILE, viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  try {
    await page.goto('https://app.jumaentregas.com/solicitacao/gestaoPedido', { waitUntil: 'networkidle' });
    await page.locator('#info-parada_btn').click();
    await page.waitForTimeout(1000);

    const testPhone = '43996112594';
    const phoneInput = page.locator('#Pedido_telefone_passageiro');
    await phoneInput.click();
    await phoneInput.fill(testPhone);

    const nameInput = page.locator('#Pedido_nome_passageiro');
    await nameInput.click();
    await nameInput.fill('Carlos Gabriel Modificado');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1500);

    // Inspecionar o modal visível
    const modalData = await page.evaluate(() => {
      const allModals = Array.from(document.querySelectorAll('.modal, .swal2-container, .popup, div[role="dialog"]'));
      const visible = allModals.filter(m => m.offsetWidth > 0 && m.offsetHeight > 0);
      return visible.map(m => {
        const buttons = Array.from(m.querySelectorAll('button, a')).map(b => ({
          tag: b.tagName.toLowerCase(),
          id: b.id || null,
          className: b.className || null,
          text: (b.innerText || b.textContent || '').trim()
        }));
        return {
          id: m.id || null,
          className: m.className || null,
          text: (m.innerText || '').substring(0, 200),
          buttons: buttons
        };
      });
    });

    console.log('Estrutura dos Modais visíveis:');
    console.log(JSON.stringify(modalData, null, 2));

    // Testar clicar no botão de confirmação do modal
    const confirmBtn = page.locator('button:has-text("Sim, atualizar"), a:has-text("Sim, atualizar"), button:has-text("Atualizar")').first();
    if (await confirmBtn.count() > 0) {
      console.log(`Clicando no botão: "${await confirmBtn.innerText()}"...`);
      await confirmBtn.click();
      await page.waitForTimeout(1500);
      console.log('Modal fechado com sucesso!');
    }

  } finally {
    await browser.close();
  }
}

inspectModalStructure();
