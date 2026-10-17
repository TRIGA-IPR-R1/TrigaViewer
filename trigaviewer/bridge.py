"""
TrigaViewer is a web viewer for the real-time data stream of the
Nuclear Reactor Triga IPR-R1, served by TrigaServer.
Copyright (C) 2026 Thalles Campagnani

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
"""

# bridge.py
#
# Ponte entre o servidor CSV do TrigaServer (socket TCP) e o navegador.
#
# Protocolo do TrigaServer (src/TrigaServer.cpp, metodo handleTCPClients):
#   1. O cliente abre uma conexao TCP;
#   2. O cliente envia a taxa de amostragem desejada, em milissegundos,
#      como texto contendo apenas digitos;
#   3. O servidor responde com uma unica linha de cabecalho contendo o nome
#      de todas as variaveis no formato Nome[unidade], separadas por ';' e
#      terminada em '\n'. Unidade vazia (Nome[]) e adimensional. Servidores
#      antigos podem omitir [unidade]; nesse caso o catalogo local e usado;
#   4. Em seguida o servidor envia, indefinidamente e no intervalo pedido,
#      uma linha por amostra, no mesmo formato do cabecalho.

from __future__ import annotations

import math
import queue
import socket
import threading
import time

# Valor usado pelo TrigaServer para marcar variavel nao lida do CLP.
# E convertido para None (null no JSON) para virar uma lacuna no grafico.
INVALID_VALUE = -123456.0

# Tolerancia da comparacao com INVALID_VALUE (o valor trafega como "%f").
INVALID_EPSILON = 1e-3

CONNECT_TIMEOUT_S = 1.0
RECV_TIMEOUT_S = 30.0
RECONNECT_DELAY_S = 1.0

# Limite de amostras acumuladas por assinante antes de considera-lo atrasado.
SUBSCRIBER_QUEUE_SIZE = 4096


class TrigaBridge:
    """Mantem uma conexao com o TrigaServer e distribui as amostras recebidas.

    A classe e segura para uso concorrente: a thread de leitura do socket
    publica amostras em filas, uma por assinante (cada aba do navegador
    conectada ao endpoint SSE e um assinante).
    """

    def __init__(self, auto_reconnect: bool = True):
        self._lock = threading.RLock()
        self._subscribers: set[queue.Queue] = set()
        self._columns: list[str] = []
        self._units: list[str | None] = []
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._sock: socket.socket | None = None
        self._auto_reconnect = auto_reconnect
        self._awaiting_header = False

        # "generation" identifica cada sessao de conexao. O navegador usa esse
        # numero para saber que precisa descartar os dados antigos.
        self._generation = 0
        self._state = "idle"
        self._host = ""
        self._port = 0
        self._interval_ms = 0
        self._samples = 0
        self._connected_since: float | None = None
        self._last_sample_at: float | None = None
        self._last_csv_fields: list[str] | None = None
        self._last_error: str | None = None

    # ------------------------------------------------------------------
    # Estado
    # ------------------------------------------------------------------

    def status(self) -> dict:
        with self._lock:
            return {
                "state": self._state,
                "host": self._host,
                "port": self._port,
                "intervalMs": self._interval_ms,
                "generation": self._generation,
                "samples": self._samples,
                "columnCount": len(self._columns),
                "connectedSince": self._connected_since,
                "lastSampleAt": self._last_sample_at,
                "lastError": self._last_error,
                "autoReconnect": self._auto_reconnect,
            }

    def _set_state(self, state: str, error: str | None = None,
                   clear_error: bool = False) -> None:
        with self._lock:
            self._state = state
            # O motivo da ultima falha continua visivel durante as tentativas
            # de reconexao; so some quando a conexao volta a funcionar.
            if error is not None:
                self._last_error = error
            elif clear_error:
                self._last_error = None
        self._publish({"type": "status", "status": self.status()})

    # ------------------------------------------------------------------
    # Conexao
    # ------------------------------------------------------------------

    def connect(self, host: str, port: int, interval_ms: int) -> dict:
        """Encerra a sessao anterior (se houver) e inicia uma nova."""
        host = (host or "").strip()
        if not host:
            raise ValueError("Endereco IP do TrigaServer nao informado.")
        if not (0 < int(port) < 65536):
            raise ValueError("Porta invalida: use um valor entre 1 e 65535.")
        if int(interval_ms) < 1:
            raise ValueError("A taxa de amostragem deve ser de pelo menos 1 ms.")

        self.disconnect()

        with self._lock:
            self._generation += 1
            generation = self._generation
            self._host = host
            self._port = int(port)
            self._interval_ms = int(interval_ms)
            self._samples = 0
            self._columns = []
            self._connected_since = None
            self._last_sample_at = None
            self._last_csv_fields = None
            self._last_error = None
            self._state = "connecting"
            self._stop = threading.Event()
            stop = self._stop
            self._thread = threading.Thread(
                target=self._run,
                args=(generation, host, int(port), int(interval_ms), stop),
                name=f"triga-bridge-{generation}",
                daemon=True,
            )
            thread = self._thread

        self._publish({"type": "status", "status": self.status()})
        thread.start()
        return self.status()

    def disconnect(self) -> dict:
        with self._lock:
            thread = self._thread
            sock = self._sock
            self._stop.set()
            self._thread = None

        # Fechar o socket desbloqueia o recv() da thread de leitura.
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass

        if thread is not None and thread.is_alive():
            thread.join(timeout=3.0)

        with self._lock:
            self._sock = None
            if self._state != "idle":
                self._state = "idle"
                self._connected_since = None

        self._publish({"type": "status", "status": self.status()})
        return self.status()

    # ------------------------------------------------------------------
    # Thread de leitura
    # ------------------------------------------------------------------

    def _run(self, generation: int, host: str, port: int,
             interval_ms: int, stop: threading.Event) -> None:
        first_attempt = True
        while not stop.is_set():
            if not first_attempt:
                self._set_state("reconnecting")
                if stop.wait(RECONNECT_DELAY_S):
                    break
                if stop.is_set():
                    break
                self._set_state("connecting")
            first_attempt = False

            try:
                self._session(generation, host, port, interval_ms, stop)
            except Exception as exc:  # noqa: BLE001 - erro exibido na interface
                if stop.is_set():
                    break
                self._set_state("error", _describe_error(exc))

            if stop.is_set() or not self._auto_reconnect:
                break

        with self._lock:
            if self._generation == generation and not self._auto_reconnect:
                self._connected_since = None

    def _session(self, generation: int, host: str, port: int,
                 interval_ms: int, stop: threading.Event) -> None:
        sock = socket.create_connection((host, port), timeout=CONNECT_TIMEOUT_S)
        with self._lock:
            self._sock = sock
            self._awaiting_header = True
        try:
            sock.settimeout(RECV_TIMEOUT_S)
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

            # O TrigaServer espera a taxa de amostragem em ms, so com digitos.
            sock.sendall(f"{interval_ms}\n".encode("ascii"))

            with self._lock:
                self._connected_since = time.time()
            self._set_state("connected", clear_error=True)

            self._read_stream(generation, sock, stop)
        finally:
            with self._lock:
                if self._sock is sock:
                    self._sock = None
            try:
                sock.close()
            except OSError:
                pass

    def _read_stream(self, generation: int, sock: socket.socket,
                     stop: threading.Event) -> None:
        buffer = bytearray()
        while not stop.is_set():
            try:
                chunk = sock.recv(65536)
            except socket.timeout as exc:
                raise ConnectionError(
                    "Sem dados do TrigaServer por "
                    f"{int(RECV_TIMEOUT_S)} s."
                ) from exc
            if not chunk:
                raise ConnectionError("O TrigaServer encerrou a conexao.")

            buffer.extend(chunk)
            while True:
                newline = buffer.find(b"\n")
                if newline < 0:
                    break
                line = bytes(buffer[:newline])
                del buffer[: newline + 1]
                self._handle_line(generation, line)

    def _handle_line(self, generation: int, raw: bytes) -> None:
        line = raw.decode("utf-8", errors="replace").strip("\r\n")
        if not line.strip():
            return

        fields = [field.strip() for field in line.split(";")]
        # O TrigaServer termina cada linha com ';', gerando um campo vazio.
        while fields and fields[-1] == "":
            fields.pop()
        if not fields:
            return

        with self._lock:
            if self._generation != generation:
                return
            awaiting_header = self._awaiting_header

        if awaiting_header:
            with self._lock:
                if self._generation == generation:
                    self._awaiting_header = False
            self._set_columns(generation, fields)
            return

        self._append_sample(generation, fields)

    def _set_columns(self, generation: int, fields: list[str]) -> None:
        names: list[str] = []
        units: list[str | None] = []
        for field in fields:
            name, unit = parse_header_field(field)
            names.append(name)
            units.append(unit)
        with self._lock:
            if self._generation != generation:
                return
            if self._columns == names and self._units == units:
                return
            self._columns = names
            self._units = units
            columns = list(self._columns)
            unit_list = list(self._units)
        self._publish({
            "type": "columns",
            "generation": generation,
            "columns": columns,
            "units": unit_list,
            "status": self.status(),
        })

    def _append_sample(self, generation: int, fields: list[str]) -> None:
        with self._lock:
            if self._generation != generation:
                return
            column_count = len(self._columns)
            # Linha CSV identica a anterior nao muda o grafico; so o
            # carimbo de tempo da ponte. Nao envia ao navegador.
            if self._last_csv_fields == fields:
                return
        if not column_count:
            return

        values: list[float | None] = []
        for index in range(column_count):
            values.append(_parse_value(fields[index]) if index < len(fields) else None)

        timestamp = time.time()

        with self._lock:
            if self._generation != generation:
                return
            if self._state != "connected":
                return
            if self._last_csv_fields == fields:
                return
            self._last_csv_fields = list(fields)
            # recv() pode entregar varias linhas no mesmo instante; o
            # milissegundo repetido fazia o navegador descartar metade.
            last = self._last_sample_at
            if last is not None and timestamp <= last:
                timestamp = last + 1e-6
            self._samples += 1
            self._last_sample_at = timestamp

        row = [round(timestamp, 6), *values]
        self._publish({"type": "sample", "generation": generation, "row": row})

    # ------------------------------------------------------------------
    # Assinantes (SSE)
    # ------------------------------------------------------------------

    def subscribe(self) -> tuple[queue.Queue, dict]:
        """Registra um assinante e devolve sua fila junto do estado atual."""
        subscriber: queue.Queue = queue.Queue(maxsize=SUBSCRIBER_QUEUE_SIZE)
        with self._lock:
            self._subscribers.add(subscriber)
            snapshot = {
                "type": "hello",
                "generation": self._generation,
                "columns": list(self._columns),
                "units": list(self._units),
                "status": self.status(),
            }
        return subscriber, snapshot

    def unsubscribe(self, subscriber: queue.Queue) -> None:
        with self._lock:
            self._subscribers.discard(subscriber)

    def _publish(self, message: dict) -> None:
        with self._lock:
            subscribers = list(self._subscribers)
        for subscriber in subscribers:
            try:
                subscriber.put_nowait(message)
            except queue.Full:
                # Assinante lento: descarta a amostra mais antiga da fila dele
                # para que a interface continue mostrando o dado mais recente.
                try:
                    subscriber.get_nowait()
                    subscriber.put_nowait(message)
                except (queue.Empty, queue.Full):
                    pass


def parse_header_field(field: str) -> tuple[str, str | None]:
    """Separa Nome[unidade] do cabecalho do TrigaServer.

    Sem colchetes, a unidade fica None para o catalogo local ser usado.
    Barra convertida adimensional chega como Nome[].
    """
    if field.endswith("]") and "[" in field:
        name, rest = field.rsplit("[", 1)
        if name:
            return name, rest[:-1]
    return field, None


def _parse_value(text: str) -> float | None:
    if not text:
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    # NaN nao e um periodo; inf/-inf sim (potencia estavel no CLogAPer).
    if math.isnan(value):
        return None
    if abs(value - INVALID_VALUE) < INVALID_EPSILON:
        return None
    return value


def _describe_error(exc: Exception) -> str:
    if isinstance(exc, socket.timeout):
        return "Tempo esgotado ao falar com o TrigaServer."
    if isinstance(exc, ConnectionRefusedError):
        return "Conexao recusada: verifique o IP, a porta e se o TrigaServer esta ativo."
    if isinstance(exc, socket.gaierror):
        return "Endereco nao encontrado: verifique o IP informado."
    if isinstance(exc, OSError) and exc.errno is not None:
        return f"{exc.strerror or exc.__class__.__name__} (errno {exc.errno})."
    message = str(exc).strip()
    return message or exc.__class__.__name__
