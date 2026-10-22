const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const AUTH_DIR = path.join(__dirname, '..', '.auth');
const SESSION_FILE = path.join(AUTH_DIR, 'juma-session.json');

async function runInspectGestaoPedido() {
  console.log('--- INSPECIONANDO GESTÃO DE PEDIDOS NO JUMA ---');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 300,
  });

  const contextOptions = {
    viewport: { width: 1366, height: 768 },
  };

  if (fs.existsSync(SESSION_FILE)) {
    console.log(`Carregando sessão prévia de: ${SESSION_FILE}`);
    contextOptions.storageState = SESSION_FILE;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  try {
    console.log('Navegando para https://app.jumaentregas.com/solicitacao/gestaoPedido...');
    await page.goto('https://app.jumaentregas.com/solicitacao/gestaoPedido', { waitUntil: 'networkidle' });

    console.log(`URL atual: ${page.url()}`);
    console.log(`Título da página: ${await page.title()}`);

    // Screenshot da tela de gestão de pedidos
    await page.screenshot({ path: path.join(AUTH_DIR, 'gestao-pedidos-screen.png'), fullPage: true });

    // Analisar todos os botões e links da tela
    console.log('\n--- Analisando botões e links em Gestão de Pedidos ---');
    const actions = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'));
      return items.map(el => ({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.textContent || el.value || '').trim().replace(/\s+/g, ' '),
        id: el.id || null,
        className: el.className || null,
        href: el.getAttribute('href') || null,
        title: el.getAttribute('title') || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        isVisible: el.offsetWidth > 0 && el.offsetHeight > 0
      })).filter(i => i.isVisible && (i.text.length > 0 || i.ariaLabel || i.title || i.id));
    });

    console.log(`Total de ações visíveis: ${actions.length}`);
    console.log('Ações mais relevantes:');
    const interesting = actions.filter(a => 
      /novo|nova|criar|solicitar|adicionar|cadastrar|pedido|entrega|\+/i.test(a.text) ||
      /novo|nova|criar|solicitar|adicionar|cadastrar|\+/i.test(a.title || '')
    );
    console.log(JSON.stringify(interesting, null, 2));

    // Procurar botão de criação de pedido ou entrega
    const newSelectors = [
      'button:has-text("Novo Pedido")',
      'a:has-text("Novo Pedido")',
      'button:has-text("Nova Entrega")',
      'a:has-text("Nova Entrega")',
      'button:has-text("Nova Solicitação")',
      'a:has-text("Nova Solicitação")',
      'button:has-text("Novo")',
      'a:has-text("Novo")',
      'button:has-text("Adicionar")',
      'a:has-text("Adicionar")',
      '.btn-novo',
      '#btn-novo',
      'a[href*="create"]',
      'a[href*="novo"]',
      'a[href*="solicitar"]'
    ];

    let clicked = false;
    for (const sel of newSelectors) {
      const loc = page.locator(sel).first();
      if (await loc.count() > 0 && await loc.isVisible()) {
        console.log(`\nEncontrado botão de criar pedido: "${sel}" (${await loc.innerText() || await loc.getAttribute('title')}). Clicando...`);
        await loc.click();
        await page.waitForTimeout(3000);
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      console.log('Tentando localizar por ícone ou botão com "+" ou "add"...');
      const addBtn = page.locator('button:has-text("+"), a:has-text("+"), button i.material-icons:has-text("add"), button:has(.fa-plus)').first();
      if (await addBtn.count() > 0 && await addBtn.isVisible()) {
        console.log('Clicando em botão de adição (+) ...');
        await addBtn.click();
        await page.waitForTimeout(3000);
        clicked = true;
      }
    }

    console.log(`URL após tentativa de abrir formulário: ${page.url()}`);
    await page.screenshot({ path: path.join(AUTH_DIR, 'form-cadastro-screen.png'), fullPage: true });

    // Inspecionar todos os campos de formulário agora presentes na página (incluindo modais)
    console.log('\n--- Inspecionando campos de formulário (inputs, selects, textareas) ---');
    const formFields = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('input, select, textarea, [role="combobox"]'));
      return elements.map(el => {
        const id = el.id || '';
        const name = el.getAttribute('name') || '';
        const placeholder = el.getAttribute('placeholder') || '';
        const labelEl = id ? document.querySelector(`label[for="${id}"]`) : null;
        const parentLabel = el.closest('label');
        const container = el.closest('.form-group, .field, div, td, tr');
        const containerLabel = container ? container.querySelector('label')?.innerText : null;
        const computedLabel = (labelEl?.innerText || parentLabel?.innerText || containerLabel || '').trim();

        return {
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || 'text',
          id: id || null,
          name: name || null,
          placeholder: placeholder || null,
          label: computedLabel || null,
          required: el.required || el.getAttribute('aria-required') === 'true',
          disabled: el.disabled || false,
          isVisible: el.offsetWidth > 0 && el.offsetHeight > 0,
          value: el.value || null,
          className: el.className || null
        };
      });
    });

    const visibleFields = formFields.filter(f => f.isVisible);
    console.log(`Campos visíveis mapeados: ${visibleFields.length}`);
    console.log(JSON.stringify(visibleFields, null, 2));

    // Mapear também os modais presentes no DOM
    const modals = await page.evaluate(() => {
      const modalElements = Array.from(document.querySelectorAll('.modal, [role="dialog"], .dialog, .popup'));
      return modalElements.map(m => ({
        id: m.id || null,
        className: m.className || null,
        title: m.querySelector('.modal-title, h1, h2, h3, h4, h5')?.innerText?.trim() || null,
        isVisible: m.offsetWidth > 0 && m.offsetHeight > 0
      }));
    });
    console.log('\nModais encontrados:');
    console.log(JSON.stringify(modals, null, 2));

    // Salvar relatório JSON detalhado
    const report = {
      timestamp: new Date().toISOString(),
      url: page.url(),
      title: await page.title(),
      actions: actions,
      interestingActions: interesting,
      visibleFormFields: visibleFields,
      allFormFields: formFields,
      modals: modals
    };

    const outPath = path.join(AUTH_DIR, 'gestao-pedidos-mapped.json');
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`\nRelatório salvo em: ${outPath}`);

  } catch (err) {
    console.error('Erro na inspeção de pedidos:', err);
  } finally {
    console.log('Fechando navegador em 5 segundos...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

runInspectGestaoPedido();
