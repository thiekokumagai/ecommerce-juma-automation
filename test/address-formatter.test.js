const { normalizeAddress, formatAddressForSearch } = require('../src/utils/address-formatter');
const { JumaService } = require('../src/juma/juma.service');

describe('Address Formatter & Juma Observation Tests', () => {
  const jumaService = new JumaService();

  test('Deve corrigir quando o CEP foi salvo no campo street e a rua está em neighborhood', () => {
    const order65485 = {
      orderNumber: 65485,
      customerName: 'Julio Mi',
      street: '79010-210',
      number: '1517',
      neighborhood: 'Rua Doutor Arthur Jorge - Monte Castelo',
      city: 'Campo Grande',
      state: 'MS',
      cep: '79010-210',
      complement: 'Apto 401',
      observation: 'Se possível me ligar ou mandar mensagem pra eu descer e receber mais facil',
    };

    const normalized = normalizeAddress(order65485);
    expect(normalized.street).toBe('Rua Doutor Arthur Jorge');
    expect(normalized.number).toBe('1517');
    expect(normalized.neighborhood).toBe('Monte Castelo');
    expect(normalized.city).toBe('Campo Grande');
    expect(normalized.state).toBe('MS');

    const searchStr = formatAddressForSearch(order65485);
    expect(searchStr).toBe('Rua Doutor Arthur Jorge, 1517, Monte Castelo, Campo Grande - MS');

    const observation = jumaService.formatObservation(order65485);
    expect(observation).not.toContain('[ENTREGA:');
    expect(observation).toBe('Se possível me ligar ou mandar mensagem pra eu descer e receber mais facil');
  });

  test('Deve manter endereço regular sem alterações indevidas', () => {
    const regularOrder = {
      orderNumber: 65486,
      street: 'Rua Ceará',
      number: '100',
      neighborhood: 'Santa Fé',
      city: 'Campo Grande',
      state: 'MS',
    };

    const normalized = normalizeAddress(regularOrder);
    expect(normalized.street).toBe('Rua Ceará');
    expect(normalized.number).toBe('100');
    expect(normalized.neighborhood).toBe('Santa Fé');

    const searchStr = formatAddressForSearch(regularOrder);
    expect(searchStr).toBe('Rua Ceará, 100, Santa Fé, Campo Grande - MS');
  });
});
