const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

function getSessionPath() {
  if (process.env.JUMA_SESSION_PATH) {
    return path.resolve(process.env.JUMA_SESSION_PATH);
  }

  // Tenta obter diretório userData do Electron se disponível
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), '.auth', 'juma-session.json');
    }
  } catch (e) {}

  // Se executando dentro de pacote empacotado (.asar) ou como app instalado
  const isPackaged = __dirname.includes('.asar') || process.resourcesPath;
  if (isPackaged && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'juma-automation', '.auth', 'juma-session.json');
  }

  // Fallback padrão para ambiente de desenvolvimento local
  return path.resolve(__dirname, '../../.auth/juma-session.json');
}

module.exports = {
  // Juma
  juma: {
    login: (process.env.JUMA_LOGIN || process.env.juma_login || '').trim(),
    password: (process.env.JUMA_PASSWORD || process.env.juma_senha || process.env.jsenha || '').trim(),
    headless: process.env.JUMA_HEADLESS === 'true',
    sessionPath: getSessionPath(),
    appUrl: process.env.JUMA_APP_URL || 'https://app.jumaentregas.com/solicitacao/gestaoPedido',
  },

  // Pod & Mais API
  api: {
    baseUrl: process.env.PODEMAIS_API_URL || 'http://localhost:3000',
    socketUrl: process.env.PODEMAIS_SOCKET_URL || process.env.PODEMAIS_API_URL || 'http://localhost:3000',
    email: process.env.PODEMAIS_API_EMAIL || '',
    password: process.env.PODEMAIS_API_PASSWORD || '',
    pollIntervalMs: parseInt(process.env.PODEMAIS_POLL_INTERVAL_MS || '60000', 10), // 60 segundos
  },

  // Fila e Agrupamento
  queue: {
    groupingWindowMinutes: parseInt(process.env.QUEUE_GROUPING_WINDOW_MINUTES || '20', 10),
    maxOrdersPerRoute: parseInt(process.env.QUEUE_MAX_ORDERS_PER_ROUTE || '4', 10),
    maxDetourMinutes: parseInt(process.env.MAX_DETOUR_MINUTES || '15', 10),
    storeOriginAddress: process.env.STORE_ORIGIN_ADDRESS || 'Rua Pod & Mais, 100, Centro',
    maxRetries: parseInt(process.env.QUEUE_MAX_RETRIES || '3', 10),
    dryRun: process.env.DRY_RUN === 'true',
  },

  // Google Routes API
  routes: {
    apiKey: process.env.GOOGLE_ROUTES_API_KEY || '',
  },

  // Banco de Dados PostgreSQL
  database: {
    url: process.env.DATABASE_URL || '',
  }
};
