/**
 * Utilitário de normalização e formatação de endereços para integração com Juma e Google Routes.
 */

function normalizeAddress(order = {}) {
  let street = (order.street || '').trim();
  let number = (order.number || '').trim();
  let neighborhood = (order.neighborhood || '').trim();
  let city = (order.city || 'Campo Grande').trim();
  let state = (order.state || 'MS').trim();
  let cep = (order.cep || '').trim();

  // Verifica se o campo street é na verdade um CEP (ex: "79010-210" ou "79010210")
  const isCepRegex = /^\d{5}-?\d{3}$/;
  if (isCepRegex.test(street)) {
    if (!cep) cep = street;
    // O logradouro real costuma estar no campo neighborhood (ex: "Rua Doutor Arthur Jorge - Monte Castelo")
    if (neighborhood) {
      const parts = neighborhood.split(/\s*[-–—]\s*/);
      if (parts.length >= 2) {
        street = parts[0].trim();
        neighborhood = parts.slice(1).join(' - ').trim();
      } else {
        street = neighborhood;
        neighborhood = '';
      }
    }
  }

  // Se neighborhood começar repetindo o logradouro
  if (neighborhood && street && neighborhood.toLowerCase().startsWith(street.toLowerCase())) {
    neighborhood = neighborhood.substring(street.length).replace(/^[\s,–—-]+/, '').trim();
  }

  // Remove repetição de número no logradouro se já estiver presente
  if (number && number !== 'S/N') {
    const numRegex = new RegExp(`,?\\s*${number}$`);
    street = street.replace(numRegex, '').trim();
  }

  return {
    street,
    number,
    neighborhood,
    city,
    state,
    cep,
  };
}

function formatAddressForSearch(order) {
  const norm = normalizeAddress(order);
  const parts = [
    norm.street,
    norm.number && norm.number !== 'S/N' ? norm.number : null,
    norm.neighborhood,
    norm.city ? `${norm.city} - ${norm.state}` : norm.state,
  ].filter(Boolean);
  return parts.join(', ');
}

module.exports = {
  normalizeAddress,
  formatAddressForSearch,
};
