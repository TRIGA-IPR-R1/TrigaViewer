/*
TrigaViewer - visualizador web de graficos em tempo real do TrigaServer.
Copyright (C) 2026 Thalles Campagnani
Licenciado sob a GNU Affero General Public License v3 ou posterior.
*/

// store.js
//
// Armazenamento em memoria do fluxo de dados, neste navegador. Cada
// variavel do CSV vira um Float64Array; o recorte exibido no grafico e uma
// subarray, sem copia. Com capacidade finita o tamanho e fixo; com
// "Ilimitado" o buffer cresce conforme as amostras chegam.

import { describeColumn } from './catalog.js';

// Fracao descartada quando o buffer enche. Descartar em blocos evita um
// deslocamento de memoria a cada nova amostra.
const DISCARD_FRACTION = 0.25;
const MIN_ALLOC = 16384;

export class DataStore {
  constructor(capacity = 50000) {
    // 0 = ilimitado: o buffer cresce conforme as amostras chegam.
    this.capacity = capacity;
    this.columns = [];
    this.columnIndex = new Map();
    this.time = new Float64Array(0);
    this.buffers = [];
    this.length = 0;
    this.totalReceived = 0;
    this.discarded = 0;
  }

  /** Define as variaveis a partir da linha de cabecalho e zera os dados. */
  setColumns(names, units) {
    this.columns = names.map((name, index) => {
      const fromServer = Array.isArray(units) && units[index] != null ? units[index] : undefined;
      return describeColumn(name, index, fromServer);
    });
    this.columnIndex = new Map(this.columns.map((column) => [column.key, column.index]));
    this.allocate();
  }

  allocate() {
    const size = this.capacity > 0 ? this.capacity : MIN_ALLOC;
    this.time = new Float64Array(size);
    this.buffers = this.columns.map(() => new Float64Array(size));
    this.length = 0;
    this.totalReceived = 0;
    this.discarded = 0;
  }

  clear() {
    this.length = 0;
    this.totalReceived = 0;
    this.discarded = 0;
  }

  /** Redimensiona o buffer preservando as amostras mais recentes. */
  setCapacity(capacity) {
    if (capacity === this.capacity) return;

    const keep = capacity > 0 ? Math.min(this.length, capacity) : this.length;
    const start = this.length - keep;
    const size = capacity > 0 ? capacity : Math.max(keep, MIN_ALLOC);

    const time = new Float64Array(size);
    time.set(this.time.subarray(start, this.length));
    const buffers = this.buffers.map((buffer) => {
      const resized = new Float64Array(size);
      resized.set(buffer.subarray(start, this.length));
      return resized;
    });

    this.capacity = capacity;
    this.time = time;
    this.buffers = buffers;
    this.discarded += start;
    this.length = keep;
  }

  /**
   * Grava uma amostra: [tempo_epoch_s, valor1, valor2, ...].
   * Valores nulos (variavel nao lida pelo TrigaServer) viram NaN, o que
   * produz uma lacuna na curva em vez de um degrau ate zero.
   */
  push(row) {
    if (!this.columns.length) return;
    if (this.capacity > 0 && this.length >= this.capacity) {
      this.dropOldest(Math.max(1, Math.floor(this.capacity * DISCARD_FRACTION)));
    } else if (this.length >= this.time.length) {
      this.grow();
    }

    const at = this.length;
    this.time[at] = row[0];
    for (let index = 0; index < this.buffers.length; index += 1) {
      const value = row[index + 1];
      this.buffers[index][at] = value === null || value === undefined ? NaN : value;
    }
    this.length += 1;
    this.totalReceived += 1;
  }

  pushMany(rows) {
    for (const row of rows) this.push(row);
  }

  grow() {
    const next = Math.max(MIN_ALLOC, this.time.length * 2);
    const time = new Float64Array(next);
    time.set(this.time.subarray(0, this.length));
    const buffers = this.buffers.map((buffer) => {
      const resized = new Float64Array(next);
      resized.set(buffer.subarray(0, this.length));
      return resized;
    });
    this.time = time;
    this.buffers = buffers;
  }

  dropOldest(count) {
    const drop = Math.min(count, this.length);
    if (drop <= 0) return;
    this.time.copyWithin(0, drop, this.length);
    for (const buffer of this.buffers) buffer.copyWithin(0, drop, this.length);
    this.length -= drop;
    this.discarded += drop;
  }

  get firstTime() {
    return this.length ? this.time[0] : null;
  }

  get lastTime() {
    return this.length ? this.time[this.length - 1] : null;
  }

  /** Indice da primeira amostra com tempo >= instante (busca binaria). */
  indexAtTime(instant) {
    let low = 0;
    let high = this.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.time[middle] < instant) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  /**
   * Monta o vetor de dados do uPlot: [tempos, valores...] recortado na
   * janela pedida. Sem valores invalidos devolve as subarrays originais.
   */
  slice(keys, fromTime) {
    const start = fromTime == null ? 0 : Math.max(0, this.indexAtTime(fromTime) - 1);
    const end = this.length;
    const data = [this.time.subarray(start, end)];
    for (const key of keys) {
      const index = this.columnIndex.get(key);
      if (index === undefined) {
        data.push(new Array(end - start).fill(null));
        continue;
      }
      data.push(withGaps(this.buffers[index], start, end));
    }
    return data;
  }

  /** Ultimo valor conhecido de uma variavel (NaN vira null). */
  latest(key) {
    const index = this.columnIndex.get(key);
    if (index === undefined || !this.length) return null;
    const value = this.buffers[index][this.length - 1];
    return Number.isNaN(value) ? null : value;
  }

  valueAt(key, position) {
    const index = this.columnIndex.get(key);
    if (index === undefined || position < 0 || position >= this.length) return null;
    const value = this.buffers[index][position];
    return Number.isNaN(value) ? null : value;
  }

  /** Consumo aproximado dos buffers, em bytes. */
  get memoryBytes() {
    return (this.buffers.length + 1) * this.time.length * 8;
  }
}

// O uPlot interrompe a curva em null, mas nao em NaN nem em Infinity (o eixo
// explode). inf/-inf continuam na memoria e no CSV; no desenho viram lacuna.
function withGaps(buffer, start, end) {
  for (let index = start; index < end; index += 1) {
    if (!Number.isFinite(buffer[index])) {
      const values = new Array(end - start);
      for (let position = start; position < end; position += 1) {
        const value = buffer[position];
        values[position - start] = Number.isFinite(value) ? value : null;
      }
      return values;
    }
  }
  return buffer.subarray(start, end);
}
