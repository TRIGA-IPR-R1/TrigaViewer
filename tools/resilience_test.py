#!/usr/bin/env python3
"""
Confere o comportamento da ponte quando o TrigaServer nao responde ou cai.
Copyright (C) 2026 Thalles Campagnani - GNU AGPL v3 ou posterior.

Sobe e derruba o simulador em uma porta propria (1299), entao nao interfere
em uma aquisicao real em andamento.

Uso: python tools/resilience_test.py
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from trigaviewer.bridge import TrigaBridge, _parse_value  # noqa: E402
from trigaviewer.webapp import encode_sse_payload  # noqa: E402

MOCK_PORT = 1299
failures: list[str] = []


def check(name, condition, detail=""):
    print(f"{'PASS' if condition else 'FALHA'} {name}{' :: ' + str(detail) if detail else ''}")
    if not condition:
        failures.append(name)


def wait_state(bridge, states, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        state = bridge.status()["state"]
        if state in states:
            return state
        time.sleep(0.2)
    return bridge.status()["state"]


def start_mock():
    return subprocess.Popen(
        [sys.executable, str(Path(__file__).parent / "mock_trigaserver.py"),
         "--port", str(MOCK_PORT)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main() -> int:
    import math

    # Periodo inf/-inf e dado; NaN e o sentinela -123456 continuam lacuna.
    check("parse inf", _parse_value("inf") == math.inf)
    check("parse -inf", _parse_value("-inf") == -math.inf)
    check("parse nan", _parse_value("nan") is None)
    check("parse -123456", _parse_value("-123456.0") is None)
    payload = encode_sse_payload({"row": [1.0, math.inf, -math.inf, None]})
    check("SSE serializa inf", payload == '{"row":[1.0,1e999,-1e999,null]}', payload)

    bridge = TrigaBridge()

    # 1. Endereco sem ninguem escutando.
    bridge.connect("127.0.0.1", 9, 500)
    state = wait_state(bridge, {"error", "reconnecting"})
    status = bridge.status()
    check("porta fechada vira erro", state in ("error", "reconnecting"), state)
    check("o motivo da falha fica visivel",
          bool(status["lastError"]), status["lastError"])
    check("tenta reconectar sozinho",
          wait_state(bridge, {"reconnecting"}, timeout=10) == "reconnecting")
    bridge.disconnect()
    check("desconectar volta para idle", bridge.status()["state"] == "idle")

    # 2. Validacao dos parametros de conexao.
    for label, args in (("ip vazio", ("", 1234, 1000)),
                        ("porta invalida", ("127.0.0.1", 0, 1000)),
                        ("taxa invalida", ("127.0.0.1", 1234, 0))):
        try:
            bridge.connect(*args)
            check(f"recusa {label}", False, "nenhum erro levantado")
        except ValueError as error:
            check(f"recusa {label}", True, str(error))

    # 3. Servidor que cai no meio da aquisicao.
    mock = start_mock()
    try:
        time.sleep(1.5)
        bridge.connect("127.0.0.1", MOCK_PORT, 200)
        check("conecta ao simulador", wait_state(bridge, {"connected"}) == "connected")
        time.sleep(1.5)
        check("amostras chegando", bridge.status()["samples"] > 0,
              bridge.status()["samples"])

        mock.terminate()
        mock.wait(timeout=10)
        state = wait_state(bridge, {"error", "reconnecting"}, timeout=15)
        check("queda do servidor e detectada", state in ("error", "reconnecting"), state)
    finally:
        if mock.poll() is None:
            mock.kill()

    # 4. Servidor volta: a ponte deve reconectar sozinha.
    mock = start_mock()
    try:
        state = wait_state(bridge, {"connected"}, timeout=25)
        check("reconecta quando o servidor volta", state == "connected", state)
        time.sleep(1.5)
        check("volta a receber amostras", bridge.status()["samples"] > 0,
              bridge.status()["samples"])
    finally:
        bridge.disconnect()
        if mock.poll() is None:
            mock.terminate()

    print("\nRESUMO:", "tudo certo" if not failures else f"{len(failures)} falha(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
