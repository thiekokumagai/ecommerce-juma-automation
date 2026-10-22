# ecommerce-juma-automation

Serviço autônomo de integração entre a plataforma de e-commerce **Pod & Mais** e o sistema de entregas **Juma**, com automação de navegador via Playwright, fila persistente e agrupamento inteligente de pedidos por rota (Google Routes API).

---

## 🚀 Funcionalidades

1. **Monitoramento em Tempo Real**:
   - Escuta eventos `order.updated` via WebSocket (Socket.IO).
   - Identifica pedidos cujo status mudou para `CONFIRMED` ("Separado").
   - Polling de contingência periódica (`GET /orders?status=CONFIRMED`) para evitar perda de pedidos durante quedas de conexão.

2. **Fila Persistente e Janela de Agrupamento de 20 Minutos**:
   - Fila persistida no PostgreSQL (com fallback em memória para testes).
   - Sobrevive a reinicializações sem perda de estado.
   - Janela de até 20 minutos iniciada no primeiro pedido do lote, agrupando novos pedidos que chegarem enquanto a janela estiver aberta.
   - Bloqueio concorrente (locks atômicos) para impedir processamento simultâneo do mesmo pedido.

3. **Agrupamento Inteligente por Rota (Google Routes API)**:
   - Partida da localização de origem da loja (`STORE_ORIGIN_ADDRESS`).
   - Cálculo de itinerários ótimos considerando tráfego em tempo real.
   - Avaliação de desvio máximo tolerável (`MAX_DETOUR_MINUTES`).
   - Pedidos com pagamento em cartão na entrega acionam cálculo automático de retorno à base para devolução da maquininha.

4. **Automação do Juma com Playwright**:
   - Sessão segura e isolada do Google Chrome pessoal do operador (`.auth/juma-session.json`).
   - Seletores mapeados com exatidão da interface real de `https://app.jumaentregas.com/solicitacao/gestaoPedido`.
   - Preenchimento inteligente de pagamento:
     - **PIX Online / Pago**: Campo de valor a cobrar mantido vazio.
     - **Cartão na Entrega**: Preenche o valor a cobrar e sinaliza maquininha na observação.
     - **Dinheiro na Entrega**: Preenche o valor a cobrar e calcula nota de troco na observação quando aplicável.
   - Prevenção contra cadastros duplicados: em caso de timeout pós-submit, o sistema verifica a tela antes de qualquer retentativa e encaminha para reconciliação manual caso o resultado seja indeterminado.

5. **Confirmação e Atualização de Status**:
   - Somente após confirmação explícita de cadastro no Juma, o pedido é atualizado para `DISPATCHED` ("Enviado") na API da Pod & Mais (`PATCH /orders/:id/status`).

---

## 🛠️ Variáveis de Ambiente (`.env`)

Crie o arquivo `.env` baseado no `.env.example`:

```env
# Credenciais do Juma
JUMA_LOGIN=podemais@jumaentregas.com.br
JUMA_PASSWORD=suasenha
JUMA_HEADLESS=true

# API Pod & Mais
PODEMAIS_API_URL=http://localhost:3000
PODEMAIS_SOCKET_URL=http://localhost:3000
PODEMAIS_API_EMAIL=admin@podemais.store
PODEMAIS_API_PASSWORD=suasenha
PODEMAIS_POLL_INTERVAL_MS=60000

# Fila e Agrupamento
QUEUE_GROUPING_WINDOW_MINUTES=20
QUEUE_MAX_ORDERS_PER_ROUTE=4
MAX_DETOUR_MINUTES=15
STORE_ORIGIN_ADDRESS="Rua Exemplo, 123, Bairro, Campo Grande - MS"
DRY_RUN=false

# Google Routes API
GOOGLE_ROUTES_API_KEY=sua_chave_aqui

# Banco de Dados (PostgreSQL)
DATABASE_URL=postgresql://usuario:senha@localhost:5432/podemais_automation
```

---

## 📦 Comandos e Inicialização com o Windows

### 1. Iniciar Manualmente com Janela (para testar / ver logs em tempo real)
- Dê dois cliques em `iniciar.bat`, ou no terminal:
  ```bash
  npm start
  ```

### 2. Iniciar Automaticamente ao Ligar o Windows (Silencioso em Segundo Plano)
- Dê dois cliques em **`instalar_inicializacao_windows.bat`**, ou no terminal:
  ```bash
  npm run startup:install
  ```
  Isso adiciona o atalho na pasta de inicialização do Windows (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`). Ao ligar o PC, o serviço roda silenciosamente em segundo plano, registrando os logs em `logs/automation.log`.

- **Para desativar a inicialização automática**:
  - Dê dois cliques em **`remover_inicializacao_windows.bat`**, ou execute:
    ```bash
    npm run startup:remove
    ```

### 3. Outros Comandos:
- **Executar a suíte de testes automatizados (14 cenários)**:
  ```bash
  npm test
  ```
- **Inspecionar a interface do Juma**:
  ```bash
  npm run juma:inspect
  npm run juma:gestao
  ```

---

## 🧪 Cobertura de Testes Automatizados

A suíte cobre os 14 cenários críticos exigidos:
1. `Pedido pago por PIX`: Não preenche valor a cobrar no Juma.
2. `Pedido com cartão na entrega`: Preenche valor a cobrar e sinaliza devolução de maquininha.
3. `Pedido em dinheiro na entrega`: Preenche valor a cobrar e calcula observação de troco.
4. `Agrupamento de pedidos próximos`: Forma rota combinada quando vantajosa.
5. `Pedidos sem rota vantajosa`: Separa pedidos distantes em grupos individuais.
6. `Expiração da janela de 20 minutos`: Despacha os pedidos pendentes sem postergação indefinida.
7. `Reinicialização com pedidos pendentes`: Recupera pedidos da fila persistente após restart.
8. `Falha de autenticação no Juma`: Detecta expiração de sessão e efetua reautenticação segura.
9. `Falha durante o preenchimento`: Registra falha na fila e agenda retentativa progressiva.
10. `Timeout após envio do formulário`: Encaminha para reconciliação manual e previne duplicidade.
11. `Prevenção de cadastro duplicado`: Rejeita inserção concorrente do mesmo pedido.
12. `Falha na Google Routes API`: Recorre a cálculo de contingência sem interromper entregas.
13. `Falha ao atualizar o status na API`: Preserva a entrega criada no Juma sem duplicar.
14. `Recuperação de pedidos que falharam`: Limita tentativas máximas antes de mover para `FAILED`.

---

## 🚢 Implantação no Railway

O projeto conta com `Dockerfile` oficial baseado na imagem `mcr.microsoft.com/playwright:v1.49.0-noble`, com todas as bibliotecas de sistema necessárias para rodar o Chromium headless.

1. Conecte o repositório ao seu projeto no [Railway](https://railway.app/).
2. Adicione as variáveis de ambiente no dashboard do Railway.
3. Certifique-se de configurar `JUMA_HEADLESS=true`.
4. Configure a variável `DATABASE_URL` conectando ao serviço PostgreSQL do Railway.
