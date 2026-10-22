# Dockerfile para implantação no Railway / Docker
FROM mcr.microsoft.com/playwright:v1.49.0-noble

# Definir diretório de trabalho
WORKDIR /app

# Copiar manifests de dependência
COPY package*.json ./

# Instalar dependências de produção
RUN npm ci --omit=dev

# Copiar o restante da aplicação
COPY . .

# Criar pasta para sessão segura
RUN mkdir -p .auth

# Variáveis padrão
ENV NODE_ENV=production
ENV JUMA_HEADLESS=true

# Comando para iniciar o serviço
CMD ["npm", "start"]
