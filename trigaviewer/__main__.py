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

# __main__.py
#
# Ponto de entrada: "python -m trigaviewer".
# Sobe o servidor web local e ja conecta ao TrigaServer.

from __future__ import annotations

import argparse
import sys
import threading
import time
import webbrowser
from pathlib import Path

from . import __version__
from .bridge import TrigaBridge
from .webapp import serve

# Chaves do arquivo de configuracao (ex.: /etc/trigaviewer.conf) e o nome
# do atributo correspondente em argparse. Cada chave vira --chave na CLI.
CONFIG_KEYS = {
    "host": ("host", str),
    "port": ("port", int),
    "triga-host": ("triga_host", str),
    "triga-port": ("triga_port", int),
    "interval": ("interval", int),
    "verbose": ("verbose", bool),
    "no-browser": ("no_browser", bool),
}


def load_config(path: str | Path) -> dict:
    """Le um arquivo chave=valor e devolve defaults para o argparse."""
    config_path = Path(path)
    try:
        text = config_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ValueError(f"Nao foi possivel ler {config_path}: {exc}") from exc

    defaults: dict = {}
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        if "=" not in line:
            raise ValueError(f"{config_path}:{number}: linha invalida (esperado chave=valor).")
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'\"")
        if key not in CONFIG_KEYS:
            raise ValueError(f"{config_path}:{number}: chave desconhecida '{key}'.")
        dest, kind = CONFIG_KEYS[key]
        try:
            defaults[dest] = _parse_config_value(kind, value)
        except ValueError as exc:
            raise ValueError(f"{config_path}:{number}: {exc}") from exc
    return defaults


def _parse_config_value(kind, value: str):
    if kind is bool:
        lowered = value.lower()
        if lowered in ("1", "true", "yes", "on"):
            return True
        if lowered in ("0", "false", "no", "off"):
            return False
        raise ValueError(f"valor booleano invalido '{value}'.")
    if kind is int:
        return int(value)
    return value


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    pre = argparse.ArgumentParser(add_help=False)
    pre.add_argument("--config")
    pre_args, _remaining = pre.parse_known_args(argv)

    parser = argparse.ArgumentParser(
        prog="python -m trigaviewer",
        description="Visualizador web de graficos em tempo real do TrigaServer "
                    "(Reator Nuclear Triga IPR-R1).",
    )
    parser.add_argument("--config", metavar="ARQUIVO",
                        help="Arquivo de configuracao no formato chave=valor "
                             "(ex.: /etc/trigaviewer.conf). A linha de comando "
                             "sobrescreve o arquivo.")
    parser.add_argument("--host", default="127.0.0.1",
                        help="Endereco de escuta da interface web "
                             "(padrao: 127.0.0.1; use 0.0.0.0 para expor na rede).")
    parser.add_argument("--port", type=int, default=8081,
                        help="Porta da interface web (padrao: 8081).")
    parser.add_argument("--triga-host", default="127.0.0.1",
                        help="IP do TrigaServer (padrao: 127.0.0.1).")
    parser.add_argument("--triga-port", type=int, default=1234,
                        help="Porta CSV do TrigaServer (padrao: 1234).")
    parser.add_argument("--interval", type=int, default=10,
                        help="Taxa de amostragem da ponte com o TrigaServer, "
                             "em milissegundos (padrao: 10).")
    parser.add_argument("--no-browser", action="store_true",
                        help="Nao abrir o navegador automaticamente.")
    parser.add_argument("--verbose", action="store_true",
                        help="Registrar cada requisicao HTTP no terminal.")
    parser.add_argument("--version", action="version", version=f"TrigaViewer {__version__}")
    if pre_args.config:
        parser.set_defaults(**load_config(pre_args.config))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_args(argv)
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 2

    bridge = TrigaBridge()
    try:
        server = serve(args.host, args.port, bridge, verbose=args.verbose)
    except OSError as exc:
        print(f"Nao foi possivel abrir a porta {args.port}: {exc}", file=sys.stderr)
        return 1

    shown_host = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
    url = f"http://{shown_host}:{args.port}/"
    print(f"TrigaViewer {__version__}")
    print(f"Interface web: {url}")

    try:
        bridge.connect(args.triga_host, args.triga_port, args.interval)
        print(f"Conectando ao TrigaServer em {args.triga_host}:{args.triga_port} "
              f"a cada {args.interval} ms.")
    except ValueError as exc:
        print(f"Conexao automatica ignorada: {exc}", file=sys.stderr)

    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()

    print("Pressione Ctrl+C para encerrar.")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        print("\nEncerrando...")
    finally:
        bridge.disconnect()
        server.shutdown()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
