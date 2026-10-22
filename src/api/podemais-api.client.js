const axios = require('axios');
const config = require('../config');

class PodEMaisApiClient {
  constructor(customConfig = {}) {
    let rawBaseUrl = customConfig.baseUrl || config.api.baseUrl;
    // Garante que o prefixo global /api do NestJS esteja presente
    if (!rawBaseUrl.endsWith('/api') && !rawBaseUrl.endsWith('/api/')) {
      rawBaseUrl = rawBaseUrl.replace(/\/+$/, '') + '/api';
    }
    this.baseUrl = rawBaseUrl.replace(/\/+$/, '');
    this.email = customConfig.email || config.api.email;
    this.password = customConfig.password || config.api.password;
    this.accessToken = null;
    this.refreshToken = null;
    this.isRefreshing = false;
    this.refreshSubscribers = [];

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    this._setupInterceptors();
  }

  _setupInterceptors() {
    this.http.interceptors.request.use((reqConfig) => {
      if (this.accessToken && !reqConfig.headers.Authorization) {
        reqConfig.headers.Authorization = `Bearer ${this.accessToken}`;
      }
      return reqConfig;
    });

    this.http.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        if (
          error.response &&
          error.response.status === 401 &&
          !originalRequest._retry &&
          !originalRequest.url.includes('/auth/login')
        ) {
          originalRequest._retry = true;

          if (!this.isRefreshing) {
            this.isRefreshing = true;
            try {
              const newTokens = await this.refreshTokens();
              this.isRefreshing = false;
              this._onTokenRefreshed(newTokens.accessToken);
            } catch (refreshErr) {
              this.isRefreshing = false;
              this.accessToken = null;
              this.refreshToken = null;
              return Promise.reject(refreshErr);
            }
          }

          return new Promise((resolve) => {
            this._subscribeTokenRefresh((token) => {
              originalRequest.headers.Authorization = `Bearer ${token}`;
              resolve(this.http(originalRequest));
            });
          });
        }
        return Promise.reject(error);
      }
    );
  }

  _subscribeTokenRefresh(cb) {
    this.refreshSubscribers.push(cb);
  }

  _onTokenRefreshed(token) {
    this.refreshSubscribers.forEach((cb) => cb(token));
    this.refreshSubscribers = [];
  }

  async login() {
    if (!this.email || !this.password) {
      throw new Error('Credenciais da API Pod & Mais não configuradas (email e senha necessários)');
    }

    const response = await this.http.post('/auth/login', {
      email: this.email,
      password: this.password,
    });

    this.accessToken = response.data.accessToken;
    this.refreshToken = response.data.refreshToken;
    return response.data;
  }

  async refreshTokens() {
    if (!this.refreshToken) {
      return this.login();
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/auth/refresh`,
        {},
        {
          headers: {
            Authorization: `Bearer ${this.refreshToken}`,
            Accept: 'application/json',
          },
        }
      );

      this.accessToken = response.data.accessToken;
      this.refreshToken = response.data.refreshToken;
      return response.data;
    } catch (err) {
      // Se falhar o refresh, tenta login completo
      return this.login();
    }
  }

  async ensureAuthenticated() {
    if (!this.accessToken) {
      await this.login();
    }
  }

  async getConfirmedOrders(page = 1, limit = 50) {
    await this.ensureAuthenticated();
    const response = await this.http.get('/orders', {
      params: {
        status: 'CONFIRMED',
        page,
        limit,
      },
    });
    return response.data;
  }

  async getOrderDetails(orderId) {
    await this.ensureAuthenticated();
    const response = await this.http.get(`/orders/${orderId}`);
    return response.data;
  }

  async updateOrderStatus(orderId, status = 'DISPATCHED') {
    await this.ensureAuthenticated();
    const response = await this.http.patch(`/orders/${orderId}/status`, {
      status,
    });
    return response.data;
  }
}

module.exports = PodEMaisApiClient;
