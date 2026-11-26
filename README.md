# Midea Casa

Ponte HomeKit local para o Springer Midea 42MBCA18M5, protocolo V2/TCP 6444. O HomePod permanece como central Apple. A ponte roda no Mac com Homebridge 2.5.0, plugin Midea 1.6.0 e Node 24.22.3 instalados localmente.

## Instalação ativa

- Runtime: `~/Library/Application Support/Midea HomeKit`
- Configuração: `~/Library/Application Support/Midea HomeKit/storage/config.json`
- Serviço: `~/Library/LaunchAgents/com.thiagogallina.midea-homekit.plist`
- Logs: `~/Library/Application Support/Midea HomeKit/logs/`

Esta pasta conserva fontes das extensões e o lockfile. O runtime acima é a instalação em uso; a sincronização das duas pastas não é automática. Não execute `start.sh` junto com o serviço: eles usam a mesma identidade e porta HomeKit 51847. O pareamento existente foi preservado.


## Painel principal

O termostato continua como serviço principal, com temperatura atual, alvo de 17–30 °C e seletor Desligado/Auto/Resfriar. Com `temperatureCard: true`, o acessório principal publica somente o termostato para recuperar o card nativo de temperatura. Os seis botões e o seletor de velocidade ficam no acessório auxiliar `Controles do ar`, junto da leitura externa. Os callbacks continuam controlando o mesmo aparelho.

Foram mantidos estes seis botões, na ordem existente:

1. Somente ventilação
2. Ventilador automático
3. Oscilação vertical
4. Silencioso — ventilação baixa e comandos sem bipe
5. Desumidificador
6. Super — refrigeração a 17 °C e ventilação alta

A temperatura externa permanece no acessório auxiliar. Foram removidos os botões dedicados Auto/Cool, Noite, Conforto, ligar/desligar em 1/2/4/8 horas e cancelar temporizadores. Auto/Cool continuam disponíveis no seletor do termostato. O agendador e os prazos persistidos são retirados na instalação; não existem mais agendamentos locais nesta versão.

O modo Auto recusa ventilação manual. O Silencioso guarda o ajuste anterior para restauração; não há confirmação de controle dos LEDs. Posição fixa da aleta, limites de energia, ionizador, autolimpeza e Siga-me não são publicados como funções confirmadas.

O card principal e o painel de comandos são dois acessórios no Casa. Os comandos auxiliares podem ser agrupados entre si. Ao desativar `temperatureCard`, os botões e a velocidade retornam ao acessório principal, mas essa combinação apresentou card de resumo sem temperatura no Casa. O pareamento da ponte permanece o mesmo.

## Verificação

Consulte `TEST-REPORT.md` e os registros em `test-results/`. Houve testes reais de comandos no aparelho, com autorização do usuário, e leitura dos pacotes recebidos. O estado inicial salvo foi restaurado: ligado, Cool, 21 °C, ventilação média, sem oscilação, Eco/Turbo/Sleep desativados e visor ligado. O usuário confirmou alterações físicas e o bipe habilitado; não confirmou especificamente o apagamento do visor.

Os testes históricos de temporizadores são de uma versão anterior; essa função foi removida. Respostas do módulo podem demorar; falhas exploratórias por concorrência ou montagem do teste não contam como validação de funções.

## Operação e manutenção

O serviço inicia ao entrar na conta e reinicia após falhas. O Mac precisa estar ligado, acordado e na rede; a política de suspensão não foi alterada. Uma reserva DHCP do IP do aparelho evita mudanças de endereço; o roteador não foi modificado.

Reiniciar:

```sh
launchctl kickstart -k "gui/$(id -u)/com.thiagogallina.midea-homekit"
```

Parar:

```sh
launchctl bootout "gui/$(id -u)/com.thiagogallina.midea-homekit"
```

Reativar:

```sh
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.thiagogallina.midea-homekit.plist"
```

As extensões locais estão em `LocalRemoteControls.js`, `LocalScheduler.js` e `LocalProtocolFixes.js`. Após reinstalar o plugin, reaplique `fix-service-names.py` e `install-remote-controls.py`, passando a pasta do runtime como argumento, e reinicie. A correção inicializa nomes HomeKit e corrige dois detalhes do pacote de visor, mas não garante que o aparelho aceite esse comando.

Referências: [plugin Midea](https://github.com/kovapatrik/homebridge-midea-platform) e [manual Springer Midea desse tipo de controle](https://www.leverosintegra.com.br/download/manuais/SpringerMidea/Manual-Do-Usuario-Springer-Midea-Inverter-42MBQA18M5-38MBQA18M5.pdf).

## Recriar o ambiente

```sh
npm ci
python3 fix-service-names.py
python3 install-remote-controls.py
mkdir -p storage
cp config.example.json storage/config.json
npm test
```

Edite `storage/config.json` com o IP e identificador reais do aparelho e uma identidade HomeKit própria antes de iniciar com `npm start`. O exemplo contém apenas valores fictícios. Não execute outra ponte com a mesma identidade da instalação ativa. O pareamento existente permanece no runtime do Mac e não está incluído no GitHub.

Os scripts `probe-*`, `hardware-homekit.mjs`, `optional-features.mjs`, `display-probe.mjs` e `confirm-transport.mjs` são ferramentas de diagnóstico do ambiente original; alguns enviam comandos reais ao aparelho. Não fazem parte de `npm test`. Ajuste endereços e caminhos antes de usá-los.

Configurações locais, dados de pareamento, logs, resultados brutos e dependências ficam excluídos do versionamento. As dependências são obtidas com `npm ci`; suas licenças permanecem as dos respectivos projetos.

Os diagnósticos leem IP e ID de `storage/config.json`. É possível sobrescrever com `MIDEA_IP` e `MIDEA_DEVICE_ID`; `MIDEA_PYTHON` seleciona o Python com `msmart-ng` instalado.
