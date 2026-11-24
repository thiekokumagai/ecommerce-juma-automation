// Auto-update silencioso: baixa sozinho e, com a versão pronta, instala e reabre o app
// assim que ele estiver ocioso (isBusy() === false). Nenhuma caixa modal: só log e aviso na bandeja.
const RETRY_INSTALL_MS = 30 * 1000;

function createAutoUpdate({
  autoUpdater,
  app,
  isBusy = () => false,
  beforeInstall = async () => {},
  notify = () => {},
  log = console,
  retryMs = RETRY_INSTALL_MS,
  setTimeoutFn = setTimeout,
}) {
  let isChecking = false;
  let isManual = false;
  let downloadedVersion = null;
  let installTimer = null;
  let installing = false;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  function scheduleRetry() {
    installTimer = setTimeoutFn(tryInstall, retryMs);
  }

  async function tryInstall() {
    installTimer = null;
    if (installing || !downloadedVersion) return;
    if (isBusy()) {
      log.log(`[update] v${downloadedVersion} aguardando o app ficar ocioso.`);
      scheduleRetry();
      return;
    }
    installing = true;
    try {
      await beforeInstall();
    } catch (err) {
      log.error('[update] Falha ao preparar a instalação:', err && err.message ? err.message : err);
    }
    log.log(`[update] Instalando v${downloadedVersion} e reiniciando.`);
    notify('Atualizando', `Instalando a versão v${downloadedVersion}. O app volta sozinho em instantes.`);
    app.isQuiting = true;
    // isSilent: instalador NSIS sem janelas (/S); isForceRunAfter: reabre o app depois (--force-run).
    autoUpdater.quitAndInstall(true, true);
  }

  autoUpdater.on('checking-for-update', () => {
    isChecking = true;
  });

  autoUpdater.on('update-available', (info) => {
    log.log('[update] Nova versão disponível:', info && info.version);
    if (isManual) {
      isManual = false;
      notify('Atualização disponível', `Baixando a versão v${info.version}. Ela será instalada sozinha.`);
    }
  });

  autoUpdater.on('update-not-available', () => {
    isChecking = false;
    if (isManual) {
      isManual = false;
      notify('Sem atualizações', `Você já está na versão mais recente (v${app.getVersion()}).`);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    isChecking = false;
    isManual = false;
    downloadedVersion = info && info.version;
    if (!installTimer && !installing) return tryInstall();
    return undefined;
  });

  autoUpdater.on('error', (err) => {
    isChecking = false;
    log.error('[update] Erro no auto-update:', err && err.message ? err.message : err);
    if (isManual) {
      isManual = false;
      notify('Erro ao verificar atualizações', 'Verifique a internet. O app tenta de novo sozinho mais tarde.');
    }
  });

  function check(manual = false) {
    if (!app.isPackaged) {
      if (manual) notify('Modo desenvolvimento', 'A atualização só funciona na versão instalada (.exe).');
      return;
    }
    if (downloadedVersion) {
      if (manual) notify('Atualização pronta', `A versão v${downloadedVersion} será instalada quando o app estiver livre.`);
      return;
    }
    if (isChecking) return;
    isManual = manual;
    autoUpdater.checkForUpdates().catch((err) => {
      isChecking = false;
      log.error('[update] Falha na checagem de atualizações:', err && err.message ? err.message : err);
      if (isManual) {
        isManual = false;
        notify('Erro ao verificar atualizações', 'Verifique a internet. O app tenta de novo sozinho mais tarde.');
      }
    });
  }

  return { check, tryInstall };
}

module.exports = { createAutoUpdate };
