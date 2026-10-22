const GoogleRoutesClient = require('./google-routes.client');
const config = require('../config');

const { formatAddressForSearch } = require('../utils/address-formatter');

class RouteOptimizer {
  constructor(routesClient = new GoogleRoutesClient(), options = {}) {
    this.routesClient = routesClient;
    this.originAddress = options.originAddress || config.queue.storeOriginAddress;
    this.maxDetourMinutes = options.maxDetourMinutes || config.queue.maxDetourMinutes;
  }

  formatOrderAddress(order) {
    return formatAddressForSearch(order);
  }

  isCardOnDelivery(order) {
    if (!order) return false;
    const method = (order.paymentMethod || '').toLowerCase();
    const type = (order.paymentType || '').toLowerCase();

    if (method.includes('pix') || method.includes('dinheiro') || method.includes('cash')) {
      return false;
    }

    const isCard = (
      method.includes('cart') ||
      method.includes('credit') ||
      method.includes('crédit') ||
      method.includes('credito') ||
      method.includes('crédito') ||
      method.includes('debit') ||
      method.includes('débit') ||
      method.includes('debito') ||
      method.includes('débito') ||
      method.includes('card')
    );

    return isCard && type !== 'online';
  }

  async groupOrders(orders, options = {}) {
    if (!orders || orders.length === 0) return [];
    if (orders.length === 1) return [[orders[0]]];

    const maxPerRoute = options.maxPerRoute || config.queue.maxOrdersPerRoute;
    const groups = [];
    const pool = [...orders];

    while (pool.length > 0) {
      const currentGroup = [pool.shift()];

      // Tenta adicionar outros pedidos compatíveis ao grupo atual
      let i = 0;
      while (i < pool.length && currentGroup.length < maxPerRoute) {
        const candidate = pool[i];
        const isAdvantageous = await this.evaluateGroupingAdvantage(currentGroup, candidate);

        if (isAdvantageous) {
          currentGroup.push(candidate);
          pool.splice(i, 1); // Remove da piscina
        } else {
          i++; // Tenta o próximo
        }
      }

      groups.push(currentGroup);
    }

    return groups;
  }

  async evaluateGroupingAdvantage(currentGroup, candidate) {
    const combined = [...currentGroup, candidate];
    const hasCardMachine = combined.some((o) => this.isCardOnDelivery(o));

    const combinedAddresses = combined.map((o) => this.formatOrderAddress(o));
    const combinedRoute = await this.routesClient.computeRoute(this.originAddress, combinedAddresses, {
      requiresReturnToOrigin: hasCardMachine,
    });

    // Calcular tempos individuais estimados
    let sumIndividualMinutes = 0;
    for (const order of combined) {
      const addr = this.formatOrderAddress(order);
      const isCard = this.isCardOnDelivery(order);
      const indRoute = await this.routesClient.computeRoute(this.originAddress, [addr], {
        requiresReturnToOrigin: isCard,
      });
      sumIndividualMinutes += indRoute.durationMinutes;
    }

    // Vantagem operacional: a rota combinada economiza tempo global comparada com as idas e voltas individuais
    const detour = combinedRoute.durationMinutes - sumIndividualMinutes;

    // Se a rota combinada for mais rápida que viagens individuais somadas OU estiver dentro do desvio aceitável
    const isAdvantageous = combinedRoute.durationMinutes <= sumIndividualMinutes || detour <= this.maxDetourMinutes;

    console.log(
      `[RouteOptimizer] Avaliando agrupamento (${combined.length} pedidos): Rota Combinada = ${combinedRoute.durationMinutes}min | Soma Individual = ${sumIndividualMinutes}min | Maquininha Retorno: ${hasCardMachine} => Vantajosa: ${isAdvantageous}`
    );

    return isAdvantageous;
  }
}

module.exports = RouteOptimizer;
