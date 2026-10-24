const GoogleRoutesClient = require('./google-routes.client');
const config = require('../config');

const { formatAddressForSearch } = require('../utils/address-formatter');

class RouteOptimizer {
  constructor(routesClient = new GoogleRoutesClient(), options = {}) {
    this.routesClient = routesClient;
    this.originAddress = options.originAddress || config.queue.storeOriginAddress;
    this.maxDetourMinutes = options.maxDetourMinutes || config.queue.maxDetourMinutes;
    this.maxBearingDiffDegrees = options.maxBearingDiffDegrees !== undefined 
      ? options.maxBearingDiffDegrees 
      : config.routes.maxBearingDiffDegrees;
    this.originCoords = null;
  }

  // Calcula o azimute/rumo em graus (0° a 360°) do ponto A para o ponto B
  calculateBearing(from, to) {
    const lat1 = (from.lat * Math.PI) / 180;
    const lat2 = (to.lat * Math.PI) / 180;
    const dLng = ((to.lng - from.lng) * Math.PI) / 180;

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    const brng = (Math.atan2(y, x) * 180) / Math.PI;
    return (brng + 360) % 360;
  }

  // Diferença angular mínima entre dois rumos (0° a 180°)
  bearingDifference(b1, b2) {
    const diff = Math.abs(b1 - b2) % 360;
    return diff > 180 ? 360 - diff : diff;
  }

  async getOrderCoords(order) {
    if (order.latitude && order.longitude) {
      return { lat: parseFloat(order.latitude), lng: parseFloat(order.longitude) };
    }
    const address = this.formatOrderAddress(order);
    if (typeof this.routesClient.geocodeAddress === 'function') {
      return await this.routesClient.geocodeAddress(address);
    }
    return null;
  }

  async getOriginCoords() {
    if (this.originCoords) return this.originCoords;
    if (typeof this.routesClient.geocodeAddress === 'function') {
      this.originCoords = await this.routesClient.geocodeAddress(this.originAddress);
    }
    return this.originCoords;
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
    // 1. Verificação de Alinhamento Direcional / Rumo Reto
    if (this.maxBearingDiffDegrees && this.maxBearingDiffDegrees < 180) {
      try {
        const originCoords = await this.getOriginCoords();
        const candidateCoords = await this.getOrderCoords(candidate);

        if (originCoords && candidateCoords) {
          const candidateBearing = this.calculateBearing(originCoords, candidateCoords);

          for (const member of currentGroup) {
            const memberCoords = await this.getOrderCoords(member);
            if (memberCoords) {
              const memberBearing = this.calculateBearing(originCoords, memberCoords);
              const diff = this.bearingDifference(memberBearing, candidateBearing);

              if (diff > this.maxBearingDiffDegrees) {
                console.log(
                  `[RouteOptimizer] 🚫 Pedido #${candidate.orderNumber || candidate.id} fora do rumo direto da rota (Diferença angular: ${Math.round(diff)}° > limite ${this.maxBearingDiffDegrees}°). Despachando separado.`
                );
                return false;
              }
            }
          }
        }
      } catch (bearingErr) {
        console.warn(`[RouteOptimizer] Alerta no cálculo direcional: ${bearingErr.message}`);
      }
    }

    // 2. Verificação de Tempo e Desvio de Rota (MAX_DETOUR_MINUTES)
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
