const AutomationOrchestrator = require('./src/orchestrator');

const orchestrator = new AutomationOrchestrator();

orchestrator.start().catch((err) => {
  console.error('[FATAL] Erro ao iniciar automação:', err);
  process.exit(1);
});

// Tratamento de encerramento gracioso (SIGINT / SIGTERM)
process.on('SIGINT', async () => {
  console.log('\nRecebido SIGINT. Encerrando serviços graciosamente...');
  await orchestrator.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nRecebido SIGTERM. Encerrando serviços graciosamente...');
  await orchestrator.stop();
  process.exit(0);
});