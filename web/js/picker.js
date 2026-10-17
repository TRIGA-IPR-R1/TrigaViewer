/*
TrigaViewer - visualizador web de graficos em tempo real do TrigaServer.
Copyright (C) 2026 Thalles Campagnani
Licenciado sob a GNU Affero General Public License v3 ou posterior.
*/

// picker.js
//
// Tres seletores em cascata: dispositivo, canal e campo. A lista de
// campos so aparece depois das duas escolhas anteriores.

function fillOptions(select, items, placeholder) {
  const previous = select.value;
  select.replaceChildren();

  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = placeholder;
  select.append(empty);

  for (const item of items) {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    if (item.title) option.title = item.title;
    select.append(option);
  }

  select.disabled = items.length === 0;
  if (previous && items.some((item) => item.value === previous)) {
    select.value = previous;
  }
  return select.value;
}

function uniqueInOrder(columns, valueKey, labelKey) {
  const seen = new Map();
  for (const column of columns) {
    if (!seen.has(column[valueKey])) {
      seen.set(column[valueKey], column[labelKey]);
    }
  }
  return [...seen].map(([value, label]) => ({ value, label }));
}

function fieldLabel(column) {
  const unit = column.unit;
  if (unit === undefined || unit === null || unit === '') return column.label;
  return `${column.label} [${unit}]`;
}

export class VariablePicker {
  constructor(root, options = {}) {
    this.root = root;
    this.deviceSelect = root.querySelector('.device-select');
    this.channelSelect = root.querySelector('.channel-select');
    this.fieldSelect = root.querySelector('.field-select');
    this.columns = [];
    this.filter = options.filter || (() => true);
    this.autoApply = Boolean(options.autoApply);
    this.placeholders = {
      device: options.placeholderDevice || 'Dispositivo...',
      channel: options.placeholderChannel || 'Canal...',
      field: options.placeholderField || 'Variável...',
    };

    this.deviceSelect.addEventListener('change', () => this.rebuildFromDevice());
    this.channelSelect.addEventListener('change', () => this.rebuildFromChannel());
    this.fieldSelect.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && this.value) this.emitChoose();
    });
    this.fieldSelect.addEventListener('change', () => {
      if (this.autoApply && this.value) this.emitChoose();
    });
    this.onChoose = options.onChoose || (() => {});
  }

  get value() {
    return this.fieldSelect.value;
  }

  get firstSelect() {
    return this.deviceSelect;
  }

  setColumns(columns) {
    this.columns = columns || [];
    this.rebuild();
  }

  setFilter(filter) {
    this.filter = filter || (() => true);
    this.rebuild();
  }

  available() {
    return this.columns.filter(this.filter);
  }

  rebuild() {
    const available = this.available();
    const devices = uniqueInOrder(available, 'device', 'deviceLabel');
    fillOptions(this.deviceSelect, devices, this.placeholders.device);
    this.rebuildFromDevice();
  }

  rebuildFromDevice() {
    const device = this.deviceSelect.value;
    const available = this.available().filter((column) => column.device === device);
    const channels = device
      ? uniqueInOrder(available, 'channel', 'channelLabel')
      : [];
    fillOptions(this.channelSelect, channels, this.placeholders.channel);
    if (!device) this.channelSelect.disabled = true;
    this.rebuildFromChannel();
  }

  rebuildFromChannel() {
    const device = this.deviceSelect.value;
    const channel = this.channelSelect.value;
    const fields = (device && channel)
      ? this.available()
        .filter((column) => column.device === device && column.channel === channel)
        .map((column) => ({
          value: column.key,
          label: fieldLabel(column),
          title: column.key,
        }))
      : [];
    fillOptions(this.fieldSelect, fields, this.placeholders.field);
    if (!channel) this.fieldSelect.disabled = true;
  }

  focus() {
    this.deviceSelect.focus();
  }

  emitChoose() {
    if (this.value) this.onChoose(this.value);
  }
}
