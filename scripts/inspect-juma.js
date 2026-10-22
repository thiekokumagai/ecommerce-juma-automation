const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const JUMA_LOGIN = (process.env.JUMA_LOGIN || process.env.juma_login || '').trim();
const JUMA_PASSWORD = (process.env.JUMA_PASSWORD || process.env.juma_senha || process.env.jsenha || '').trim();
const AUTH_DIR = path.join(__dirname, '..', '.auth');
const SESSION_FILE = path.join(AUTH_DIR, 'juma-session.json');

if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

async function runInspect() {
  console.log('--- INICIANDO INSPEÇÃO DO JUMA ENTREGAS ---');
  console.log(`Login: ${JUMA_LOGIN ? JUMA_LOGIN : 'NÃO DEFINIDO'}`);
  console.log(`Senha: ${JUMA_PASSWORD ? 'DEFINIDA' : 'NÃO DEFINIDA'}`);

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
    console.log('Navegando para https://app.jumaentregas.com/...');
    await page.goto('https://app.jumaentregas.com/', { waitUntil: 'networkidle' });

    console.log(`URL atual: ${page.url()}`);
    console.log(`Título: ${await page.title()}`);

    // Se estiver na tela de login
    if (page.url().includes('login') || await page.locator('#LoginForm_username').count() > 0) {
      console.log('Detectada tela de login. Efetuando autenticação...');
      
      const userInput = page.locator('#LoginForm_username');
      const passInput = page.locator('#LoginForm_password');
      const rememberCheckbox = page.locator('#LoginForm_rememberMe');
      const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("Entrar"), button:has-text("Login")').first();

      await userInput.fill(JUMA_LOGIN);
      await passInput.fill(JUMA_PASSWORD);
      
      if (await rememberCheckbox.count() > 0) {
        await rememberCheckbox.check().catch(() => {});
      }

      console.log('Submetendo formulário...');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(e => console.log('Aguardando redirecionamento após submit...')),
        submitBtn.click()
      ]);

      await page.waitForTimeout(3000);
      console.log(`URL após login: ${page.url()}`);

      // Salva sessão autenticada
      await context.storageState({ path: SESSION_FILE });
      console.log(`✅ Nova sessão salva em: ${SESSION_FILE}`);
    }

    // Tirar screenshot da tela inicial logada
    await page.screenshot({ path: path.join(AUTH_DIR, 'pos-login-dashboard.png'), fullPage: true });

    // Explorar links do menu / navegação
    console.log('\n--- Buscando rotas e seções do sistema ---');
    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a, button, [role="button"], li.nav-item')).map(el => ({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' '),
        href: el.getAttribute('href') || (el.querySelector('a') ? el.querySelector('a').getAttribute('href') : null),
        id: el.id || null,
        className: el.className || null
      })).filter(l => l.text.length > 0 && l.text.length < 50);
    });

    console.log('Opções de menu / navegação encontradas:');
    const relevantLinks = links.filter(l => 
      /entrega|pedido|nova|novo|solicitar|adicionar|criar|corrida|rota/i.test(l.text)
    );
    console.log(JSON.stringify(relevantLinks, null, 2));

    // Tentar localizar a tela de "Nova Entrega" ou "Solicitar Entrega"
    const orderSelectors = [
      'a:has-text("Nova Entrega")',
      'a:has-text("Novo Pedido")',
      'a:has-text("Solicitar Entrega")',
      'button:has-text("Nova Entrega")',
      'button:has-text("Novo Pedido")',
      'button:has-text("Solicitar Entrega")',
      'a:has-text("Criar Pedido")',
      'a:has-text("Nova")',
      'a:has-text("Entregas")',
      'a[href*="delivery"]',
      'a[href*="pedido"]',
      'a[href*="entrega"]',
      'a[href*="create"]'
    ];

    let foundTarget = false;
    for (const sel of orderSelectors) {
      const loc = page.locator(sel).first();
      if (await loc.count() > 0 && await loc.isVisible()) {
        console.log(`\nLocalizado botão/link de ação: "${sel}" (${await loc.innerText()}). Clicando...`);
        await loc.click();
        await page.waitForTimeout(3000);
        foundTarget = true;
        break;
      }
    }

    console.log(`URL na tela de entregas/formulário: ${page.url()}`);
    await page.screenshot({ path: path.join(AUTH_DIR, 'form-entrega-screenshot.png'), fullPage: true });

    // Se estiver em uma tela de listagem de entregas, verificar se há botão "Novo" ou "Adicionar"
    const subActionBtn = page.locator('button:has-text("Nova"), button:has-text("Novo"), button:has-text("Adicionar"), a:has-text("Nova"), a:has-text("Novo"), a:has-text("Adicionar"), button:has-text("+"), a:has-text("+")').first();
    if (await subActionBtn.count() > 0 && await subActionBtn.isVisible()) {
      console.log(`Botão secundário de criação encontrado: "${await subActionBtn.innerText()}". Clicando...`);
      await subActionBtn.click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: path.join(AUTH_DIR, 'form-detalhe-screenshot.png'), fullPage: true });
    }

    // Inspecionar e listar minuciosamente TODOS os campos de formulário disponíveis
    console.log('\n--- MAPEAMENTO DOS CAMPOS DO FORMULÁRIO DE ENTREGA ---');
    const formFields = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('input, select, textarea, [role="combobox"], [contenteditable="true"]'));
      return elements.map(el => {
        const id = el.id || '';
        const name = el.getAttribute('name') || '';
        const placeholder = el.getAttribute('placeholder') || '';
        const labelEl = id ? document.querySelector(`label[for="${id}"]`) : null;
        const parentLabel = el.closest('label');
        const container = el.closest('.form-group, .field, div, td');
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
    console.log(`Total de campos visíveis mapeados: ${visibleFields.length}`);
    console.log(JSON.stringify(visibleFields, null, 2));

    // Mapear botões de ação do formulário (ex: Salvar, Confirmar, Voltar, etc.)
    const buttons = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"]')).map(btn => ({
        tag: btn.tagName.toLowerCase(),
        type: btn.getAttribute('type') || 'button',
        text: (btn.innerText || btn.textContent || btn.value || '').trim(),
        id: btn.id || null,
        name: btn.getAttribute('name') || null,
        className: btn.className || null,
        disabled: btn.disabled || false,
        isVisible: btn.offsetWidth > 0 && btn.offsetHeight > 0
      })).filter(b => b.isVisible);
    });

    console.log('\nBotões de ação encontrados:');
    console.log(JSON.stringify(buttons, null, 2));

    // Salvar relatório JSON detalhado
    const fullReport = {
      timestamp: new Date().toISOString(),
      url: page.url(),
      title: await page.title(),
      menuLinks: relevantLinks,
      formFields: visibleFields,
      allFormFields: formFields,
      buttons: buttons
    };

    const reportPath = path.join(AUTH_DIR, 'juma-mapped-selectors.json');
    fs.writeFileSync(reportPath, JSON.stringify(fullReport, null, 2));
    console.log(`\n🎉 Mapeamento salvo com sucesso em: ${reportPath}`);

  } catch (err) {
    console.error('Erro na inspeção:', err);
  } finally {
    console.log('Finalizando inspeção em 5 segundos...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

runInspect();
