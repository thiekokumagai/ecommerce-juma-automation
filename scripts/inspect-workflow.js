const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const AUTH_DIR = path.join(__dirname, '..', '.auth');
const SESSION_FILE = path.join(AUTH_DIR, 'juma-session.json');

async function inspectFullWorkflow() {
  console.log('--- INSPECIONANDO FLUXO COMPLETO E BOTÕES DE CHAMAR MOTOBOY ---');

  const browser = await chromium.launch({ headless: false, slowMo: 150 });
  const context = await browser.newContext({ storageState: SESSION_FILE, viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  try {
    await page.goto('https://app.jumaentregas.com/solicitacao/gestaoPedido', { waitUntil: 'networkidle' });

    // Inspecionar todos os botões e formulários da página inteira ANTES de abrir a parada
    const initialButtons = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a.button, a.btn')).map(b => ({
        tag: b.tagName.toLowerCase(),
        id: b.id || null,
        className: b.className || null,
        text: (b.innerText || b.textContent || b.value || '').trim().replace(/\s+/g, ' '),
        isVisible: b.offsetWidth > 0 && b.offsetHeight > 0
      }));
    });

    console.log('Todos os botões da tela inicial de Gestão de Pedidos:');
    console.log(JSON.stringify(initialButtons, null, 2));

    // Agora abrir a parada
    await page.locator('#info-parada_btn').click();
    await page.waitForTimeout(1000);

    // Inspecionar se há botões como "Solicitar", "Chamar", "Confirmar", "Finalizar"
    const buttonsInForm = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('button, input[type="submit"], a.button, a.btn'));
      return all.map(b => ({
        id: b.id || null,
        className: b.className || null,
        text: (b.innerText || b.value || '').trim().replace(/\s+/g, ' '),
        isVisible: b.offsetWidth > 0 && b.offsetHeight > 0
      }));
    });

    console.log('\nBotões enquanto formulário está aberto:');
    console.log(JSON.stringify(buttonsInForm, null, 2));

  } finally {
    await browser.close();
  }
}

inspectFullWorkflow();
