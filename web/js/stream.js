/*
TrigaViewer - visualizador web de graficos em tempo real do TrigaServer.
Copyright (C) 2026 Thalles Campagnani
Licenciado sob a GNU Affero General Public License v3 ou posterior.
*/

// stream.js
//
// Cliente da ponte Python: recebe as amostras pelo fluxo de eventos
// (Server-Sent Events). A conexao ponte-TrigaServer nao e comandada daqui.

export class TrigaStream {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.source = null;
    this.generation = null;
    this.online = false;
  }

  /** Abre o fluxo de eventos. O proprio navegador refaz a conexao se cair. */
  open() {
    if (this.source) return;
    // Caminho relativo: funciona na raiz (:8081) e atras do proxy (/Viewer/).
    const source = new EventSource(new URL('api/stream', document.baseURI).href);
    this.source = source;

    source.onopen = () => {
      this.online = true;
      this.emit('onLink', true);
    };

    source.onerror = () => {
      // O EventSource tenta reconectar sozinho; so avisamos a interface.
      this.online = false;
      this.emit('onLink', false);
    };

    source.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      this.dispatch(message);
    };
  }

  dispatch(message) {
    switch (message.type) {
      case 'hello':
        // Chega ao abrir a pagina e sempre que o fluxo SSE e restabelecido.
        // Se a geracao nao mudou, os dados locais continuam validos.
        if (this.generation !== null && this.generation === message.generation) {
          this.emit('onStatus', message.status);
          break;
        }
        this.generation = message.generation;
        this.emit('onReset', {
          generation: message.generation,
          columns: message.columns,
          units: message.units,
          status: message.status,
        });
        this.emit('onStatus', message.status);
        break;

      case 'columns':
        this.generation = message.generation;
        this.emit('onReset', {
          generation: message.generation,
          columns: message.columns,
          units: message.units,
          status: message.status,
        });
        this.emit('onStatus', message.status);
        break;

      case 'samples':
        if (message.generation !== this.generation) return;
        this.emit('onSamples', message.rows);
        break;

      case 'status':
        this.emit('onStatus', message.status);
        break;

      default:
        break;
    }
  }

  emit(name, payload) {
    const handler = this.handlers[name];
    if (handler) handler(payload);
  }

  async status() {
    const response = await fetch(new URL('api/status', document.baseURI).href);
    if (!response.ok) throw new Error('Nao foi possivel consultar o estado.');
    return response.json();
  }
}
