# TrigaViewer

Visualizador web de gráficos em tempo real para o
[TrigaServer](https://github.com/TRIGA-IPR-R1/TrigaServer), o servidor que
publica na rede as variáveis do Reator Nuclear TRIGA IPR-R1.

## O que ele faz

- Ao iniciar, a ponte já se conecta ao TrigaServer em **localhost:1234** (ou
  no endereço e na taxa de amostragem passados na linha de comando). O
  navegador não controla essa conexão: não há campos de IP/porta nem como
  encerrá-la pela interface.
- A primeira linha do fluxo CSV traz a lista de todas as variáveis no formato
  `Nome[unidade]`; a unidade vem do arquivo de calibração do TrigaServer e
  alimenta os seletores da interface.
- A leitura começa ativa. **Parar Leitura** deixa de gravar amostras neste
  navegador; **Iniciar Leitura** volta a gravar. **Taxa de Amostragem** e
  **Memória de Amostras** podem ser alteradas com a leitura ligada: a taxa
  só muda o que este navegador grava (descarta amostras da ponte), sem
  reconectar o TrigaServer. Se a ponte estiver sem o TrigaServer, a tela
  simplesmente não recebe dados até a reconexão.
- **Limpar Memória** descarta as amostras deste navegador a qualquer momento,
  mesmo com a leitura ativa.
- Botão **Adicionar gráfico**, que cria um gráfico em branco com três
  seletores em cascata (dispositivo, canal e campo) para escolher a variável.
- Botão **Adicionar variável**, que só oferece variáveis **da mesma unidade de
  medida** da primeira curva do gráfico, no mesmo seletor em cascata.
- Cada gráfico mostra a unidade de medida no eixo Y em função do tempo no
  eixo X. Podem ser criados quantos gráficos forem necessários.
- Reconexão automática se o TrigaServer cair, exportação em CSV do que está na
  memória deste navegador, escala logarítmica por gráfico e zoom arrastando
  com o mouse.

## Requisitos

Apenas **Python 3.10 ou superior**. Não há dependências para instalar: a ponte
usa só a biblioteca padrão e a biblioteca de gráficos
([uPlot](https://github.com/leeoniya/uPlot), MIT) já acompanha o repositório em
`web/vendor/`.

## Como usar

```bash
git clone https://github.com/TRIGA-IPR-R1/TrigaViewer.git
cd TrigaViewer
python -m trigaviewer
```

O navegador abre em <http://127.0.0.1:8081> já tentando o TrigaServer em
`127.0.0.1:1234`, a cada 10 ms.

Para apontar a outro servidor ou outra taxa:

```bash
python -m trigaviewer --triga-host 192.168.1.5 --triga-port 1234 --interval 50
```

Opções principais (`python -m trigaviewer --help`):

| Opção | Para que serve |
| --- | --- |
| `--host` / `--port` | Endereço e porta da interface web (padrão `127.0.0.1:8081`). Use `--host 0.0.0.0` para abrir o visualizador a outras máquinas da rede. |
| `--triga-host` / `--triga-port` / `--interval` | Endereço do TrigaServer e taxa de amostragem da ponte, em milissegundos (padrões `127.0.0.1:1234` e `10`). |
| `--no-browser` | Não abrir o navegador sozinho. |

## Sem o reator por perto

O repositório traz um simulador que fala o mesmo protocolo do TrigaServer,
útil para desenvolver e demonstrar a interface:

```bash
python tools/mock_trigaserver.py --port 1234   # em um terminal
python -m trigaviewer                          # em outro
```

Ele reproduz um ciclo de operação de dez minutos: subida de potência, patamar
em 100 kW e desligamento.

## Como funciona

O navegador não consegue abrir sockets TCP puros, então o TrigaViewer tem duas
partes:

```
TrigaServer  --TCP/CSV-->  ponte Python  --HTTP + SSE-->  navegador
 (porta 1234)               (porta 8081)                  (gráficos)
```

A ponte (`trigaviewer/bridge.py`) implementa o protocolo do TrigaServer
descrito em `src/TrigaServer.cpp`: conecta, envia a taxa de amostragem em
milissegundos como texto, lê a linha de cabeçalho e depois cada linha de
valores, repassando tudo ao navegador por Server-Sent Events na mesma taxa.
O navegador pode gravar numa taxa maior (intervalo maior) descartando amostras.
Se a ponte não alcança o TrigaServer, ela não envia amostras e tenta de novo
a cada 1 segundo.

| Arquivo | Responsabilidade |
| --- | --- |
| `trigaviewer/bridge.py` | Conexão com o TrigaServer, leitura do CSV e distribuição das amostras. |
| `trigaviewer/webapp.py` | Servidor HTTP e fluxo de eventos. |
| `web/js/catalog.js` | Nome, agrupamento e unidade de fallback (a unidade que vale vem do TrigaServer). |
| `web/js/store.js` | Armazenamento em memória **deste navegador** (um `Float64Array` por variável). |
| `web/js/chart.js` | O cartão de gráfico e a regra de unidade única por gráfico. |
| `web/js/app.js` | Leitura local, barra de ferramentas e ciclo de redesenho. |

### Unidades de medida

A regra "só somar curvas da mesma unidade" usa a unidade que o TrigaServer
publica no cabeçalho CSV (`Nome[unidade]`), lida do arquivo de calibração
(`/etc/libOpcTrigaPLC.conf`, chave `unit =` em cada seção). O Viewer só herda:
trocar `CLogARea` de pcm para outra unidade no servidor muda o eixo Y e o
agrupamento dos seletores sem alterar o Viewer.

Se o servidor for antigo e não enviar `[unidade]`, a tabela em
`web/js/catalog.js` entra como fallback (potência em W, período em s,
reatividade em pcm, barras adimensionais, radiação em mRem/h, vazão em m³/h,
valores originais do CLP em mV, vazão primária original em mA). Variáveis que a tabela não conhece continuam
disponíveis, agrupadas em "Outras variáveis" e sem unidade definida.

### Memória

As amostras ficam só na memória de cada aba do navegador, para não sobrecarregar
o computador que hospeda o TrigaServer e o TrigaViewer. Cada variável ocupa um
vetor cujo tamanho é escolhido em **Memória de Amostras** (10 mil a 1 milhão,
ou ilimitado). Com as 108 variáveis do TrigaServer, 50 mil amostras ocupam
cerca de 42 MB — a 1 Hz, quase 14 horas de aquisição. Ao encher, as amostras
mais antigas são descartadas. Em **Ilimitado**, o buffer cresce conforme os
dados chegam. O valor `-123456`, usado pelo TrigaServer para variável não lida,
vira uma lacuna na curva em vez de um degrau até zero.

A **Duração** no cabeçalho é o instante da última amostra menos o da primeira
ainda disponível neste navegador, ambos no relógio da ponte (não do
navegador). Assim a duração começa em 0 mesmo com o relógio do cliente
dessincronizado. A **Taxa** conta as amostras gravadas no último segundo
desse mesmo relógio, com uma casa decimal (por exemplo `100,0 Hz`).

## Testes

```bash
python tools/mock_trigaserver.py --port 1234   # deixe rodando em outro terminal
python tools/smoke_test.py                     # ponte, API e fluxo SSE
python tools/resilience_test.py                # queda e volta do TrigaServer
```

## Licença

Este programa NÃO POSSUI QUALQUER GARANTIA; está sob a GNU Affero General Public
License versão 3 (AGPL3), o que significa que você só pode usá-lo em projetos de
software livre. Para mais detalhes, leia o arquivo LICENSE.
Copyright (C) 2026 Thalles Campagnani

A biblioteca de gráficos uPlot, em `web/vendor/`, é distribuída sob a licença
MIT, compatível com a AGPL3.
