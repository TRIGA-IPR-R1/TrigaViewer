/*
TrigaViewer - visualizador web de graficos em tempo real do TrigaServer.
Copyright (C) 2026 Thalles Campagnani
Licenciado sob a GNU Affero General Public License v3 ou posterior.
*/

// app.js
//
// Liga as pecas da interface: leitura local do fluxo, armazenamento em
// memoria deste navegador e os cartoes de grafico.

import { DataStore } from './store.js';
import { TrigaStream } from './stream.js';
import { ChartCard } from './chart.js';
import { GaugeCard } from './gauge.js';
import { formatHeaderField, parseHeaderField } from './catalog.js';

const SETTINGS_KEY = 'trigaviewer.settings';
const LAYOUT_KEY = 'trigaviewer.layout';
const REDRAW_INTERVAL_MS = 200;
const RATE_WINDOW_S = 1;
const INTERVAL_MULTIPLIERS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const rateFormat = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const elements = {
  status: document.getElementById('status'),
  statusText: document.querySelector('#status .status-text'),
  metricSamples: document.getElementById('metric-samples'),
  metricRate: document.getElementById('metric-rate'),
  metricDuration: document.getElementById('metric-duration'),
  metricMemory: document.getElementById('metric-memory'),
  interval: document.getElementById('input-interval'),
  capacity: document.getElementById('input-capacity'),
  reading: document.getElementById('btn-reading'),
  addChart: document.getElementById('btn-add-chart'),
  addGauge: document.getElementById('btn-add-gauge'),
  window: document.getElementById('input-window'),
  pause: document.getElementById('btn-pause'),
  importCsv: document.getElementById('btn-import'),
  importFile: document.getElementById('input-import'),
  exportCsv: document.getElementById('btn-export'),
  exportCsvFull: document.getElementById('btn-export-full'),
  clear: document.getElementById('btn-clear'),
  charts: document.getElementById('charts'),
  emptyState: document.getElementById('empty-state'),
};

const settings = loadSettings();
const store = new DataStore(settings.capacity);
const charts = [];

let columns = [];
let paused = false;
let reading = true;
let lastStatus = { state: 'idle' };
let lastKeptTime = null;
let bridgeIntervalMs = 10;
let linkOnline = false;
let importedFromCsv = false;
let serverColumnNames = [];
let serverColumnUnits;

const stream = new TrigaStream({
  onReset: handleReset,
  onSamples: handleSamples,
  onStatus: handleStatus,
  onLink: handleLink,
});

// Ponto de inspecao pelo console do navegador (ex.: trigaViewer.store.length).
window.trigaViewer = { store, charts, stream };

initInterface();
stream.open();
stream.status().then(handleStatus).catch(() => {});
window.setInterval(redraw, REDRAW_INTERVAL_MS);
window.setInterval(updateMetrics, 500);

// --------------------------------------------------------------------
// Interface
// --------------------------------------------------------------------

function initInterface() {
  fillIntervalOptions(bridgeIntervalMs);
  elements.capacity.value = String(settings.capacity);
  elements.window.value = String(settings.windowSeconds);
  setReading(true);

  elements.reading.addEventListener('click', () => {
    if (!reading && importedFromCsv) prepareLiveReading();
    setReading(!reading);
  });

  elements.interval.addEventListener('change', () => {
    settings.clientIntervalMs = Number(elements.interval.value);
    lastKeptTime = null;
    saveSettings();
  });

  elements.capacity.addEventListener('change', () => {
    const capacity = Number(elements.capacity.value);
    if (capacity > 0 && store.length > capacity) {
      const drop = store.length - capacity;
      const formatted = new Intl.NumberFormat('pt-BR').format(drop);
      const ok = window.confirm(
        `Reduzir a memória vai descartar as ${formatted} amostras mais antigas. Tem certeza?`,
      );
      if (!ok) {
        elements.capacity.value = String(settings.capacity);
        return;
      }
    }
    store.setCapacity(capacity);
    settings.capacity = capacity;
    saveSettings();
    updateMetrics();
    redraw();
  });

  elements.window.addEventListener('change', () => {
    settings.windowSeconds = Number(elements.window.value);
    saveSettings();
    redraw();
  });

  elements.addChart.addEventListener('click', () => {
    const card = addChart();
    card.element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    card.firstPicker.focus();
  });

  elements.addGauge.addEventListener('click', () => {
    const card = addGauge();
    card.element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    card.firstPicker.focus();
  });

  elements.pause.addEventListener('click', () => {
    paused = !paused;
    elements.pause.classList.toggle('is-active', paused);
    elements.pause.textContent = paused ? 'Retomar desenho' : 'Pausar desenho';
    if (!paused) redraw();
  });

  elements.exportCsv.addEventListener('click', () => exportCsv(false));
  elements.exportCsvFull.addEventListener('click', () => exportCsv(true));
  elements.importCsv.addEventListener('click', () => elements.importFile.click());
  elements.importFile.addEventListener('change', handleImportFile);

  elements.clear.addEventListener('click', () => {
    if (store.length && !window.confirm('Descartar as amostras guardadas na memória?')) return;
    clearMemory();
  });

  restoreLayout();
  updateEmptyState();
  updateStatusDisplay();
}

function setReading(active) {
  reading = active;
  elements.reading.textContent = active ? 'Parar Leitura' : 'Iniciar Leitura';
  updateStatusDisplay();
}

function clearMemory() {
  store.clear();
  importedFromCsv = false;
  lastKeptTime = null;
  redraw();
  updateMetrics();
}

function prepareLiveReading() {
  importedFromCsv = false;
  if (serverColumnNames.length) applyColumns(serverColumnNames, serverColumnUnits);
  else store.clear();
  lastKeptTime = null;
  redraw();
  updateMetrics();
}

function applyColumns(names, units) {
  store.setColumns(names, units);
  columns = store.columns;
  for (const card of charts) card.setCatalog(columns);
}

function fillIntervalOptions(baseMs) {
  const current = Number(elements.interval.value) || settings.clientIntervalMs;
  const choices = INTERVAL_MULTIPLIERS.map((factor) => baseMs * factor);
  elements.interval.replaceChildren();
  for (const ms of choices) {
    const option = document.createElement('option');
    option.value = String(ms);
    option.textContent = formatInterval(ms);
    elements.interval.append(option);
  }

  let chosen = current;
  if (!choices.includes(chosen)) {
    chosen = choices.find((ms) => ms >= (current || baseMs)) || baseMs;
  }
  if (chosen < baseMs) chosen = baseMs;
  elements.interval.value = String(chosen);
  settings.clientIntervalMs = chosen;
}

function formatInterval(ms) {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (Number.isInteger(seconds)) return seconds === 1 ? '1 s' : `${seconds} s`;
  return `${seconds} s`;
}

// --------------------------------------------------------------------
// Fluxo de dados
// --------------------------------------------------------------------

function handleReset({ columns: names, units }) {
  // A primeira linha do fluxo CSV traz a lista de todas as variaveis.
  if (!names.length) return;
  serverColumnNames = names;
  serverColumnUnits = units;

  if (importedFromCsv) return;

  const changed = names.length !== columns.length
    || names.some((name, index) => name !== columns[index]?.key)
    || (Array.isArray(units) && units.some((unit, index) => (
      unit != null && unit !== columns[index]?.unit
    )));

  if (changed) {
    applyColumns(names, units);
    lastKeptTime = null;
  }

  redraw();
  updateMetrics();
}

function handleSamples(rows) {
  if (!reading) return;

  const intervalMs = Number(elements.interval.value) || bridgeIntervalMs;
  // Na taxa da ponte, grava tudo. O filtro por tempo descartava amostras
  // que a ponte carimbou no mesmo milissegundo (leitura em rajada do TCP).
  if (intervalMs <= bridgeIntervalMs) {
    if (!rows.length) return;
    store.pushMany(rows);
    lastKeptTime = rows[rows.length - 1][0];
    return;
  }

  const intervalS = intervalMs / 1000;
  const slack = bridgeIntervalMs / 2000;
  const kept = [];
  for (const row of rows) {
    const instant = row[0];
    if (lastKeptTime !== null && instant < lastKeptTime + intervalS - slack) continue;
    lastKeptTime = instant;
    kept.push(row);
  }
  if (kept.length) store.pushMany(kept);
}

function handleStatus(status) {
  lastStatus = status;
  if (status.intervalMs && status.intervalMs !== bridgeIntervalMs) {
    bridgeIntervalMs = status.intervalMs;
    fillIntervalOptions(bridgeIntervalMs);
    saveSettings();
  }
  updateStatusDisplay();
}

function handleLink(online) {
  linkOnline = online;
  updateStatusDisplay();
}

function updateStatusDisplay() {
  const connected = linkOnline && lastStatus.state === 'connected';
  let state;
  let label;
  if (!reading) {
    state = 'stopped';
    label = 'Parado';
  } else if (!connected) {
    state = 'disconnected';
    label = 'Servidor Desconectado';
  } else {
    const plc = store.latest('PLC_CONV_STATE') ?? store.latest('PLC_ORIG_STATE');
    if (plc === 1) {
      state = 'degraded';
      label = 'CLP: falha de leitura';
    } else if (plc === 2) {
      state = 'degraded';
      label = 'CLP desconectado';
    } else {
      state = 'reading';
      label = 'Lendo';
    }
  }
  elements.status.dataset.state = state;
  elements.statusText.textContent = label;
}

// --------------------------------------------------------------------
// Graficos
// --------------------------------------------------------------------

function addChart(config) {
  const card = new ChartCard({
    store,
    columns,
    config,
    onChange: saveLayout,
    onRemove: removeChart,
  });
  return mountCard(card);
}

function addGauge(config) {
  const card = new GaugeCard({
    store,
    columns,
    config,
    onChange: saveLayout,
    onRemove: removeChart,
  });
  return mountCard(card);
}

function mountCard(card) {
  charts.push(card);
  elements.charts.append(card.element);
  updateEmptyState();
  saveLayout();
  return card;
}

function removeChart(card) {
  const position = charts.indexOf(card);
  if (position >= 0) charts.splice(position, 1);
  card.destroy();
  updateEmptyState();
  saveLayout();
}

function updateEmptyState() {
  elements.emptyState.hidden = charts.length > 0;
}

function redraw() {
  if (paused) return;
  const windowSeconds = Number(elements.window.value);
  const last = store.lastTime;
  const fromTime = windowSeconds > 0 && last !== null ? last - windowSeconds : null;
  for (const card of charts) card.render(fromTime);
}

// --------------------------------------------------------------------
// Metricas do cabecalho
// --------------------------------------------------------------------

function updateMetrics() {
  updateStatusDisplay();
  elements.metricSamples.textContent = new Intl.NumberFormat('pt-BR').format(store.length);
  elements.metricRate.textContent = formatRate();

  // Instantes das amostras vem do relogio da ponte, nao do navegador:
  // um cliente dessincronizado faria a duracao nascer diferente de 0.
  const first = store.firstTime;
  const last = store.lastTime;
  elements.metricDuration.textContent = first !== null && last !== null
    ? formatDuration(last - first)
    : '—';

  const megabytes = store.memoryBytes / (1024 * 1024);
  elements.metricMemory.textContent = store.columns.length
    ? `${megabytes.toFixed(0)} MB`
    : '—';
}

function formatRate() {
  const last = store.lastTime;
  const first = store.firstTime;
  if (!reading || last === null || first === null || last - first < RATE_WINDOW_S) {
    return '—';
  }
  const start = store.indexAtTime(last - RATE_WINDOW_S);
  const count = store.length - start;
  if (count < 2) {
    return `${rateFormat.format(count / RATE_WINDOW_S)} Hz`;
  }
  const span = last - store.time[start];
  if (span <= 0) return '—';
  return `${rateFormat.format((count - 1) / span)} Hz`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}min`;
  if (minutes) return `${minutes}min ${String(rest).padStart(2, '0')}s`;
  return `${rest}s`;
}

// --------------------------------------------------------------------
// Exportacao
// --------------------------------------------------------------------

function csvNumber(value) {
  if (Number.isNaN(value)) return '';
  if (value === Infinity) return 'inf';
  if (value === -Infinity) return '-inf';
  return String(value);
}

function parseCsvNumber(raw) {
  if (raw === undefined || raw === '') return null;
  const token = raw.trim().toLowerCase();
  if (token === 'inf' || token === '+inf' || token === 'infinity') return Infinity;
  if (token === '-inf' || token === '-infinity') return -Infinity;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function exportCsv(complete = false) {
  if (!store.length) {
    window.alert('Não há amostras na memória para exportar.');
    return;
  }

  // Completo: todas as variaveis. O outro botao: so as que estao na tela.
  const plotted = new Set(charts.flatMap((card) => card.keys));
  const selected = complete || !plotted.size
    ? store.columns
    : store.columns.filter((column) => plotted.has(column.key));

  const lines = [['tempo_iso', 'tempo_epoch_s', ...selected.map(
    (column) => formatHeaderField(column.key, column.unit),
  )].join(';')];
  for (let index = 0; index < store.length; index += 1) {
    const instant = store.time[index];
    const row = [new Date(instant * 1000).toISOString(), instant.toFixed(3)];
    for (const column of selected) {
      const value = store.buffers[column.index][index];
      row.push(csvNumber(value));
    }
    lines.push(row.join(';'));
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `trigaviewer-${complete ? 'completo-' : ''}${stamp}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function handleImportFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      importCsv(String(reader.result || ''));
    } catch (error) {
      window.alert(error.message || 'Não foi possível importar o CSV.');
    }
  };
  reader.onerror = () => {
    window.alert('Não foi possível ler o arquivo.');
  };
  reader.readAsText(file);
}

function importCsv(text) {
  const parsed = parseExportedCsv(text);
  setReading(false);
  applyColumns(parsed.names, parsed.units);
  importedFromCsv = true;
  lastKeptTime = null;

  if (store.capacity > 0 && parsed.rows.length > store.capacity) {
    store.setCapacity(0);
    elements.capacity.value = '0';
    settings.capacity = 0;
    saveSettings();
  }
  store.pushMany(parsed.rows);
  redraw();
  updateMetrics();
}

function parseExportedCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    throw new Error('O CSV não contém amostras.');
  }

  const header = lines[0].split(';').map((field) => field.trim());
  const epochIndex = header.indexOf('tempo_epoch_s');
  const isoIndex = header.indexOf('tempo_iso');
  if (epochIndex < 0 && isoIndex < 0) {
    throw new Error('O CSV precisa da coluna tempo_epoch_s ou tempo_iso.');
  }

  const names = header.filter((_, index) => index !== epochIndex && index !== isoIndex);
  if (!names.length) {
    throw new Error('O CSV não contém variáveis para importar.');
  }

  const parsedNames = names.map(parseHeaderField);
  const keys = parsedNames.map((item) => item.key);
  const units = parsedNames.map((item) => item.unit);

  const rows = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const fields = lines[lineIndex].split(';');
    let instant = NaN;
    if (epochIndex >= 0 && fields[epochIndex]) instant = Number(fields[epochIndex]);
    if (!Number.isFinite(instant) && isoIndex >= 0 && fields[isoIndex]) {
      instant = Date.parse(fields[isoIndex]) / 1000;
    }
    if (!Number.isFinite(instant)) continue;

    const row = [instant];
    for (const name of names) {
      const raw = fields[header.indexOf(name)];
      row.push(parseCsvNumber(raw));
    }
    rows.push(row);
  }

  if (!rows.length) {
    throw new Error('O CSV não contém amostras válidas.');
  }
  return { names: keys, units, rows };
}

// --------------------------------------------------------------------
// Preferencias
// --------------------------------------------------------------------

function loadSettings() {
  const defaults = {
    clientIntervalMs: null,
    capacity: 50000,
    windowSeconds: 300,
  };
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      ...defaults,
      capacity: Number.isFinite(stored.capacity) ? stored.capacity : defaults.capacity,
      windowSeconds: Number.isFinite(stored.windowSeconds)
        ? stored.windowSeconds : defaults.windowSeconds,
      clientIntervalMs: Number.isFinite(stored.clientIntervalMs)
        ? stored.clientIntervalMs : defaults.clientIntervalMs,
    };
  } catch (error) {
    return defaults;
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      clientIntervalMs: settings.clientIntervalMs,
      capacity: settings.capacity,
      windowSeconds: settings.windowSeconds,
    }));
  } catch (error) {
    /* navegador sem armazenamento local: as preferencias so nao persistem */
  }
}

function saveLayout() {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(charts.map((card) => card.serialize())));
  } catch (error) {
    /* idem */
  }
}

function restoreLayout() {
  let layout;
  try {
    layout = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '[]');
  } catch (error) {
    layout = [];
  }
  if (!Array.isArray(layout)) return;
  for (const config of layout) {
    const card = config.kind === 'mostrador' ? addGauge(config) : addChart(config);
    card.element.classList.toggle('is-tall', card.tall);
  }
}
