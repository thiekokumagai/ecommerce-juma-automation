const { io } = require('socket.io-client');
const config = require('../config');

class PodEMaisSocketClient {
  constructor(options = {}) {
    this.socketUrl = options.socketUrl || config.api.socketUrl;
    this.socket = null;
    this.onConfirmedOrderCallback = null;
    this.isConnected = false;
  }

  connect(onConfirmedOrder, onOrderStatusChanged) {
    this.onConfirmedOrderCallback = onConfirmedOrder;
    this.onOrderStatusChangedCallback = onOrderStatusChanged;

    this.socket = io(this.socketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
    });

    this.socket.on('connect', () => {
      this.isConnected = true;
      console.log(`[Socket] Conectado ao servidor de eventos da Pod & Mais: ${this.socketUrl}`);
    });

    this.socket.on('disconnect', (reason) => {
      this.isConnected = false;
      console.warn(`[Socket] Desconectado da Pod & Mais: ${reason}`);
    });

    this.socket.on('connect_error', (error) => {
      console.error(`[Socket] Erro de conexão com WebSocket: ${error.message}`);
    });

    // Escutar eventos de atualização de pedido
    this.socket.on('order.updated', (order) => {
      this._handleOrderEvent(order, 'order.updated');
    });

    // Escutar novos pedidos que já possam nascer como confirmados
    this.socket.on('order.new', (order) => {
      this._handleOrderEvent(order, 'order.new');
    });
  }

  _handleOrderEvent(order, eventName) {
    if (!order) return;

    if (typeof this.onOrderStatusChangedCallback === 'function') {
      this.onOrderStatusChangedCallback(order, eventName);
    }

    // Verificar se o status é CONFIRMED (Separado comercialmente)
    if (order.status === 'CONFIRMED') {
      console.log(`[Socket] Evento ${eventName} recebido para pedido separado #${order.orderNumber || order.id}`);
      if (typeof this.onConfirmedOrderCallback === 'function') {
        this.onConfirmedOrderCallback(order);
      }
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
    }
  }
}

module.exports = PodEMaisSocketClient;
