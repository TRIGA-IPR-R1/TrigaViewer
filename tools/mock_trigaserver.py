#!/usr/bin/env python3
"""
Simulador do TrigaServer para desenvolver e testar o TrigaViewer sem o reator.
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

# mock_trigaserver.py
#
# Reproduz o protocolo do servidor CSV do TrigaServer: recebe a taxa de
# amostragem em ms, responde com a linha de cabecalho e passa a enviar uma
# linha de valores por amostra. Os valores imitam uma partida do reator,
# apenas para exercitar a interface.
#
# Uso: python tools/mock_trigaserver.py --port 1234

from __future__ import annotations

import argparse
import math
import random
import socketserver
import time
from datetime import datetime

# Mesmas matrizes do TrigaServer (PLC, SPU, PJ-I, N1500FT).
PLC_FIELDS = [
    "STATE", "TIME_Y", "TIME_Mo", "TIME_D", "TIME_H", "TIME_Mi", "TIME_S", "TIME_MS",
    "BarraReg", "BarraCon", "BarraSeg", "CLogALog", "CLogALin", "CLogAPer",
    "CParALin", "CParALog", "CParAPer", "CLogARea", "CLin", "CPer",
    "SRadAre", "SRadEntPri", "SRadPoc", "SRadRes", "SRadSaiSec", "SRadAer", "SVasPri",
]

SPU_FIELDS = [
    "STATE", "TIME_Y", "TIME_Mo", "TIME_D", "TIME_H", "TIME_Mi", "TIME_S", "TIME_MS",
    "N_DATA_FP", "T_DATA_FP", "F1_DATA_FP", "F2_DATA_FP", "F3_DATA_FP",
    "EMR_N_THRESHOLD", "WRN_N_THRESHOLD", "EMR_T_THRESHOLD", "WRN_T_THRESHOLD",
    "EMR_N", "WRN_N", "EMR_T", "WRN_T", "R1", "R2", "R3", "RDY", "TEST", "XXXX",
]

PJI_NAMES = ("Poco", "EntPri", "SaiPri", "EntSec", "SaiSec")
PJI_FIELDS = [
    "STATE", "TIME_Y", "TIME_Mo", "TIME_D", "TIME_H", "TIME_Mi", "TIME_S", "TIME_MS",
    "PV", "PV_max", "PV_min", "PV_raw",
    "tipo_entrada", "ponto_decimal",
    "escala_alta_hw", "escala_baixa_hw", "escala_alta_trab", "escala_baixa_trab",
    "status1", "status2",
    "raiz_quadrada", "unidade_F", "escrita_habilitada", "det_min", "det_max",
    "pv_fora_faixa", "entrada_nao_linear",
    "alarme1_cond", "alarme2_cond", "entrada_aberta",
    "sp_alarme1", "rearme_alarme1", "chave_alarme1",
    "sp_alarme2", "rearme_alarme2", "chave_alarme2",
    "pv_emergencia", "n_medias", "trava_teclado",
]

N1500FT_FIELDS = [
    "STATE", "TIME_Y", "TIME_Mo", "TIME_D", "TIME_H", "TIME_Mi", "TIME_S", "TIME_MS",
    "vazao_instantanea", "vazao_total", "vazao_total_nr", "entrada_aux",
    "vazao_inst_max", "vazao_inst_min",
    "unidade_vazao_codigo", "tipo_entrada",
    "serial_hi", "serial_lo", "firmware", "product_id",
    "status1", "status2", "status3",
    "alarme1", "alarme2", "alarme3", "alarme4",
    "aux_acima_max", "aux_abaixo_min", "aux_aberta",
    "rele1", "rele2", "rele3", "rele4", "entrada_digital",
]

INT_FIELDS = {
    "STATE", "TIME_Y", "TIME_Mo", "TIME_D", "TIME_H", "TIME_Mi", "TIME_S", "TIME_MS",
    "EMR_N", "WRN_N", "EMR_T", "WRN_T", "R1", "R2", "R3", "RDY", "TEST", "XXXX",
    "PV_raw", "tipo_entrada", "ponto_decimal", "status1", "status2",
    "raiz_quadrada", "unidade_F", "escrita_habilitada", "det_min", "det_max",
    "pv_fora_faixa", "entrada_nao_linear", "alarme1_cond", "alarme2_cond",
    "entrada_aberta", "chave_alarme1", "chave_alarme2", "n_medias", "trava_teclado",
    "unidade_vazao_codigo", "serial_hi", "serial_lo", "firmware", "product_id",
    "status3", "alarme1", "alarme2", "alarme3", "alarme4",
    "aux_acima_max", "aux_abaixo_min", "aux_aberta",
    "rele1", "rele2", "rele3", "rele4", "entrada_digital",
}

PLC_CONV_UNITS = {
    "BarraReg": "", "BarraCon": "", "BarraSeg": "",
    "CLogALog": "W", "CLogALin": "W", "CLogAPer": "s",
    "CParALin": "W", "CParALog": "W", "CParAPer": "s",
    "CLogARea": "pcm", "CLin": "W", "CPer": "%",
    "SRadAre": "mRem/h", "SRadEntPri": "mRem/h", "SRadPoc": "mRem/h",
    "SRadRes": "mRem/h", "SRadSaiSec": "mRem/h", "SRadAer": "mRem/h",
    "SVasPri": "m3/h",
}

SPU_UNITS = {
    "N_DATA_FP": "W", "T_DATA_FP": "s",
    "F1_DATA_FP": "cps", "F2_DATA_FP": "cps", "F3_DATA_FP": "cps",
    "EMR_N_THRESHOLD": "W", "WRN_N_THRESHOLD": "W",
    "EMR_T_THRESHOLD": "s", "WRN_T_THRESHOLD": "s",
    "EMR_N": "logico", "WRN_N": "logico", "EMR_T": "logico", "WRN_T": "logico",
    "R1": "logico", "R2": "logico", "R3": "logico",
    "RDY": "logico", "TEST": "logico", "XXXX": "logico",
}

PJI_UNITS = {
    "PV": "UE", "PV_max": "UE", "PV_min": "UE", "PV_raw": "counts",
    "tipo_entrada": "codigo", "ponto_decimal": "digitos",
    "escala_alta_hw": "UE", "escala_baixa_hw": "UE",
    "escala_alta_trab": "UE", "escala_baixa_trab": "UE",
    "status1": "bits", "status2": "bits",
    "raiz_quadrada": "logico", "unidade_F": "logico",
    "escrita_habilitada": "logico", "det_min": "logico", "det_max": "logico",
    "pv_fora_faixa": "logico", "entrada_nao_linear": "logico",
    "alarme1_cond": "codigo", "alarme2_cond": "codigo", "entrada_aberta": "logico",
    "sp_alarme1": "UE", "rearme_alarme1": "UE", "chave_alarme1": "codigo",
    "sp_alarme2": "UE", "rearme_alarme2": "UE", "chave_alarme2": "codigo",
    "pv_emergencia": "UE", "n_medias": "leituras", "trava_teclado": "codigo",
}

N1500FT_UNITS = {
    "vazao_instantanea": "UE", "vazao_total": "UE", "vazao_total_nr": "UE",
    "entrada_aux": "UE", "vazao_inst_max": "UE", "vazao_inst_min": "UE",
    "unidade_vazao_codigo": "codigo", "tipo_entrada": "codigo",
    "serial_hi": "digitos", "serial_lo": "digitos",
    "firmware": "codigo", "product_id": "codigo",
    "status1": "bits", "status2": "bits", "status3": "bits",
    "alarme1": "logico", "alarme2": "logico", "alarme3": "logico", "alarme4": "logico",
    "aux_acima_max": "logico", "aux_abaixo_min": "logico", "aux_aberta": "logico",
    "rele1": "logico", "rele2": "logico", "rele3": "logico", "rele4": "logico",
    "entrada_digital": "logico",
}

PJI_BASE_TEMP = {
    "Poco": 42.0,
    "EntPri": 32.0,
    "SaiPri": 41.0,
    "EntSec": 24.0,
    "SaiSec": 34.0,
}

START = time.time()


def _meta_unit(field: str) -> str | None:
    if field == "STATE":
        return "estado"
    if field.startswith("TIME_"):
        return "data/hora"
    return None


def header_field(name: str, unit: str) -> str:
    return f"{name}[{unit}]"


def build_header() -> str:
    names: list[str] = []
    for source in ("CONV", "ORIG"):
        for field in PLC_FIELDS:
            meta = _meta_unit(field)
            if meta is not None:
                unit = meta
            elif source == "ORIG":
                unit = "mA" if field == "SVasPri" else "mV"
            else:
                unit = PLC_CONV_UNITS.get(field, "")
            names.append(header_field(f"PLC_{source}_{field}", unit))
    for channel in ("ChA", "ChB"):
        for field in SPU_FIELDS:
            meta = _meta_unit(field)
            unit = meta if meta is not None else SPU_UNITS.get(field, "")
            names.append(header_field(f"SPU_{channel}_{field}", unit))
    for name in PJI_NAMES:
        for field in PJI_FIELDS:
            meta = _meta_unit(field)
            unit = meta if meta is not None else PJI_UNITS.get(field, "")
            names.append(header_field(f"PJI_{name}_{field}", unit))
    for field in N1500FT_FIELDS:
        meta = _meta_unit(field)
        unit = meta if meta is not None else N1500FT_UNITS.get(field, "")
        names.append(header_field(f"N1500FT_VasPri_{field}", unit))
    return ";".join(names) + ";\n"


def reactor_state(now: float) -> dict:
    """Perfil simplificado de uma operacao: partida, patamar e desligamento."""
    elapsed = now - START
    cycle = elapsed % 600.0  # ciclo de 10 minutos

    if cycle < 120.0:                     # subida de potencia
        power = 1.0 * math.exp(cycle / 17.0)
        period = 17.0
    elif cycle < 420.0:                   # patamar com pequenas oscilacoes
        power = 100_000.0 * (1.0 + 0.02 * math.sin(cycle / 9.0))
        period = 1e5
    else:                                 # desligamento
        power = 100_000.0 * math.exp(-(cycle - 420.0) / 25.0)
        period = -25.0

    power = max(power, 0.05)
    power *= 1.0 + random.uniform(-0.004, 0.004)
    fraction = min(power / 100_000.0, 1.2)
    return {"power": power, "period": period, "fraction": fraction, "cycle": cycle}


def plc_values(state: dict, converted: bool) -> list:
    now = datetime.now()
    fraction = state["fraction"]
    power = state["power"]
    period = state["period"]

    # Barras acompanham a potencia; em unidades brutas o valor sai em mV.
    rod_reg = 20.0 + 60.0 * min(fraction, 1.0) + random.uniform(-0.3, 0.3)
    rod_con = 15.0 + 70.0 * min(fraction, 1.0) + random.uniform(-0.3, 0.3)
    rod_seg = 95.0 + random.uniform(-0.2, 0.2)

    dose_pool = 0.8 + 4200.0 * fraction
    flow = 28.0 + 4.0 * fraction + random.uniform(-0.2, 0.2)

    values = [
        0,                                   # STATE
        now.year, now.month, now.day,
        now.hour, now.minute, now.second, now.microsecond // 1000,
        rod_reg, rod_con, rod_seg,
        power, power * 1.01, period,         # CLogALog, CLogALin, CLogAPer
        power * 0.98, power * 0.99, period,  # CParALin, CParALog, CParAPer
        0.15 * math.sin(state["cycle"] / 40.0),  # CLogARea (reatividade)
        power * 1.005,                       # CLin
        100.0 * fraction,                    # CPer
        0.4 + 60.0 * fraction,               # SRadAre
        0.3 + 25.0 * fraction,               # SRadEntPri
        dose_pool,                           # SRadPoc
        0.2 + 12.0 * fraction,               # SRadRes
        0.25 + 18.0 * fraction,              # SRadSaiSec
        0.1 + 3.0 * fraction,                # SRadAer
        flow,                                # SVasPri
    ]

    if not converted:
        # Valores "originais" sao a leitura eletrica bruta do CLP.
        for index, field in enumerate(PLC_FIELDS):
            if field not in INT_FIELDS:
                values[index] = values[index] * 0.0009 + 1.0
    return values


def spu_values(state: dict, channel_gain: float) -> list:
    now = datetime.now()
    power = state["power"] * channel_gain
    period = state["period"]
    high_power = power > 90_000.0
    return [
        0,
        now.year, now.month, now.day,
        now.hour, now.minute, now.second, now.microsecond // 1000,
        power, period,
        power * 3.1e4, power * 2.7e4, power * 1.9e4,   # F1..F3
        120_000.0, 105_000.0,                          # limiares de potencia
        5.0, 10.0,                                     # limiares de periodo
        0, int(high_power), 0, 0,                      # EMR_N, WRN_N, EMR_T, WRN_T
        1, 1, 1, 1, 0, 0,                              # R1..R3, RDY, TEST, XXXX
    ]


def pji_values(name: str, state: dict) -> list:
    now = datetime.now()
    base = PJI_BASE_TEMP[name]
    temp = base + 6.0 * min(state["fraction"], 1.0) + random.uniform(-0.15, 0.15)
    return [
        0,
        now.year, now.month, now.day,
        now.hour, now.minute, now.second, now.microsecond // 1000,
        temp, temp + 0.4, temp - 0.8,                    # PV, max, min
        int((temp + 10.0) / 110.0 * 65535),             # PV_raw
        3, 1,                                           # tipo_entrada, ponto_decimal
        120.0, 0.0, 120.0, 0.0,                         # escalas
        0, 0,                                           # status1, status2
        0, 0, 0, 0, 0,                                  # raiz, F, escrita, det_min, det_max
        0, 0,                                           # pv_fora_faixa, nao_linear
        0, 0, 0,                                        # alarme1, alarme2, entrada_aberta
        90.0, 2.0, 1,                                   # alarme 1
        100.0, 2.0, 1,                                  # alarme 2
        0.0, 1, 0,                                      # pv_emergencia, n_medias, trava
    ]


def n1500ft_values(state: dict) -> list:
    now = datetime.now()
    flow = 28.0 + 4.0 * min(state["fraction"], 1.0) + random.uniform(-0.15, 0.15)
    total = 1200.0 + state["cycle"] * 0.4
    return [
        0,
        now.year, now.month, now.day,
        now.hour, now.minute, now.second, now.microsecond // 1000,
        flow, total, total * 12.0, 4.12,                # inst, tot, totNR, aux
        flow + 0.8, max(flow - 1.2, 0.0),               # max, min
        2, 0,                                           # unidade h, tipo 4-20 mA
        2024, 1234, 100, 80,                            # serial, fw 1.00, product
        0, 0, 1,                                        # status; rele1 ligado
        0, 0, 0, 0,                                     # alarmes
        0, 0, 0,                                        # aux flags
        1, 0, 0, 0, 0,                                  # reles, entrada digital
    ]


def build_row() -> str:
    now = time.time()
    state = reactor_state(now)
    fields: list[str] = []
    for values, names in (
        (plc_values(state, True), PLC_FIELDS),
        (plc_values(state, False), PLC_FIELDS),
        (spu_values(state, 1.0), SPU_FIELDS),
        (spu_values(state, 0.985), SPU_FIELDS),
        *[(pji_values(name, state), PJI_FIELDS) for name in PJI_NAMES],
        (n1500ft_values(state), N1500FT_FIELDS),
    ):
        for name, value in zip(names, values):
            fields.append(str(int(value)) if name in INT_FIELDS else f"{value:f}")
    return ";".join(fields) + ";\n"


class MockHandler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        peer = f"{self.client_address[0]}:{self.client_address[1]}"
        try:
            raw = self.request.recv(1024)
        except OSError:
            return
        if not raw:
            return

        digits = "".join(character for character in raw.decode("ascii", "ignore")
                         if character.isdigit())
        if not digits:
            print(f"[mock] {peer}: taxa de amostragem invalida, encerrando.")
            return
        interval = max(int(digits), 1) / 1000.0
        print(f"[mock] {peer} conectado, enviando a cada {interval * 1000:.0f} ms.")

        try:
            self.request.sendall(build_header().encode("ascii"))
            while True:
                self.request.sendall(build_row().encode("ascii"))
                time.sleep(interval)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass
        finally:
            print(f"[mock] {peer} desconectado.")


class MockServer(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> int:
    parser = argparse.ArgumentParser(description="Simulador do TrigaServer (formato CSV).")
    parser.add_argument("--host", default="127.0.0.1", help="Endereco de escuta.")
    parser.add_argument("--port", type=int, default=1234, help="Porta (padrao: 1234).")
    args = parser.parse_args()

    header_columns = build_header().count(";")
    server = MockServer((args.host, args.port), MockHandler)
    print(f"[mock] Simulador do TrigaServer em {args.host}:{args.port} "
          f"({header_columns} variaveis). Ctrl+C para encerrar.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[mock] Encerrando.")
    finally:
        server.shutdown()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
