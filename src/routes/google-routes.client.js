const axios = require('axios');
const config = require('../config');

class GoogleRoutesClient {
  constructor(apiKey = config.routes.apiKey) {
    this.apiKey = apiKey;
    this.endpoint = 'https://routes.googleapis.com/directions/v2:computeRoutes';
  }

  async computeRoute(originAddress, destinationAddresses, options = {}) {
    if (!this.apiKey) {
      console.warn('[GoogleRoutesClient] Chave de API do Google Routes não configurada. Usando cálculo de estimativa.');
      return this._mockRouteEstimation(originAddress, destinationAddresses, options);
    }

    try {
      const intermediates = destinationAddresses.slice(0, destinationAddresses.length - 1).map((addr) => ({
        address: addr,
      }));
      const destination = {
        address: destinationAddresses[destinationAddresses.length - 1],
      };

      const body = {
        origin: { address: originAddress },
        destination: destination,
        intermediates: intermediates,
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        optimizeWaypointOrder: true,
      };

      const response = await axios.post(this.endpoint, body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.optimizedIntermediateWaypointIndex',
        },
        timeout: 10000,
      });

      const route = response.data.routes && response.data.routes[0];
      if (!route) {
        throw new Error('Nenhuma rota encontrada na resposta da Google Routes API');
      }

      // duration vem no formato "1234s"
      const durationSeconds = parseInt((route.duration || '0s').replace('s', ''), 10);
      const distanceKm = (route.distanceMeters || 0) / 1000;

      return {
        durationMinutes: Math.round(durationSeconds / 60),
        distanceKm: Math.round(distanceKm * 10) / 10,
        optimizedOrder: route.optimizedIntermediateWaypointIndex || [],
      };
    } catch (error) {
      console.error(`[GoogleRoutesClient] Falha ao consultar Google Routes: ${error.message}. Aplicando fallback de cálculo.`);
      return this._mockRouteEstimation(originAddress, destinationAddresses, options);
    }
  }

  _mockRouteEstimation(origin, destinations, options = {}) {
    // Estimativa segura baseada em contagem de paradas para testes ou quando API estiver offline
    const stopsCount = destinations.length;
    const baseMinutesPerStop = 12; // Média urbana
    const stopOverheadMinutes = 5; // Tempo de entrega por parada

    let totalDuration = stopsCount * baseMinutesPerStop + (stopsCount - 1) * stopOverheadMinutes;
    if (options.requiresReturnToOrigin) {
      totalDuration += baseMinutesPerStop; // Retorno para entregar a maquininha
    }

    return {
      durationMinutes: totalDuration,
      distanceKm: stopsCount * 4.5,
      optimizedOrder: destinations.map((_, i) => i),
    };
  }

  async geocodeAddress(address) {
    if (!address) return null;
    if (!this.geocodeCache) {
      this.geocodeCache = new Map();
    }
    const cleanAddress = address.trim();
    if (this.geocodeCache.has(cleanAddress)) {
      return this.geocodeCache.get(cleanAddress);
    }

    if (!this.apiKey) {
      return null;
    }

    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(cleanAddress)}&key=${this.apiKey}`;
      const response = await axios.get(url, { timeout: 6000 });
      if (response.data && response.data.status === 'OK' && response.data.results?.[0]?.geometry?.location) {
        const loc = response.data.results[0].geometry.location;
        const coords = { lat: loc.lat, lng: loc.lng };
        this.geocodeCache.set(cleanAddress, coords);
        return coords;
      }
    } catch (err) {
      console.warn(`[GoogleRoutesClient] Falha ao geocodificar "${cleanAddress}": ${err.message}`);
    }

    return null;
  }
}

module.exports = GoogleRoutesClient;
