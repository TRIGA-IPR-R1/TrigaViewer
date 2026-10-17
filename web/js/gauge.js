/*
TrigaViewer - visualizador web de graficos em tempo real do TrigaServer.
Copyright (C) 2026 Thalles Campagnani
Licenciado sob a GNU Affero General Public License v3 ou posterior.
*/

// gauge.js
//
// Cartao mostrador: o valor atual de uma unica variavel, em tipo grande,
// no lugar de um grafico.

import { NO_UNIT } from './catalog.js';
import { VariablePicker } from './picker.js';

const gaugeFormats = new Map();

function fractionDigits(value) {
  const magnitude = Math.abs(value);
  if (magnitude === 0) return 2;
  let digits = 2;
  let threshold = 2;
  while (magnitude < threshold && digits < 12) {
    digits += 1;
    threshold /= 10;
  }
  return digits;
}

function formatGaugeValue(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (value === Infinity) return 'inf';
  if (value === -Infinity) return '-inf';
  const digits = fractionDigits(value);
  let format = gaugeFormats.get(digits);
  if (!format) {
    format = new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    gaugeFormats.set(digits, format);
  }
  return format.format(value);
}

let nextGaugeId = 1;

export class GaugeCard {
  constructor({ store, columns, onChange, onRemove, config = {} }) {
    this.store = store;
    this.columns = columns || [];
    this.onChange = onChange || (() => {});
    this.onRemove = onRemove || (() => {});

    this.id = config.id || `mostrador-${nextGaugeId}`;
    nextGaugeId += 1;
    this.keys = [];
    this.unit = null;
    this.tall = Boolean(config.tall);
    this.title = config.title || `Mostrador ${this.id.split('-')[1] || ''}`.trim();
    this.titleTouched = Boolean(config.title);
    this.pendingKeys = Array.isArray(config.keys) ? [...config.keys] : [];

    this.build();
  }

  build() {
    const template = document.getElementById('gauge-template');
    this.element = template.content.firstElementChild.cloneNode(true);
    this.element.dataset.chartId = this.id;
    this.element.classList.toggle('is-tall', this.tall);

    this.titleInput = this.element.querySelector('.chart-title');
    this.placeholder = this.element.querySelector('.gauge-placeholder');
    this.face = this.element.querySelector('.gauge-face');
    this.valueEl = this.element.querySelector('.gauge-value');
    this.unitEl = this.element.querySelector('.gauge-unit');
    this.firstPicker = new VariablePicker(this.element.querySelector('.first-picker'));
    this.changePicker = new VariablePicker(this.element.querySelector('.change-picker'), {
      autoApply: true,
      onChoose: (key) => this.setVariable(key),
    });
    this.firstSelect = this.firstPicker.firstSelect;
    this.footer = this.element.querySelector('.chart-foot');

    this.titleInput.value = this.title;
    this.titleInput.addEventListener('input', () => {
      this.title = this.titleInput.value;
      this.titleTouched = true;
      this.onChange();
    });

    this.element.querySelector('[data-action="add-first"]').addEventListener('click', () => {
      if (this.firstPicker.value) this.setVariable(this.firstPicker.value);
    });
    this.element.querySelector('[data-action="remove"]').addEventListener('click', () => {
      this.onRemove(this);
    });
    this.element.querySelector('[data-action="height"]').addEventListener('click', () => {
      this.tall = !this.tall;
      this.element.classList.toggle('is-tall', this.tall);
      this.onChange();
    });

    this.setCatalog(this.columns);
  }

  setCatalog(columns) {
    this.columns = columns || [];
    this.byKey = new Map(this.columns.map((column) => [column.key, column]));

    if (this.columns.length) {
      if (this.keys[0] && !this.byKey.has(this.keys[0])) this.keys = [];
      const pending = this.pendingKeys;
      this.pendingKeys = [];
      const next = pending.find((key) => this.byKey.has(key));
      if (next) this.setVariable(next, { silent: true });
    }

    this.refreshSelects();
    this.updateFace();
  }

  refreshSelects() {
    this.firstPicker.setColumns(this.columns);
    this.changePicker.setColumns(this.columns);
  }

  setVariable(key, { silent = false } = {}) {
    const column = this.byKey.get(key);
    if (!column) return false;

    this.keys = [key];
    this.unit = column.unit;
    if (!this.titleTouched) {
      this.title = column.titleLabel || column.label;
      this.titleInput.value = this.title;
    }

    this.placeholder.hidden = true;
    this.face.hidden = false;
    this.footer.hidden = false;
    this.refreshSelects();
    this.updateFace();
    if (!silent) this.onChange();
    return true;
  }

  render() {
    this.updateFace();
  }

  updateFace() {
    const key = this.keys[0];
    if (!key) {
      this.valueEl.textContent = 'sem leitura';
      this.valueEl.classList.add('is-missing');
      this.unitEl.textContent = '';
      return;
    }
    const column = this.byKey.get(key);
    const value = this.store.latest(key);
    const missing = value === null || value === undefined || Number.isNaN(value);
    this.valueEl.classList.toggle('is-missing', missing);
    this.valueEl.textContent = missing ? 'sem leitura' : formatGaugeValue(value);
    this.unitEl.textContent = column && column.unit && column.unit !== NO_UNIT
      ? column.unit
      : '';
  }

  serialize() {
    return {
      kind: 'mostrador',
      id: this.id,
      title: this.title,
      keys: [...this.keys, ...this.pendingKeys],
      tall: this.tall,
    };
  }

  destroy() {
    this.element.remove();
  }
}
