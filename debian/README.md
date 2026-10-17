# Empacotamento Debian do TrigaViewer

Este diretorio contem os arquivos para gerar o pacote `.deb`. O servico
systemd e a configuracao de referencia ficam em `resources/`; o pacote
instala-os em `/lib/systemd/system/trigaviewer.service` e
`/etc/trigaviewer.conf`.

## O que o pacote instala

| Caminho | Origem |
| --- | --- |
| `/usr/share/trigaviewer/` | codigo Python e interface web |
| `/usr/bin/trigaviewer` | atalho que executa `python3 -m trigaviewer` |
| `/etc/trigaviewer.conf` | endereco do TrigaServer e da interface web |
| `/lib/systemd/system/trigaviewer.service` | inicia no boot, depois de `trigaserver.service` |

O unit systemd chama:

```
/usr/bin/trigaviewer --config /etc/trigaviewer.conf --no-browser
```

Cada chave de `/etc/trigaviewer.conf` vira um argumento `--chave valor`.
Exemplo:

```
triga-host=127.0.0.1
triga-port=1234
host=0.0.0.0
port=8081
interval=10
```

Depois de alterar o arquivo:

```bash
sudo systemctl restart trigaviewer
```

## Dependencias de compilacao

```bash
sudo apt install build-essential debhelper devscripts dpkg-dev
```

Python 3.10 ou superior e necessario no sistema que **instala** o pacote
(nao e preciso compilador C).

## Como gerar o .deb

Na raiz do repositorio (o diretorio que contem `debian/` e `trigaviewer/`):

```bash
dpkg-buildpackage -us -uc -b
```

`-us -uc` dispensa assinatura GPG. `-b` gera so o pacote binario.

O arquivo fica um nivel acima da raiz do projeto:

```
../trigaviewer_1.0.0_all.deb
```

Arquivos auxiliares da compilacao (`../trigaviewer_1.0.0.dsc`,
`../trigaviewer_1.0.0.tar.xz`, `../trigaviewer_1.0.0_amd64.buildinfo`)
tambem aparecem ai no empacotamento completo (`dpkg-buildpackage -us -uc`
sem `-b`).

Para limpar o diretorio de compilacao:

```bash
debian/rules clean
```

## Como instalar

```bash
sudo dpkg -i ../trigaviewer_1.0.0_all.deb
sudo apt-get install -f   # so se dpkg reclamar de dependencia
```

O `postinst` do debhelper habilita e (re)inicia o servico. Conferir:

```bash
systemctl status trigaviewer
ss -lntp | grep 8081
```

A interface fica em `http://<ip-da-maquina>:8081` com o `host=0.0.0.0`
padrao do conf.

## Como desinstalar

```bash
sudo apt remove trigaviewer
```

O arquivo `/etc/trigaviewer.conf` e tratado como conffile: na remocao
simples ele permanece; `apt purge trigaviewer` pergunta se deve apaga-lo.

## Instalacao manual do servico (sem o .deb)

Se o codigo ja estiver no disco e so quiser o systemd:

```bash
sudo cp resources/trigaviewer.conf /etc/trigaviewer.conf
sudo cp resources/trigaviewer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now trigaviewer
```

Nesse caso o `ExecStart` espera o comando `/usr/bin/trigaviewer`. Ajuste
o unit, ou crie o atalho apontando para o checkout:

```bash
sudo tee /usr/bin/trigaviewer >/dev/null <<'EOF'
#!/bin/sh
export PYTHONPATH=/caminho/para/TrigaViewer
exec /usr/bin/python3 -m trigaviewer "$@"
EOF
sudo chmod +x /usr/bin/trigaviewer
```

## Versao

A versao do pacote esta em `debian/changelog` (primeira linha) e deve
acompanhar `trigaviewer/__init__.py` (`__version__`). Para um novo
release:

```bash
dch -i
```

ou edite `debian/changelog` a mao no formato:

```
trigaviewer (1.0.1) unstable; urgency=medium

  * Descricao da mudanca.

 -- Thalles Campagnani <thallescampagnani@gmail.com>  Data
```
