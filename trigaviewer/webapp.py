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

# webapp.py
#
# Servidor HTTP que entrega a interface web e expoe a ponte com o TrigaServer:
#   GET  /                 pagina do visualizador
#   GET  /api/status       estado da conexao com o TrigaServer
#   GET  /api/stream       fluxo de amostras (Server-Sent Events)
#
# A conexao ponte-TrigaServer e definida na linha de comando e nao pode ser
# encerrada pelo navegador.

from __future__ import annotations

import json
import math
import mimetypes
import posixpath
import queue
import socket
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from .bridge import TrigaBridge

# JSON nao tem Infinity. 1e999 vira Infinity no JSON.parse do navegador e
# nao colide com nenhum valor real do reator (ja teria virado inf no float).
_JSON_INF = "1e999"
_JSON_NINF = "-1e999"
_INF_MARK = "__+Infinity__"
_NINF_MARK = "__-Infinity__"


def _mark_inf(value):
    if isinstance(value, float):
        if math.isnan(value):
            return None
        if math.isinf(value):
            return _INF_MARK if value > 0 else _NINF_MARK
        return value
    if isinstance(value, dict):
        return {key: _mark_inf(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_mark_inf(item) for item in value]
    return value


def encode_sse_payload(message: dict) -> str:
    """JSON do SSE: inf/-inf saem como 1e999/-1e999, NaN vira null."""
    try:
        return json.dumps(message, separators=(",", ":"), allow_nan=False)
    except ValueError:
        payload = json.dumps(_mark_inf(message), separators=(",", ":"), allow_nan=False)
        return payload.replace(f'"{_INF_MARK}"', _JSON_INF).replace(
            f'"{_NINF_MARK}"', _JSON_NINF)

WEB_ROOT = Path(__file__).resolve().parent.parent / "web"

# Intervalo entre comentarios keep-alive do SSE, para atravessar proxies
# e detectar navegadores que fecharam a aba.
SSE_KEEPALIVE_S = 15.0

# Numero maximo de amostras agrupadas em um unico evento SSE.
SSE_BATCH_SIZE = 200

# No Windows o tipo MIME vem do registro e o .js costuma virar text/plain,
# o que faz o navegador recusar os scripts.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("text/html", ".html")
mimetypes.add_type("image/svg+xml", ".svg")


class TrigaViewerHandler(BaseHTTPRequestHandler):
    server_version = "TrigaViewer"
    protocol_version = "HTTP/1.1"

    # Silencia o log padrao, uma linha por requisicao, que polui o terminal
    # com o keep-alive do SSE.
    def log_message(self, format: str, *args) -> None:  # noqa: A002
        if self.server.verbose:  # type: ignore[attr-defined]
            super().log_message(format, *args)

    @property
    def bridge(self) -> TrigaBridge:
        return self.server.bridge  # type: ignore[attr-defined]

    # ------------------------------------------------------------------
    # Rotas
    # ------------------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802 - assinatura da biblioteca padrao
        path = urlparse(self.path).path
        if path == "/api/status":
            self._send_json(HTTPStatus.OK, self.bridge.status())
        elif path == "/api/stream":
            self._send_event_stream()
        else:
            self._send_static(path)

    def do_POST(self) -> None:  # noqa: N802 - assinatura da biblioteca padrao
        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Rota inexistente."})

    def do_HEAD(self) -> None:  # noqa: N802 - assinatura da biblioteca padrao
        self.do_GET()

    # ------------------------------------------------------------------
    # API
    # ------------------------------------------------------------------

    def _send_event_stream(self) -> None:
        subscriber, snapshot = self.bridge.subscribe()
        # HTTP/1.1 so permite corpo sem tamanho com Connection: close.
        # keep-alive sem Content-Length/chunked e invalido e faz o Apache
        # (e o EventSource atras dele) encerrar e reabrir o SSE.
        self.close_connection = True
        try:
            try:
                self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            except OSError:
                pass
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-store")
            self.send_header("Connection", "close")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()

            self._write_event(snapshot)
            while True:
                try:
                    message = subscriber.get(timeout=SSE_KEEPALIVE_S)
                except queue.Empty:
                    self.wfile.write(b": keep-alive\n\n")
                    self.wfile.flush()
                    continue

                # Agrupa as amostras ja enfileiradas em um unico evento, o que
                # reduz muito o custo por amostra em taxas altas.
                if message.get("type") == "sample":
                    rows = [message["row"]]
                    generation = message["generation"]
                    pending = None
                    while len(rows) < SSE_BATCH_SIZE:
                        try:
                            candidate = subscriber.get_nowait()
                        except queue.Empty:
                            break
                        if (candidate.get("type") == "sample"
                                and candidate["generation"] == generation):
                            rows.append(candidate["row"])
                        else:
                            pending = candidate
                            break
                    self._write_event({
                        "type": "samples",
                        "generation": generation,
                        "rows": rows,
                    })
                    if pending is not None:
                        self._write_event(pending)
                else:
                    self._write_event(message)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass  # navegador fechou a aba
        finally:
            self.bridge.unsubscribe(subscriber)
            self.close_connection = True

    def _write_event(self, message: dict) -> None:
        payload = encode_sse_payload(message)
        self.wfile.write(b"data: " + payload.encode("utf-8") + b"\n\n")
        self.wfile.flush()

    # ------------------------------------------------------------------
    # Arquivos estaticos
    # ------------------------------------------------------------------

    def _send_static(self, path: str) -> None:
        relative = unquote(path)
        if relative in ("", "/"):
            relative = "/index.html"

        # Normaliza para impedir acesso fora de web/ (ex.: /../bridge.py).
        normalized = posixpath.normpath(relative).lstrip("/")
        target = (WEB_ROOT / normalized).resolve()
        try:
            target.relative_to(WEB_ROOT.resolve())
        except ValueError:
            self._send_json(HTTPStatus.FORBIDDEN, {"error": "Caminho invalido."})
            return

        if not target.is_file():
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Arquivo nao encontrado."})
            return

        content_type, _ = mimetypes.guess_type(str(target))
        if content_type is None:
            content_type = "application/octet-stream"
        if content_type.startswith("text/") or content_type in (
            "application/javascript", "application/json",
        ):
            content_type += "; charset=utf-8"

        body = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    # ------------------------------------------------------------------
    # Utilitarios
    # ------------------------------------------------------------------

    def _send_json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)


class TrigaViewerServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], bridge: TrigaBridge, verbose: bool = False):
        self.bridge = bridge
        self.verbose = verbose
        super().__init__(address, TrigaViewerHandler)

    def server_bind(self) -> None:
        # Evita que uma conexao SSE encerrada deixe a porta presa em TIME_WAIT.
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        super().server_bind()


def serve(host: str, port: int, bridge: TrigaBridge,
          verbose: bool = False) -> TrigaViewerServer:
    """Cria o servidor e o executa em uma thread separada."""
    server = TrigaViewerServer((host, port), bridge, verbose=verbose)
    thread = threading.Thread(target=server.serve_forever, name="triga-http", daemon=True)
    thread.start()
    return server
