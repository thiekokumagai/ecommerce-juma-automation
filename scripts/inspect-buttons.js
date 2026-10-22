const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const AUTH_DIR = path.join(__dirname, '..', '.auth');
const SESSION_FILE = path.join(AUTH_DIR, 'juma-session.json');

async function inspectSubmitButtonAndOptions() {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({
    storageState: SESSION_FILE,
    viewport: { width: 1366, height: 768 }
  });
  const page = await context.newPage();

  try {
    await page.goto('https://app.jumaentregas.com/solicitacao/gestaoPedido', { waitUntil: 'networkidle' });
    
    // Clicar no botão de novo pedido para abrir o formulário
    const btnNovo = page.locator('#info-parada_btn');
    if (await btnNovo.count() > 0) {
      await btnNovo.click();
      await page.waitForTimeout(2000);
    }

    // Inspecionar todos os botões e links que estão visíveis dentro ou perto do formulário
    const formActions = await page.evaluate(() => {
      const form = document.querySelector('form, #info-parada_content, .card-parada, .info-parada, #solicitacao-form') || document.body;
      const buttons = Array.from(form.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn, a.button'));
      return buttons.map(b => ({
        tag: b.tagName.toLowerCase(),
        id: b.id || null,
        className: b.className || null,
        text: (b.innerText || b.textContent || b.value || '').trim().replace(/\s+/g, ' '),
        type: b.getAttribute('type') || null,
        isVisible: b.offsetWidth > 0 && b.offsetHeight > 0
      })).filter(b => b.isVisible);
    });

    console.log('Botões no formulário ou próximos:');
    console.log(JSON.stringify(formActions, null, 2));

    // Verificar se há elementos com texto "Juntar em rota", "Retorno", "Salvar", "Solicitar", "Cadastrar", "Confirmar"
    const relevantElements = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      return all
        .filter(el => el.children.length === 0 && el.innerText && /retorno|juntar|rota|salvar|solicitar|cadastrar|confirmar|adicionar/i.test(el.innerText))
        .map(el => ({
          tag: el.tagName.toLowerCase(),
          text: el.innerText.trim(),
          id: el.id || null,
          className: el.className || null,
          parentTag: el.parentElement?.tagName.toLowerCase() || null,
          parentId: el.parentElement?.id || null,
          parentClass: el.parentElement?.className || null,
          isVisible: el.offsetWidth > 0 && el.offsetHeight > 0
        })).filter(e => e.isVisible);
    });

    console.log('\nElementos relevantes de rota / retorno / confirmação:');
    console.log(JSON.stringify(relevantElements, null, 2));

  } finally {
    await browser.close();
  }
}

inspectSubmitButtonAndOptions();
