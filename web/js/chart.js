/*
TrigaViewer - visualizador web de graficos em tempo real do TrigaServer.
Copyright (C) 2026 Thalles Campagnani
Licenciado sob a GNU Affero General Public License v3 ou posterior.
*/

// chart.js
//
// Um cartao de grafico: unidade de medida no eixo Y, tempo no eixo X.
// A primeira variavel escolhida fixa a unidade do grafico; a partir dai o
// seletor de "adicionar variavel" so oferece variaveis da mesma unidade.

import { unitDescription } from './catalog.js';
import { VariablePicker } from './picker.js';

const PALETTE = [
  '#4cc2ff', '#ffd166', '#7ee787', '#ff7b72', '#c39bff',
  '#ff9f4a', '#4de0c0', '#ff8fc7', '#9bb0ff', '#d4e157',
];

const AXIS_COLOR = '#8494ad';
const GRID_COLOR = 'rgba(140, 160, 190, 0.14)';

let nextChartId = 1;

export class ChartCard {
  constructor({ store, columns, onChange, onRemove, config = {} }) {
    this.store = store;
    this.columns = columns || [];
    this.onChange = onChange || (() => {});
    this.onRemove = onRemove || (() => {});

    this.id = config.id || `grafico-${nextChartId}`;
    nextChartId += 1;
    this.keys = [];
    this.unit = null;
    this.logScale = Boolean(config.logScale);
    this.tall = Boolean(config.tall);
    this.following = true;
    this.title = config.title || `Gráfico ${this.id.split('-')[1] || ''}`.trim();
    this.titleTouched = Boolean(config.title);

    this.plot = null;
    this.plotKeys = [];
    this.cursorIndex = null;
    this.sliceStart = 0;

    // Curvas de um layout salvo: so podem ser criadas quando o cabecalho CSV
    // com a lista de variaveis chegar.
    this.pendingKeys = Array.isArray(config.keys) ? [...config.keys] : [];
    this.build();
  }

  // ----------------------------------------------------------------
  // Construcao do cartao
  // ----------------------------------------------------------------

  build() {
    const template = document.getElementById('chart-template');
    this.element = template.content.firstElementChild.cloneNode(true);
    this.element.dataset.chartId = this.id;

    this.titleInput = this.element.querySelector('.chart-title');
    this.plotElement = this.element.querySelector('.chart-plot');
    this.placeholder = this.element.querySelector('.chart-placeholder');
    this.firstPicker = new VariablePicker(this.element.querySelector('.first-picker'));
    this.addPicker = new VariablePicker(this.element.querySelector('.add-picker'));
    this.firstSelect = this.firstPicker.firstSelect;
    this.addButton = this.element.querySelector('[data-action="add-series"]');
    this.seriesList = this.element.querySelector('.series-list');
    this.unitHint = this.element.querySelector('.unit-hint');
    this.footer = this.element.querySelector('.chart-foot');
    this.followButton = this.element.querySelector('[data-action="follow"]');
    this.logButton = this.element.querySelector('[data-action="log"]');

    this.titleInput.value = this.title;
    this.titleInput.addEventListener('input', () => {
      this.title = this.titleInput.value;
      this.titleTouched = true;
      this.onChange();
    });

    this.element.querySelector('[data-action="add-first"]').addEventListener('click', () => {
      if (this.firstPicker.value) this.addVariable(this.firstPicker.value);
    });
    this.addButton.addEventListener('click', () => {
      if (this.addPicker.value) this.addVariable(this.addPicker.value);
    });
    this.element.querySelector('[data-action="remove"]').addEventListener('click', () => {
      this.onRemove(this);
    });
    this.followButton.addEventListener('click', () => {
      this.following = !this.following;
      this.updateToolButtons();
    });
    this.logButton.addEventListener('click', () => {
      this.logScale = !this.logScale;
      this.updateToolButtons();
      this.rebuildPlot();
      this.onChange();
    });
    this.element.querySelector('[data-action="height"]').addEventListener('click', () => {
      this.tall = !this.tall;
      this.element.classList.toggle('is-tall', this.tall);
      this.resize();
      this.onChange();
    });

    // O duplo clique do proprio uPlot desfaz o zoom; aproveitamos para
    // retomar o acompanhamento em tempo real.
    this.plotElement.addEventListener('dblclick', () => {
      this.following = true;
      this.updateToolButtons();
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.plotElement);

    this.setCatalog(this.columns);
    this.updateToolButtons();
    this.updateFooter();
  }

  // ----------------------------------------------------------------
  // Variaveis disponiveis
  // ----------------------------------------------------------------

  /** Recebe a lista de variaveis do cabecalho CSV e repovoa os seletores. */
  setCatalog(columns) {
    this.columns = columns || [];
    this.byKey = new Map(this.columns.map((column) => [column.key, column]));

    if (this.columns.length) {
      // Descarta curvas que nao existem mais no fluxo atual.
      for (const key of this.keys.filter((key) => !this.byKey.has(key))) {
        this.removeVariable(key, { silent: true });
      }
      // Recria as curvas de um layout restaurado.
      const pending = this.pendingKeys;
      this.pendingKeys = [];
      for (const key of pending) this.addVariable(key, { silent: true });
    }

    this.refreshSelects();
    this.updateFooter();
  }

  refreshSelects() {
    const chosen = new Set(this.keys);
    this.firstPicker.setFilter((column) => !chosen.has(column.key));
    this.firstPicker.setColumns(this.columns);

    const compatible = (column) => !chosen.has(column.key)
      && (this.unit === null || column.unit === this.unit);
    this.addPicker.setFilter(compatible);
    this.addPicker.setColumns(this.columns);

    const empty = this.columns.filter(compatible).length === 0;
    this.addButton.disabled = empty;
    this.addButton.title = empty && this.unit !== null
      ? `Não há outras variáveis medidas em ${this.unit}.`
      : 'Adicionar outra curva ao gráfico';
  }

  // ----------------------------------------------------------------
  // Curvas
  // ----------------------------------------------------------------

  addVariable(key, { silent = false } = {}) {
    const column = this.byKey.get(key);
    if (!column || this.keys.includes(key)) return false;
    // A unidade do grafico e definida pela primeira variavel plotada.
    if (this.unit !== null && column.unit !== this.unit) return false;

    if (this.unit === null) {
      this.unit = column.unit;
      if (!this.titleTouched) {
        this.title = column.titleLabel || column.label;
        this.titleInput.value = this.title;
      }
    }
    this.keys.push(key);

    this.refreshSelects();
    this.rebuildPlot();
    this.updateFooter();
    if (!silent) this.onChange();
    return true;
  }

  removeVariable(key, { silent = false } = {}) {
    const position = this.keys.indexOf(key);
    if (position < 0) return;
    this.keys.splice(position, 1);
    if (this.keys.length === 0) {
      this.unit = null;
    }
    this.refreshSelects();
    this.rebuildPlot();
    this.updateFooter();
    if (!silent) this.onChange();
  }

  colorOf(key) {
    return PALETTE[this.keys.indexOf(key) % PALETTE.length];
  }

  // ----------------------------------------------------------------
  // Grafico
  // ----------------------------------------------------------------

  rebuildPlot() {
    if (this.plot) {
      this.plot.destroy();
      this.plot = null;
    }
    const hasSeries = this.keys.length > 0;
    this.placeholder.hidden = hasSeries;
    this.plotElement.hidden = !hasSeries;
    if (!hasSeries) {
      this.plotKeys = [];
      return;
    }

    const { width, height } = this.plotSize();
    const options = {
      width,
      height,
      padding: [14, 18, 0, 6],
      legend: { show: false },
      cursor: {
        drag: { x: true, y: false },
        focus: { prox: 24 },
      },
      scales: {
        x: { time: true },
        y: { distr: this.logScale ? 3 : 1, log: 10 },
      },
      axes: [
        {
          stroke: AXIS_COLOR,
          grid: { stroke: GRID_COLOR, width: 1 },
          ticks: { stroke: GRID_COLOR, width: 1 },
          font: '12px ui-sans-serif, system-ui, sans-serif',
          space: 80,
          values: (plot, splits) => splits.map((instant) => formatClock(instant, splits)),
        },
        {
          stroke: AXIS_COLOR,
          grid: { stroke: GRID_COLOR, width: 1 },
          ticks: { stroke: GRID_COLOR, width: 1 },
          font: '12px ui-sans-serif, system-ui, sans-serif',
          label: this.unit,
          labelFont: '600 12px ui-sans-serif, system-ui, sans-serif',
          labelSize: 22,
          size: 62,
        },
      ],
      series: [
        { label: 'Tempo' },
        ...this.keys.map((key) => {
          const column = this.byKey.get(key);
          return {
            label: column ? column.short : key,
            stroke: this.colorOf(key),
            width: 1.6,
            spanGaps: false,
            points: { show: false },
          };
        }),
      ],
      hooks: {
        setSelect: [
          (plot) => {
            // Arrastar sobre o grafico para ampliar congela a janela; voltar
            // ao tempo real e feito pelo botao ou por um duplo clique.
            if (plot.select.width > 0 && this.following) {
              this.following = false;
              this.updateToolButtons();
            }
          },
        ],
        setCursor: [
          (plot) => {
            this.cursorIndex = plot.cursor.idx == null ? null : plot.cursor.idx;
            this.updateValues();
          },
        ],
      },
    };

    this.plot = new uPlot(options, [new Float64Array(0),
      ...this.keys.map(() => new Float64Array(0))], this.plotElement);
    this.plotKeys = [...this.keys];
  }

  plotSize() {
    const rect = this.plotElement.getBoundingClientRect();
    return {
      width: Math.max(120, Math.floor(rect.width)),
      height: Math.max(120, Math.floor(rect.height)),
    };
  }

  resize() {
    if (!this.plot) return;
    const { width, height } = this.plotSize();
    this.plot.setSize({ width, height });
  }

  /** Redesenha com a janela de tempo pedida (em segundos epoch). */
  render(fromTime) {
    if (!this.plot || !this.keys.length) return;
    if (!sameKeys(this.plotKeys, this.keys)) this.rebuildPlot();

    this.sliceStart = fromTime == null
      ? 0
      : Math.max(0, this.store.indexAtTime(fromTime) - 1);
    const data = this.store.slice(this.keys, fromTime);

    // Enquanto acompanha o tempo real os eixos seguem os dados. A segunda
    // condicao cobre o grafico recem-criado, que ainda nao tem escala.
    const rescale = this.following || this.plot.scales.x.min == null;
    this.plot.setData(data, rescale);

    if (this.cursorIndex === null) this.updateValues();
  }

  // ----------------------------------------------------------------
  // Rodape: curvas, valores e unidade
  // ----------------------------------------------------------------

  updateFooter() {
    this.seriesList.replaceChildren();
    for (const key of this.keys) {
      const column = this.byKey.get(key);
      const item = document.createElement('li');
      item.className = 'series-chip';
      item.dataset.key = key;

      const swatch = document.createElement('span');
      swatch.className = 'series-color';
      swatch.style.background = this.colorOf(key);

      const name = document.createElement('span');
      name.className = 'series-name';
      name.textContent = column ? column.short : key;
      name.title = column ? `${column.label} — ${column.key}` : key;

      const value = document.createElement('span');
      value.className = 'series-value';
      value.textContent = '—';

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'series-remove';
      remove.setAttribute('aria-label', `Remover ${column ? column.short : key}`);
      remove.title = 'Remover esta curva';
      remove.textContent = '×';
      remove.addEventListener('click', () => this.removeVariable(key));

      item.append(swatch, name, value, remove);
      this.seriesList.append(item);
    }

    this.footer.hidden = this.keys.length === 0;
    if (this.unit === null) {
      this.unitHint.textContent = '';
    } else if (this.unit === '') {
      this.unitHint.textContent = 'Eixo Y adimensional. Só é possível somar curvas nessa mesma unidade.';
    } else {
      this.unitHint.textContent = `Eixo Y em ${this.unit} — ${unitDescription(this.unit)}. Só é possível somar curvas nessa mesma unidade.`;
    }
    this.updateValues();
  }

  updateValues() {
    const position = this.cursorIndex === null
      ? this.store.length - 1
      : this.sliceStart + this.cursorIndex;
    for (const item of this.seriesList.children) {
      const value = this.store.valueAt(item.dataset.key, position);
      item.querySelector('.series-value').textContent = formatValue(value);
    }
  }

  updateToolButtons() {
    this.followButton.classList.toggle('is-active', this.following);
    this.followButton.title = this.following
      ? 'Acompanhando o tempo real (clique para congelar a janela)'
      : 'Janela congelada (clique para voltar ao tempo real)';
    this.logButton.classList.toggle('is-active', this.logScale);
  }

  // ----------------------------------------------------------------

  serialize() {
    return {
      id: this.id,
      title: this.title,
      // Antes do cabecalho chegar as curvas ainda estao em espera.
      keys: [...this.keys, ...this.pendingKeys],
      logScale: this.logScale,
      tall: this.tall,
    };
  }

  destroy() {
    this.resizeObserver.disconnect();
    if (this.plot) this.plot.destroy();
    this.element.remove();
  }
}

// --------------------------------------------------------------------
// Auxiliares
// --------------------------------------------------------------------

// Marcas do eixo do tempo como hora local; os milissegundos so aparecem
// quando a janela e curta o bastante para que facam diferenca.
function formatClock(instant, splits) {
  const date = new Date(instant * 1000);
  const clock = date.toLocaleTimeString('pt-BR', { hour12: false });
  const step = splits.length > 1 ? splits[1] - splits[0] : 1;
  if (step >= 1) return clock;
  return `${clock},${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function sameKeys(left, right) {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

const decimalFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
const scientificFormat = new Intl.NumberFormat('pt-BR', {
  notation: 'scientific',
  maximumFractionDigits: 3,
});

export function formatValue(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (value === Infinity) return 'inf';
  if (value === -Infinity) return '-inf';
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude >= 1e5 || magnitude < 1e-3)) {
    return scientificFormat.format(value);
  }
  return decimalFormat.format(value);
}
