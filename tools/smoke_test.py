#!/usr/bin/env python3
"""Teste rapido da ponte e da API: conecta, coleta amostras e confere o SSE."""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from trigaviewer.bridge import TrigaBridge  # noqa: E402
from trigaviewer.webapp import serve  # noqa: E402

TRIGA_HOST = "127.0.0.1"
TRIGA_PORT = 1234
WEB_PORT = 8099


def post(path: str, payload: dict):
    request = urllib.request.Request(
        f"http://127.0.0.1:{WEB_PORT}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    return urllib.request.urlopen(request, timeout=5)


def main() -> int:
    bridge = TrigaBridge()
    server = serve("127.0.0.1", WEB_PORT, bridge)
    failures: list[str] = []

    try:
        # A pagina inicial deve ser servida.
        with urllib.request.urlopen(f"http://127.0.0.1:{WEB_PORT}/", timeout=5) as response:
            index_ok = response.status == 200 and b"<html" in response.read().lower()
        print(f"index.html servido: {index_ok}")
        if not index_ok:
            failures.append("index.html nao foi servido")

        # O navegador nao pode encerrar a conexao ponte-TrigaServer.
        for path in ("/api/connect", "/api/disconnect"):
            try:
                with post(path, {}):
                    failures.append(f"{path} ainda aceita POST")
            except urllib.error.HTTPError as error:
                print(f"POST {path} -> {error.code}")
                if error.code != 404:
                    failures.append(f"{path} deveria responder 404, veio {error.code}")

        # Abre o SSE antes de conectar para receber hello + columns + samples.
        stream = urllib.request.urlopen(f"http://127.0.0.1:{WEB_PORT}/api/stream", timeout=20)

        status = bridge.connect(TRIGA_HOST, TRIGA_PORT, 200)
        print(f"bridge.connect -> {status['state']}")

        events: list[dict] = []
        deadline = time.time() + 12
        while time.time() < deadline:
            line = stream.readline()
            if not line:
                break
            if line.startswith(b"data: "):
                events.append(json.loads(line[6:]))
            if sum(len(e.get("rows", [])) for e in events if e["type"] == "samples") >= 5:
                break
        stream.close()

        kinds = [event["type"] for event in events]
        print(f"eventos SSE recebidos: {kinds[:8]}")

        hello = next((e for e in events if e["type"] == "hello"), None)
        if hello and hello.get("history"):
            failures.append("a ponte nao deve enviar historico ao cliente")

        columns_event = next((e for e in events if e["type"] == "columns"), None)
        if columns_event is None and hello and hello.get("columns"):
            columns_event = hello
        if columns_event is None:
            failures.append("cabecalho CSV nao chegou")
        else:
            columns = columns_event["columns"]
            print(f"variaveis no cabecalho: {len(columns)}")
            print(f"  primeira: {columns[0]}   ultima: {columns[-1]}")
            if len(columns) != 338:
                failures.append(f"esperava 338 variaveis, veio {len(columns)}")
            if columns[0] != "PLC_CONV_STATE":
                failures.append(f"primeira coluna inesperada: {columns[0]}")

        rows = [row for event in events if event["type"] == "samples"
                for row in event["rows"]]
        print(f"amostras recebidas: {len(rows)}")
        if len(rows) < 5:
            failures.append("menos de 5 amostras recebidas")
        elif columns_event is not None:
            row = rows[-1]
            if len(row) != len(columns_event["columns"]) + 1:
                failures.append("tamanho da amostra difere do cabecalho")
            power_index = columns_event["columns"].index("SPU_ChA_N_DATA_FP") + 1
            print(f"  SPU_ChA_N_DATA_FP = {row[power_index]}")
            interval = rows[-1][0] - rows[0][0]
            print(f"  intervalo medio: {interval / (len(rows) - 1) * 1000:.0f} ms")
    finally:
        bridge.disconnect()
        server.shutdown()
        server.server_close()

    if failures:
        print("\nFALHAS:")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("\nTudo certo.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
