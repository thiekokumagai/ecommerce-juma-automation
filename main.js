const { app, Tray, Menu, nativeImage, Notification, shell } = require('electron');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const AutomationOrchestrator = require('./src/orchestrator');

let tray = null;
let orchestrator = null;
let statusText = 'Iniciando...';
let lastRouteText = 'Nenhuma rota recente';
let ordersWaitingCount = 0;

// Evitar múltiplas instâncias
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// Configurar para iniciar automaticamente com o Windows
app.setLoginItemSettings({
  openAtLogin: true,
  path: process.execPath,
});

function getAppIcon() {
  const icoPath = path.join(__dirname, 'icon.ico');
  const pngPath = path.join(__dirname, 'icon.png');
  try {
    if (process.platform === 'win32' && require('fs').existsSync(icoPath)) {
      return nativeImage.createFromPath(icoPath);
    }
    return nativeImage.createFromPath(pngPath);
  } catch (e) {
    return nativeImage.createEmpty();
  }
}

function updateTray() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    { label: '🏍️ Juma Automação - Pod & Mais', enabled: false },
    { type: 'separator' },
    { label: `Status: ${statusText}`, enabled: false },
    { label: `Fila: ${ordersWaitingCount} pedido(s) aguardando`, enabled: false },
    { label: `Última Rota: ${lastRouteText}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Abrir Painel Juma no Navegador',
      click: () => {
        shell.openExternal('https://app.jumaentregas.com/');
      },
    },
    {
      label: 'Abrir Painel Pod & Mais',
      click: () => {
        shell.openExternal('https://admin.podemais.store/');
      },
    },
    { type: 'separator' },
    {
      label: 'Reiniciar Serviço',
      click: async () => {
        statusText = 'Reiniciando...';
        updateTray();
        if (orchestrator) {
          await orchestrator.stop().catch(() => {});
        }
        await startAutomation();
      },
    },
    {
      label: 'Sair',
      click: async () => {
        if (orchestrator) {
          await orchestrator.stop().catch(() => {});
        }
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip(`Pod & Mais - Juma Automação (${statusText})`);
}

function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({
      title,
      body,
      icon: path.join(__dirname, 'icon.png'),
    }).show();
  }
}

async function startAutomation() {
  try {
    statusText = 'Conectando à Pod & Mais e Juma...';
    updateTray();

    orchestrator = new AutomationOrchestrator();

    // Monitorar eventos da fila para feedback no relógio
    if (orchestrator.queueManager) {
      orchestrator.queueManager.on('order.enqueued', (item) => {
        ordersWaitingCount++;
        statusText = 'Monitorando pedidos...';
        updateTray();
      });

      orchestrator.queueManager.on('batch.locked', (orders) => {
        statusText = `Processando rota de ${orders.length} pedido(s)...`;
        updateTray();
      });
    }

    await orchestrator.start();
    statusText = 'Monitorando pedidos (Ativo)';
    updateTray();

    showNotification('Pod & Mais - Juma Automação', 'Automação iniciada com sucesso na bandeja do sistema.');
  } catch (err) {
    statusText = `Erro: ${err.message}`;
    updateTray();
    showNotification('Pod & Mais - Erro', `Falha ao iniciar automação: ${err.message}`);
  }
}

app.whenReady().then(async () => {
  const icon = getAppIcon();
  tray = new Tray(icon);
  updateTray();

  tray.on('double-click', () => {
    shell.openExternal('https://jumaentregas.com.br/painel');
  });

  await startAutomation();
});

app.on('window-all-closed', (e) => {
  // Evitar que o Electron encerre ao fechar qualquer janela auxiliar
  e.preventDefault();
});

process.on('uncaughtException', (err) => {
  console.error('[Electron] Erro não capturado:', err);
});
