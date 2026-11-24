const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { createAutoUpdate } = require('../auto-update');
const AutomationOrchestrator = require('../src/orchestrator');

const ROOT = path.join(__dirname, '..');

function setup({ busy = false, beforeInstall } = {}) {
  const autoUpdater = new EventEmitter();
  autoUpdater.installs = [];
  autoUpdater.checks = 0;
  autoUpdater.quitAndInstall = (...args) => autoUpdater.installs.push(args);
  autoUpdater.checkForUpdates = () => {
    autoUpdater.checks += 1;
    return Promise.resolve();
  };
  const app = { isPackaged: true, getVersion: () => '1.0.0' };
  const state = { busy };
  const timers = [];
  const notes = [];
  createAutoUpdate({
    autoUpdater,
    app,
    isBusy: () => state.busy,
    beforeInstall,
    notify: (title, content) => notes.push({ title, content }),
    log: { log() {}, error() {} },
    setTimeoutFn: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
  });
  const downloaded = (version = '9.9.9') => autoUpdater.listeners('update-downloaded')[0]({ version });
  return { autoUpdater, app, state, timers, notes, downloaded };
}

describe('auto-update silencioso', () => {
  test('mantém download automático e instalação ao fechar', () => {
    const { autoUpdater } = setup();
    expect(autoUpdater.autoDownload).toBe(true);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
  });

  test('ocioso: para a automação, instala silencioso e reabre o app', async () => {
    const order = [];
    const { autoUpdater, app, downloaded } = setup({ beforeInstall: async () => order.push('stop') });
    autoUpdater.quitAndInstall = (...args) => order.push(['install', ...args]);
    await downloaded();
    expect(order).toEqual(['stop', ['install', true, true]]);
    expect(app.isQuiting).toBe(true);
  });

  test('ocupado: espera e só instala quando a tarefa da fila termina', async () => {
    const { autoUpdater, state, timers, downloaded } = setup({ busy: true });
    await downloaded();
    expect(autoUpdater.installs).toHaveLength(0);
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(30000);

    await timers.shift().fn();
    expect(autoUpdater.installs).toHaveLength(0);

    state.busy = false;
    await timers.shift().fn();
    expect(autoUpdater.installs).toEqual([[true, true]]);
  });

  test('erro não instala e só avisa quando a checagem foi manual', () => {
    const { autoUpdater, notes } = setup();
    autoUpdater.emit('error', new Error('offline'));
    expect(notes).toHaveLength(0);
    expect(autoUpdater.installs).toHaveLength(0);
  });

  test('nenhuma caixa modal no fluxo de atualização', () => {
    const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    expect(main).not.toMatch(/autoUpdater\.on\(/);
    expect(main).not.toMatch(/showMessageBox/);
    const mod = fs.readFileSync(path.join(ROOT, 'auto-update.js'), 'utf8');
    expect(mod).not.toMatch(/dialog|showMessageBox/);
  });
});

describe('orchestrator.isBusy (sinal usado pelo auto-update)', () => {
  function makeOrchestrator(registerRouteBatch) {
    const queueManager = new EventEmitter();
    queueManager.isEvaluating = false;
    return new AutomationOrchestrator({
      apiClient: { updateOrderStatus: async () => {} },
      socketClient: {},
      queueRepo: { markAsRegistered: async () => {}, markAsFailed: async () => {} },
      routeOptimizer: {},
      queueManager,
      jumaService: { registerRouteBatch },
    });
  }

  test('fica ocupado durante o cadastro do lote no Juma e livre depois, mesmo com falha', async () => {
    let release;
    const orchestrator = makeOrchestrator(() => new Promise((resolve) => { release = resolve; }));
    expect(orchestrator.isBusy()).toBe(false);
    const running = orchestrator.processBatch([{ id: 'a', orderNumber: 1 }]);
    expect(orchestrator.isBusy()).toBe(true);
    release({ jumaDeliveryId: 'J1', dryRun: true });
    await running;
    expect(orchestrator.isBusy()).toBe(false);

    const failing = makeOrchestrator(async () => { throw new Error('juma fora'); });
    await failing.processBatch([{ id: 'b', orderNumber: 2 }]);
    expect(failing.isBusy()).toBe(false);
  });

  test('fica ocupado enquanto a fila avalia e trava pedidos', () => {
    const orchestrator = makeOrchestrator(async () => ({}));
    orchestrator.queueManager.isEvaluating = true;
    expect(orchestrator.isBusy()).toBe(true);
  });
});

describe('intervalo de checagem', () => {
  test('checa atualização a cada 20 minutos e também logo ao abrir o app', () => {
    const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const m = src.match(/const UPDATE_CHECK_INTERVAL_MS = ([^;]+);/);
    expect(Boolean(m)).toBe(true);
    expect(Function(`return (${m[1]})`)()).toBe(20 * 60 * 1000);
    expect(src).toMatch(/setInterval\(\(\) => checkForUpdates\(false\), UPDATE_CHECK_INTERVAL_MS\)/);
    expect(src).toMatch(/setTimeout\(\(\) => checkForUpdates\(false\), 10000\)/);
  });
});
