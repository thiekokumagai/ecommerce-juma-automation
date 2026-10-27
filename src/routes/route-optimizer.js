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

  // Calcula a distância euclidiana/reta em km aproximada entre dois pontos (fórmula de Haversine)
  calculateDistanceKm(from, to) {
    const R = 6371; // Raio da Terra em km
    const dLat = ((to.lat - from.lat) * Math.PI) / 180;
    const dLng = ((to.lng - from.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((from.lat * Math.PI) / 180) *
        Math.cos((to.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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

      // Ordena as paradas do grupo pela distância da loja (mais perto primeiro, mais longe por último)
      const originCoords = await this.getOriginCoords();
      if (originCoords && currentGroup.length > 1) {
        const ordersWithDistance = await Promise.all(
          currentGroup.map(async (order) => {
            const coords = await this.getOrderCoords(order);
            const dist = coords ? this.calculateDistanceKm(originCoords, coords) : 999;
            return { order, dist };
          })
        );
        ordersWithDistance.sort((a, b) => a.dist - b.dist);
        groups.push(ordersWithDistance.map((item) => item.order));
      } else {
        groups.push(currentGroup);
      }
    }

    return groups;
  }

  async evaluateGroupingAdvantage(currentGroup, candidate) {
    // Verificação de Alinhamento Direcional / Rumo Reto a partir da Loja
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
                  `[RouteOptimizer] 🚫 Pedido #${candidate.orderNumber || candidate.id} fora do rumo direto da rota (Diferença: ${Math.round(diff)}° > limite ${this.maxBearingDiffDegrees}°). Despachando separado.`
                );
                return false;
              }
            }
          }

          // Verificação de Custo de Retorno:
          // Se um pedido precisa de retorno (cartão/dinheiro na entrega) e o outro é PIX/online
          // mas fica distante (estimativa superior a maxDetourMinutes ou distância relevante em km),
          // separar as rotas para não pagar o retorno caro da distância mais longa.
          const memberRequiresReturn = currentGroup.some((m) => this.isCardOnDelivery(m));
          const candidateRequiresReturn = this.isCardOnDelivery(candidate);

          if ((memberRequiresReturn && !candidateRequiresReturn) || (!memberRequiresReturn && candidateRequiresReturn)) {
            const candidateDistKm = this.calculateDistanceKm(originCoords, candidateCoords);
            // Estima tempo urbano aproximado (média de 30 km/h -> 2 min/km ou cálculo direto)
            const estimatedMinutesFromStore = Math.round(candidateDistKm * 2);

            const isFar = estimatedMinutesFromStore >= this.maxDetourMinutes || candidateDistKm >= 6.0;

            if (isFar) {
              console.log(
                `[RouteOptimizer] 💰 Pedido #${candidate.orderNumber || candidate.id} é ${candidateRequiresReturn ? 'Cartão' : 'PIX'} e está distante (~${candidateDistKm.toFixed(1)} km, ~${estimatedMinutesFromStore} min da loja). Separando rota para evitar taxa de retorno cara com pedido de ${memberRequiresReturn ? 'Cartão' : 'PIX'}.`
              );
              return false;
            }
          }

          console.log(
            `[RouteOptimizer] ✅ Pedido #${candidate.orderNumber || candidate.id} no mesmo rumo da rota (Diferença angular dentro do limite de ${this.maxBearingDiffDegrees}°). Agrupando!`
          );
          return true;
        }
      } catch (bearingErr) {
        console.warn(`[RouteOptimizer] Alerta no cálculo direcional: ${bearingErr.message}`);
      }
    }

    // Se não foi possível calcular as coordenadas, mantém como rota separada por segurança
    return false;
  }
}

module.exports = RouteOptimizer;

