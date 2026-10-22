const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const isInstall = process.argv[2] !== '--remove';
const startupFolder = path.join(
  process.env.APPDATA,
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup'
);

const shortcutPath = path.join(startupFolder, 'PodEMais-Juma-Automation.lnk');
const vbsTarget = path.resolve(__dirname, '..', 'iniciar_silencioso.vbs');
const workDir = path.resolve(__dirname, '..');

if (isInstall) {
  console.log('--- Configurando Inicialização Automática com o Windows ---');
  console.log(`Pasta Startup: ${startupFolder}`);
  console.log(`Destino VBS: ${vbsTarget}`);

  const escapedShortcut = shortcutPath.replace(/\\/g, '\\\\');
  const escapedVbs = vbsTarget.replace(/\\/g, '\\\\');
  const escapedWorkDir = workDir.replace(/\\/g, '\\\\');

  const psCommand = [
    `$ws = New-Object -ComObject WScript.Shell`,
    `$shortcut = $ws.CreateShortcut('${escapedShortcut}')`,
    `$shortcut.TargetPath = 'wscript.exe'`,
    `$shortcut.Arguments = '\"${escapedVbs}\"'`,
    `$shortcut.WorkingDirectory = '${escapedWorkDir}'`,
    `$shortcut.Description = 'Pod & Mais - Automacao Juma'`,
    `$shortcut.Save()`
  ].join('; ');

  execSync(`powershell -NoProfile -Command "${psCommand}"`);

  if (fs.existsSync(shortcutPath)) {
    console.log('\n✅ [SUCESSO] Inicialização automática configurada com sucesso!');
    console.log(`O serviço iniciará silenciosamente ao ligar o computador.`);
    console.log(`Atalho: ${shortcutPath}`);
  } else {
    console.error('\n❌ [ERRO] Não foi possível criar o atalho.');
  }
} else {
  console.log('--- Removendo Inicialização Automática com o Windows ---');
  if (fs.existsSync(shortcutPath)) {
    fs.unlinkSync(shortcutPath);
    console.log('\n✅ [SUCESSO] Inicialização automática removida.');
  } else {
    console.log('\nℹ️ O atalho não existia.');
  }
}
