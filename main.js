const { app, Tray, Menu, nativeImage, Notification, shell, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const AutomationOrchestrator = require('./src/orchestrator');

let tray = null;
let orchestrator = null;
let audioPlayerWindow = null;
let statusText = 'Iniciando...';
let lastRouteText = 'Nenhuma rota recente';
let ordersWaitingCount = 0;

// Garantir que a sessão do Juma fique na pasta de dados do usuário (%APPDATA%/juma-automation)
if (app && typeof app.getPath === 'function') {
  const userDataAuthDir = path.join(app.getPath('userData'), '.auth');
  const userDataSessionFile = path.join(userDataAuthDir, 'juma-session.json');
  process.env.JUMA_SESSION_PATH = userDataSessionFile;

  // Se já existir sessão na pasta do projeto, copia para userData caso ainda não exista
  try {
    const localSessionFile = path.join(__dirname, '.auth', 'juma-session.json');
    if (!fs.existsSync(userDataSessionFile) && fs.existsSync(localSessionFile)) {
      if (!fs.existsSync(userDataAuthDir)) fs.mkdirSync(userDataAuthDir, { recursive: true });
      fs.copyFileSync(localSessionFile, userDataSessionFile);
    }
  } catch (copyErr) {}
}

// Permitir reprodução de áudio sem exigir clique na janela
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Evitar múltiplas instâncias
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// Identificador do App para notificações no Windows 10/11 mesmo sem instalador
if (process.platform === 'win32') {
  app.setAppUserModelId('com.podemais.jumaautomation');
}

// Configurar para iniciar automaticamente com o Windows
app.setLoginItemSettings({
  openAtLogin: true,
  path: process.execPath,
});

function getSoundSearchPaths() {
  const customEnvSound = process.env.ALERT_SOUND_PATH;
  return [
    customEnvSound,
    // Pasta onde fica o executável instalado (.exe)
    path.join(path.dirname(process.execPath), 'som.mp3'),
    path.join(path.dirname(process.execPath), 'som.wav'),
    // Pasta de dados persistente do usuário (%APPDATA%/juma-automation)
    path.join(app.getPath('userData'), 'som.mp3'),
    path.join(app.getPath('userData'), 'som.wav'),
    // Pasta local do projeto / código
    path.join(__dirname, 'som.mp3'),
    path.join(__dirname, 'som.wav'),
    path.join(process.resourcesPath || '', 'som.mp3'),
    path.join(process.resourcesPath || '', 'som.wav'),
  ].filter(Boolean);
}

function findSoundFile() {
  const paths = getSoundSearchPaths();
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (e) {}
  }
  return null;
}

function initAudioPlayer() {
  if (!audioPlayerWindow || audioPlayerWindow.isDestroyed()) {
    audioPlayerWindow = new BrowserWindow({
      show: false,
      width: 0,
      height: 0,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false,
        backgroundThrottling: false,
      },
    });
    audioPlayerWindow.loadURL('about:blank');
  }
}

function playAlertSound() {
  const soundFile = findSoundFile();

  if (soundFile) {
    try {
      initAudioPlayer();

      const ext = path.extname(soundFile).toLowerCase().replace('.', '');
      const mime = ext === 'wav' ? 'audio/wav' : 'audio/mpeg';
      const audioBuffer = fs.readFileSync(soundFile);
      const dataUrl = `data:${mime};base64,${audioBuffer.toString('base64')}`;

      // Usa função auto-executável para isolar escopo e permitir tocar repetidamente
      audioPlayerWindow.webContents.executeJavaScript(`
        (() => {
          try {
            const player = new Audio(${JSON.stringify(dataUrl)});
            player.volume = 1.0;
            player.play().catch(e => console.error('[Audio] Erro ao tocar:', e));
          } catch (err) {
            console.error('[Audio] Erro no script:', err);
          }
        })();
      `).catch(err => {
        console.error('[Audio] Erro ao executar JS de áudio:', err);
        try { shell.beep(); } catch (e) {}
      });
      return;
    } catch (err) {
      console.error('[Audio] Erro ao instanciar player de som:', err);
    }
  }

  // Fallback padrão: som do sistema Windows
  try {
    shell.beep();
  } catch (e) {}
}

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

  const customSound = findSoundFile();
  const soundLabel = customSound ? `🔊 Som: ${path.basename(customSound)}` : '🔊 Som: Padrão do Windows';

  const contextMenu = Menu.buildFromTemplate([
    { label: '🏍️ Juma Automação - Pod & Mais', enabled: false },
    { type: 'separator' },
    { label: `Status: ${statusText}`, enabled: false },
    { label: `Fila: ${ordersWaitingCount} pedido(s) aguardando`, enabled: false },
    { label: `Última Rota: ${lastRouteText}`, enabled: false },
    { label: soundLabel, enabled: false },
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
    {
      label: '🔔 Testar Aviso Sonoro e Notificação',
      click: () => {
        showNotification(
          '🏍️ Teste: Juma Solicitado com Sucesso!',
          'Este é um teste do aviso sonoro e notificação.\nRota: Pedidos #101, #102 (Cód: TESTE-123)',
          'https://app.jumaentregas.com/solicitacao/gestaoPedido'
        );
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

function showNotification(title, body, url = null) {
  playAlertSound();

  if (Notification.isSupported()) {
    const notif = new Notification({
      title,
      body,
      icon: path.join(__dirname, 'icon.png'),
      silent: true, // Já tocamos o som via playAlertSound() para não sobrepor
    });

    if (url) {
      notif.on('click', () => {
        shell.openExternal(url);
      });
    }

    notif.show();
  }
}

async function refreshQueueCount() {
  if (orchestrator && orchestrator.queueRepo) {
    try {
      ordersWaitingCount = await orchestrator.queueRepo.getWaitingCount();
      updateTray();
    } catch (e) {
      // Ignora erro eventual ao buscar contagem
    }
  }
}

async function startAutomation() {
  try {
    statusText = 'Conectando à Pod & Mais e Juma...';
    updateTray();

    orchestrator = new AutomationOrchestrator();

    // Monitorar eventos da fila para feedback no relógio
    if (orchestrator.queueManager) {
      orchestrator.queueManager.on('order.enqueued', async () => {
        await refreshQueueCount();
        statusText = 'Monitorando pedidos...';
        updateTray();
      });

      orchestrator.queueManager.on('order.removed', async () => {
        await refreshQueueCount();
        updateTray();
      });

      orchestrator.queueManager.on('batch.locked', async (orders) => {
        await refreshQueueCount();
        statusText = `Solicitando Juma para ${orders.length} pedido(s)...`;
        updateTray();
      });

      orchestrator.queueManager.on('batch.dispatched', async ({ orders, jumaDeliveryId, orderNumbersStr, dryRun }) => {
        await refreshQueueCount();
        const refs = orderNumbersStr || orders.map(o => `#${o.orderNumber || o.id}`).join(', ');
        const jumaRef = jumaDeliveryId ? `ID Juma: ${jumaDeliveryId}` : 'Confirmado';
        lastRouteText = `${refs} (${jumaDeliveryId || 'OK'})`;
        statusText = 'Monitorando pedidos (Ativo)';
        updateTray();

        const title = dryRun ? '🏍️ Juma [Simulação Dry Run]' : '🏍️ Juma Solicitado com Sucesso!';
        const body = `${orders.length} pedido(s) em rota: ${refs}\n${jumaRef}`;
        showNotification(title, body, 'https://app.jumaentregas.com/solicitacao/gestaoPedido');
      });

      orchestrator.queueManager.on('batch.failed', async ({ orders, orderNumbersStr, error } = {}) => {
        await refreshQueueCount();
        statusText = '⚠️ Falha ao solicitar Juma';
        updateTray();

        const refs = orderNumbersStr || (orders ? orders.map(o => `#${o.orderNumber || o.id}`).join(', ') : 'Lote');
        const errMessage = error?.message || error || 'Erro de comunicação';
        showNotification(
          '⚠️ Falha ao Solicitar Juma',
          `Não foi possível acionar motoboy para: ${refs}\nMotivo: ${errMessage}`,
          'https://app.jumaentregas.com/solicitacao/gestaoPedido'
        );
      });
    }

    await orchestrator.start();
    await refreshQueueCount();
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
  initAudioPlayer();
  const icon = getAppIcon();
  tray = new Tray(icon);
  updateTray();

  tray.on('double-click', () => {
    shell.openExternal('https://app.jumaentregas.com/');
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
