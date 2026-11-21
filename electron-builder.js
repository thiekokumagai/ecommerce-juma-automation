const fs = require('fs');
const path = require('path');

const files = ['**/*', 'icon.png', 'icon.ico'];
for (const optionalFile of ['.env', 'som.mp3', 'som.wav']) {
  if (fs.existsSync(path.join(__dirname, optionalFile))) {
    files.push(optionalFile);
  }
}

module.exports = {
  appId: 'com.podemais.jumaautomation',
  productName: 'Juma Automação',
  artifactName: 'juma-automation-setup.exe',
  files,
  publish: [
    {
      provider: 'github',
      owner: 'thiekokumagai',
      repo: 'ecommerce-juma-automation',
      releaseType: 'release',
    },
  ],
  win: {
    target: 'nsis',
    icon: 'icon.ico',
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    allowToChangeInstallationDirectory: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Juma Automação',
  },
};
