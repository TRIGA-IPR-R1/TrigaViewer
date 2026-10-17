/*
TrigaViewer - visualizador web de graficos em tempo real do TrigaServer.
Copyright (C) 2026 Thalles Campagnani
Licenciado sob a GNU Affero General Public License v3 ou posterior.
*/

// catalog.js
//
// Descricao das variaveis enviadas pelo TrigaServer: nome legivel, agrupamento
// e unidade de fallback. A unidade que vale vem no cabecalho CSV
// (nome[unidade]), gerado a partir do arquivo de calibracao do TrigaServer.
// Este arquivo so e usado quando o servidor antigo nao envia unidades.
//
// Os nomes das colunas vem de:
//   PLC_<CONV|ORIG>_<campo>     (libOpcTrigaPLC.h, PLC_DATA_MATRIX)
//   SPU_<ChA|ChB>_<campo>       (libModbusSystematomSPU.h, SPU_DATA_MATRIX)
//   PJI_<Poco|EntPri|SaiPri|EntSec|SaiSec>_<campo>  (libRs232EcilPJI.h)
//   N1500FT_VasPri_<campo>      (libModbusNovusN1500FT.h)

export const NO_UNIT = 'sem unidade';

// Descricao de cada unidade, exibida como dica na interface.
export const UNIT_LABELS = {
  W: 'potencia (watt)',
  s: 'tempo (segundo)',
  '%': 'percentual',
  pcm: 'reatividade (pcm)',
  cps: 'contagens por segundo',
  'mRem/h': 'taxa de dose (milirem por hora)',
  'm3/h': 'vazao (metro cubico por hora)',
  V: 'leitura eletrica bruta (volt)',
  mV: 'leitura eletrica bruta (milivolt)',
  mA: 'leitura eletrica bruta (miliampere)',
  UE: 'unidade de engenharia do instrumento',
  counts: 'contagem bruta',
  codigo: 'codigo enumerado',
  bits: 'palavra de status',
  digitos: 'numero de digitos',
  leituras: 'numero de leituras',
  '': 'adimensional',
  estado: 'codigo de estado da comunicacao',
  'data/hora': 'componente da data e hora da leitura',
  logico: 'sinal logico (0 ou 1)',
  [NO_UNIT]: 'variavel sem unidade definida',
};

const TIME_FIELDS = {
  TIME_Y: 'Ano',
  TIME_Mo: 'Mês',
  TIME_D: 'Dia',
  TIME_H: 'Hora',
  TIME_Mi: 'Minuto',
  TIME_S: 'Segundo',
  TIME_MS: 'Milissegundo',
};

const COMMON_FIELDS = {
  STATE: { label: 'Estado', unit: 'estado' },
  ...Object.fromEntries(
    Object.entries(TIME_FIELDS).map(([field, label]) => [field, { label, unit: 'data/hora' }]),
  ),
};

const DEVICES = {
  PLC_CONV: { id: 'PLC_CONV', label: 'CLP — valores convertidos' },
  PLC_ORIG: { id: 'PLC_ORIG', label: 'CLP — valores originais' },
  SPU_ChA: { id: 'SPU_ChA', label: 'SPU — Canal A' },
  SPU_ChB: { id: 'SPU_ChB', label: 'SPU — Canal B' },
  PJI_Poco: { id: 'PJI_Poco', label: 'PJ-I — Poço' },
  PJI_EntPri: { id: 'PJI_EntPri', label: 'PJ-I — Entrada primário' },
  PJI_SaiPri: { id: 'PJI_SaiPri', label: 'PJ-I — Saída primário' },
  PJI_EntSec: { id: 'PJI_EntSec', label: 'PJ-I — Entrada secundário' },
  PJI_SaiSec: { id: 'PJI_SaiSec', label: 'PJ-I — Saída secundário' },
  N1500FT_VasPri: { id: 'N1500FT_VasPri', label: 'N1500FT — Vazão primário' },
  OTHER: { id: 'OTHER', label: 'Outras variáveis' },
};

const PJI_NAMES = ['Poco', 'EntPri', 'SaiPri', 'EntSec', 'SaiSec'];

const PLC_CHANNEL_LABELS = {
  CLog: 'Canal Logarítmico',
  CPar: 'Canal de Partida',
  CLin: 'Canal Linear',
  CPer: 'Canal Percentual',
  Barras: 'Barras',
  SRad: 'Radiação',
  SVas: 'Vazão',
  Comm: 'Comunicação',
  Outros: 'Outros',
};

const SPU_CHANNEL_LABELS = {
  Leitura: 'Leitura',
  Config: 'Configurações',
  Comm: 'Comunicação',
  Outros: 'Outros',
};

const PJI_CHANNEL_LABELS = {
  Leitura: 'Leitura',
  Escalas: 'Escalas',
  Status: 'Status',
  Alarmes: 'Alarmes',
  Config: 'Configurações',
  Comm: 'Comunicação',
  Outros: 'Outros',
};

const N1500FT_CHANNEL_LABELS = {
  Leitura: 'Leitura',
  Status: 'Status',
  Identidade: 'Identidade',
  Config: 'Configurações',
  Comm: 'Comunicação',
  Outros: 'Outros',
};

// Variaveis do CLP (Siemens, via OPC UA). O rotulo e o nome curto do campo,
// porque dispositivo e canal ja vieram nos seletores anteriores.
const PLC_FIELDS = {
  ...COMMON_FIELDS,
  BarraReg: { label: 'Regulação', unit: '' },
  BarraCon: { label: 'Controle', unit: '' },
  BarraSeg: { label: 'Segurança', unit: '' },
  CLogALog: { label: 'Aquisição logarítmica', unit: 'W' },
  CLogALin: { label: 'Aquisição linear', unit: 'W' },
  CLogAPer: { label: 'Período', unit: 's' },
  CParALin: { label: 'Aquisição linear', unit: 'W' },
  CParALog: { label: 'Aquisição logarítmica', unit: 'W' },
  CParAPer: { label: 'Período', unit: 's' },
  CLogARea: { label: 'Reatividade', unit: 'pcm' },
  CLin: { label: 'Potência', unit: 'W' },
  CPer: { label: 'Potência percentual', unit: '%' },
  SRadAre: { label: 'Área do reator', unit: 'mRem/h' },
  SRadEntPri: { label: 'Entrada do primário', unit: 'mRem/h' },
  SRadPoc: { label: 'Poço', unit: 'mRem/h' },
  SRadRes: { label: 'Resinas', unit: 'mRem/h' },
  SRadSaiSec: { label: 'Saída do secundário', unit: 'mRem/h' },
  SRadAer: { label: 'Aerossóis', unit: 'mRem/h' },
  SVasPri: { label: 'Primário de refrigeração', unit: 'm3/h' },
};

// Variaveis das SPU (Systematom, via Modbus RTU).
const SPU_FIELDS = {
  ...COMMON_FIELDS,
  N_DATA_FP: { label: 'Potência (N)', unit: 'W' },
  T_DATA_FP: { label: 'Período (T)', unit: 's' },
  F1_DATA_FP: { label: 'Contagem F1', unit: 'cps' },
  F2_DATA_FP: { label: 'Contagem F2', unit: 'cps' },
  F3_DATA_FP: { label: 'Contagem F3', unit: 'cps' },
  EMR_N_THRESHOLD: { label: 'Limiar de emergência de potência', unit: 'W' },
  WRN_N_THRESHOLD: { label: 'Limiar de alerta de potência', unit: 'W' },
  EMR_T_THRESHOLD: { label: 'Limiar de emergência de período', unit: 's' },
  WRN_T_THRESHOLD: { label: 'Limiar de alerta de período', unit: 's' },
  EMR_N: { label: 'Emergência de potência', unit: 'logico' },
  WRN_N: { label: 'Alerta de potência', unit: 'logico' },
  EMR_T: { label: 'Emergência de período', unit: 'logico' },
  WRN_T: { label: 'Alerta de período', unit: 'logico' },
  R1: { label: 'Relé 1', unit: 'logico' },
  R2: { label: 'Relé 2', unit: 'logico' },
  R3: { label: 'Relé 3', unit: 'logico' },
  RDY: { label: 'Pronto', unit: 'logico' },
  TEST: { label: 'Modo de teste', unit: 'logico' },
  XXXX: { label: 'Reservado', unit: 'logico' },
};

// Variaveis dos indicadores ECIL PJ-I (protocolo Jotta, RS-232).
const PJI_FIELDS = {
  ...COMMON_FIELDS,
  PV: { label: 'Temperatura', unit: 'UE' },
  PV_max: { label: 'Temperatura máxima', unit: 'UE' },
  PV_min: { label: 'Temperatura mínima', unit: 'UE' },
  PV_raw: { label: 'PV bruta', unit: 'counts' },
  tipo_entrada: { label: 'Tipo de entrada', unit: 'codigo' },
  ponto_decimal: { label: 'Ponto decimal', unit: 'digitos' },
  escala_alta_hw: { label: 'Escala alta (hardware)', unit: 'UE' },
  escala_baixa_hw: { label: 'Escala baixa (hardware)', unit: 'UE' },
  escala_alta_trab: { label: 'Escala alta (trabalho)', unit: 'UE' },
  escala_baixa_trab: { label: 'Escala baixa (trabalho)', unit: 'UE' },
  status1: { label: 'Status 1', unit: 'bits' },
  status2: { label: 'Status 2', unit: 'bits' },
  raiz_quadrada: { label: 'Raiz quadrada', unit: 'logico' },
  unidade_F: { label: 'Unidade °F', unit: 'logico' },
  escrita_habilitada: { label: 'Escrita habilitada', unit: 'logico' },
  det_min: { label: 'Detecção de mínimo', unit: 'logico' },
  det_max: { label: 'Detecção de máximo', unit: 'logico' },
  pv_fora_faixa: { label: 'PV fora de faixa', unit: 'logico' },
  entrada_nao_linear: { label: 'Entrada não linear', unit: 'logico' },
  alarme1_cond: { label: 'Condição do alarme 1', unit: 'codigo' },
  alarme2_cond: { label: 'Condição do alarme 2', unit: 'codigo' },
  entrada_aberta: { label: 'Entrada aberta', unit: 'logico' },
  sp_alarme1: { label: 'Setpoint do alarme 1', unit: 'UE' },
  rearme_alarme1: { label: 'Rearme do alarme 1', unit: 'UE' },
  chave_alarme1: { label: 'Chave do alarme 1', unit: 'codigo' },
  sp_alarme2: { label: 'Setpoint do alarme 2', unit: 'UE' },
  rearme_alarme2: { label: 'Rearme do alarme 2', unit: 'UE' },
  chave_alarme2: { label: 'Chave do alarme 2', unit: 'codigo' },
  pv_emergencia: { label: 'PV de emergência', unit: 'UE' },
  n_medias: { label: 'Número de médias', unit: 'leituras' },
  trava_teclado: { label: 'Trava do teclado', unit: 'codigo' },
};

// Variaveis do NOVUS N1500FT (Modbus RTU, vazao).
const N1500FT_FIELDS = {
  ...COMMON_FIELDS,
  vazao_instantanea: { label: 'Vazão instantânea', unit: 'UE' },
  vazao_total: { label: 'Vazão total', unit: 'UE' },
  vazao_total_nr: { label: 'Vazão total não resetável', unit: 'UE' },
  entrada_aux: { label: 'Entrada auxiliar 4–20 mA', unit: 'UE' },
  vazao_inst_max: { label: 'Vazão instantânea máxima', unit: 'UE' },
  vazao_inst_min: { label: 'Vazão instantânea mínima', unit: 'UE' },
  unidade_vazao_codigo: { label: 'Base de tempo da vazão', unit: 'codigo' },
  tipo_entrada: { label: 'Tipo de entrada', unit: 'codigo' },
  serial_hi: { label: 'Número de série (alta)', unit: 'digitos' },
  serial_lo: { label: 'Número de série (baixa)', unit: 'digitos' },
  firmware: { label: 'Versão de firmware', unit: 'codigo' },
  product_id: { label: 'Identificador do produto', unit: 'codigo' },
  status1: { label: 'Status 1', unit: 'bits' },
  status2: { label: 'Status 2', unit: 'bits' },
  status3: { label: 'Status 3', unit: 'bits' },
  alarme1: { label: 'Alarme 1', unit: 'logico' },
  alarme2: { label: 'Alarme 2', unit: 'logico' },
  alarme3: { label: 'Alarme 3', unit: 'logico' },
  alarme4: { label: 'Alarme 4', unit: 'logico' },
  aux_acima_max: { label: 'Auxiliar acima do máximo', unit: 'logico' },
  aux_abaixo_min: { label: 'Auxiliar abaixo do mínimo', unit: 'logico' },
  aux_aberta: { label: 'Entrada auxiliar aberta', unit: 'logico' },
  rele1: { label: 'Relé 1', unit: 'logico' },
  rele2: { label: 'Relé 2', unit: 'logico' },
  rele3: { label: 'Relé 3', unit: 'logico' },
  rele4: { label: 'Relé 4', unit: 'logico' },
  entrada_digital: { label: 'Entrada digital', unit: 'logico' },
};

function plcChannelOf(field) {
  if (field.startsWith('CLog')) return 'CLog';
  if (field.startsWith('CPar')) return 'CPar';
  if (field === 'CLin') return 'CLin';
  if (field === 'CPer') return 'CPer';
  if (field.startsWith('Barra')) return 'Barras';
  if (field.startsWith('SRad')) return 'SRad';
  if (field.startsWith('SVas')) return 'SVas';
  if (field === 'STATE' || field.startsWith('TIME_')) return 'Comm';
  return 'Outros';
}

function spuChannelOf(field) {
  if (field === 'STATE' || field.startsWith('TIME_')) return 'Comm';
  if (field === 'N_DATA_FP' || field === 'T_DATA_FP'
      || field === 'F1_DATA_FP' || field === 'F2_DATA_FP' || field === 'F3_DATA_FP') {
    return 'Leitura';
  }
  if (SPU_FIELDS[field]) return 'Config';
  return 'Outros';
}

function pjiChannelOf(field) {
  if (field === 'STATE' || field.startsWith('TIME_')) return 'Comm';
  if (field === 'PV' || field === 'PV_max' || field === 'PV_min' || field === 'PV_raw') {
    return 'Leitura';
  }
  if (field === 'tipo_entrada' || field === 'ponto_decimal'
      || field.startsWith('escala_')) {
    return 'Escalas';
  }
  if (field.startsWith('alarme') || field.startsWith('sp_alarme')
      || field.startsWith('rearme_alarme') || field.startsWith('chave_alarme')
      || field === 'pv_emergencia') {
    return 'Alarmes';
  }
  if (field === 'n_medias' || field === 'trava_teclado') return 'Config';
  if (PJI_FIELDS[field]) return 'Status';
  return 'Outros';
}

function n1500ftChannelOf(field) {
  if (field === 'STATE' || field.startsWith('TIME_')) return 'Comm';
  if (field.startsWith('vazao_') || field === 'entrada_aux') return 'Leitura';
  if (field === 'serial_hi' || field === 'serial_lo'
      || field === 'firmware' || field === 'product_id') {
    return 'Identidade';
  }
  if (field === 'unidade_vazao_codigo' || field === 'tipo_entrada') return 'Config';
  if (N1500FT_FIELDS[field]) return 'Status';
  return 'Outros';
}

/**
 * Separa `Nome[unidade]` do cabecalho do TrigaServer.
 * Sem colchetes, unit fica indefinida (o catálogo local entra como fallback).
 */
export function parseHeaderField(raw) {
  if (typeof raw === 'string' && raw.endsWith(']')) {
    const open = raw.lastIndexOf('[');
    if (open > 0) {
      return { key: raw.slice(0, open), unit: raw.slice(open + 1, -1) };
    }
  }
  return { key: raw, unit: undefined };
}

export function formatHeaderField(key, unit) {
  if (unit === undefined || unit === NO_UNIT) return key;
  return `${key}[${unit}]`;
}

function describeKnown(key, index, field, known, device, channel, channelLabel, unit, short) {
  const label = known ? known.label : field;
  return {
    key,
    index,
    field,
    label,
    titleLabel: `${device.label} — ${label}`,
    unit,
    device: device.id,
    deviceLabel: device.label,
    channel,
    channelLabel,
    group: device.label,
    short,
  };
}

/**
 * Traduz o nome de uma coluna do CSV em metadados de exibicao.
 * Colunas desconhecidas continuam disponiveis, agrupadas em "Outras".
 * serverUnit (string, inclusive vazia) prevalece sobre o catalogo.
 */
export function describeColumn(key, index, serverUnit) {
  const parsed = parseHeaderField(key);
  key = parsed.key;
  if (serverUnit === undefined) serverUnit = parsed.unit;

  const plc = /^PLC_(CONV|ORIG)_(.+)$/.exec(key);
  if (plc) {
    const [, source, field] = plc;
    const known = PLC_FIELDS[field];
    const origin = source === 'CONV' ? 'conv' : 'orig';
    const device = DEVICES[`PLC_${source}`];
    const channel = plcChannelOf(field);
    const label = known ? known.label : field;
    const channelLabel = PLC_CHANNEL_LABELS[channel];
    return {
      key,
      index,
      field,
      label,
      titleLabel: `${channelLabel} — ${label}`,
      // Os valores "originais" sao a leitura eletrica antes da conversao.
      unit: serverUnit !== undefined ? serverUnit : pickUnit(known, source === 'ORIG', field),
      device: device.id,
      deviceLabel: device.label,
      channel,
      channelLabel,
      group: device.label,
      short: `${field} (${origin})`,
    };
  }

  const spu = /^SPU_(ChA|ChB)_(.+)$/.exec(key);
  if (spu) {
    const [, spuChannel, field] = spu;
    const known = SPU_FIELDS[field];
    const device = DEVICES[`SPU_${spuChannel}`];
    const channel = spuChannelOf(field);
    return describeKnown(
      key, index, field, known, device, channel, SPU_CHANNEL_LABELS[channel],
      serverUnit !== undefined ? serverUnit : pickUnit(known, false),
      `${field} (${spuChannel})`,
    );
  }

  const pji = new RegExp(`^PJI_(${PJI_NAMES.join('|')})_(.+)$`).exec(key);
  if (pji) {
    const [, name, field] = pji;
    const known = PJI_FIELDS[field];
    const device = DEVICES[`PJI_${name}`];
    const channel = pjiChannelOf(field);
    return describeKnown(
      key, index, field, known, device, channel, PJI_CHANNEL_LABELS[channel],
      serverUnit !== undefined ? serverUnit : pickUnit(known, false),
      `${field} (${name})`,
    );
  }

  const n1500 = /^N1500FT_(VasPri)_(.+)$/.exec(key);
  if (n1500) {
    const [, name, field] = n1500;
    const known = N1500FT_FIELDS[field];
    const device = DEVICES[`N1500FT_${name}`];
    const channel = n1500ftChannelOf(field);
    return describeKnown(
      key, index, field, known, device, channel, N1500FT_CHANNEL_LABELS[channel],
      serverUnit !== undefined ? serverUnit : pickUnit(known, false),
      `${field} (${name})`,
    );
  }

  return {
    key,
    index,
    field: key,
    label: key,
    titleLabel: key,
    unit: serverUnit !== undefined ? serverUnit : NO_UNIT,
    device: DEVICES.OTHER.id,
    deviceLabel: DEVICES.OTHER.label,
    channel: 'Outros',
    channelLabel: 'Outros',
    group: DEVICES.OTHER.label,
    short: key,
  };
}

function pickUnit(known, isRaw, field) {
  if (!known) return NO_UNIT;
  if (!isRaw) return known.unit;
  if (known.unit === 'estado' || known.unit === 'data/hora') return known.unit;
  if (field === 'SVasPri') return 'mA';
  return 'mV';
}

export function unitDescription(unit) {
  return UNIT_LABELS[unit] || unit;
}
