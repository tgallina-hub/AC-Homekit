# Midea Casa

Ponte HomeKit local para o Springer Midea 42MBCA18M5, protocolo V2/TCP 6444. O HomePod permanece como central Apple. A ponte roda no Mac com Homebridge 2.5.0, plugin Midea 1.6.0 e Node 24.22.3 instalados localmente.

## Instalação ativa

- Runtime: `~/Library/Application Support/Midea HomeKit`
- Configuração: `~/Library/Application Support/Midea HomeKit/storage/config.json`
- Serviço: `~/Library/LaunchAgents/com.thiagogallina.midea-homekit.plist`
- Logs: `~/Library/Application Support/Midea HomeKit/logs/`

Esta pasta conserva fontes das extensões e o lockfile. O runtime acima é a instalação em uso; a sincronização das duas pastas não é automática. Não execute `start.sh` junto com o serviço: eles usam a mesma identidade e porta HomeKit 51847. O pareamento existente foi preservado.


## Painel principal solicitado

Verificação visual em 26/11/2026: o Casa agrupado reúne termostato, oito botões e velocidade, mas o card externo exibe o resumo dos estados e um ícone de interruptor. Ao separar os blocos, o card mostra a temperatura e fica claro quando ativo, porém os botões saem do painel. Vincular também os oito Switches ao termostato não mudou essa apresentação; o teste foi desfeito. O agrupamento foi mantido conforme a preferência do usuário. A temperatura no card agrupado continua pendente.

O serviço principal usa `Thermostat`, marcado como serviço primário e categoria termostato. O seletor de velocidade `Fanv2` está no mesmo acessório e vinculado ao termostato, além dos oito botões. A tentativa de usar `HeaterCooler` foi revertida para recuperar a apresentação da temperatura no card. Somente estes oito botões ficam no mesmo painel, com prefixos numéricos para fixar a ordenação por nome do Casa:

1. Modo Auto
2. Resfriar Cool
3. Somente ventilação
4. Ventilador automático
5. Oscilação vertical
6. Silencioso
7. Desumidificador
8. Super

Conforto, Noite, temporizadores e sensor externo ficam no acessório `Funções extras do ar`. Os botões do painel principal são serializados nessa ordem, além de receberem `Name` e `ConfiguredName` numerados. O seletor de velocidade permanece adicionalmente como controle contínuo. Os testes verificam a lista exata e que callbacks dos controles movidos continuam operantes.

## Controles

- Controle principal de ar-condicionado sem aquecimento: 17–30 °C, Auto, Cool e desligado.
- Botões dedicados Modo Auto e Resfriar Cool; ventilação manual é recusada no modo Auto.
- Ventilação baixa/média/alta/automática, somente ventilação e desumidificação.
- Super: refrigeração a 17 °C, ventilação alta e flag Turbo.
- Conforto 23 graus: ajuste de temperatura, mantendo o modo e a velocidade; não disponível em somente ventilação.
- Oscilação vertical.
- Temperatura externa.
- Silencioso: ventilação baixa e comandos sem bipe. O estado de silêncio persiste no contexto HomeKit. Desativar restaura os ajustes anteriores. Apagar LEDs não foi confirmado e não faz parte desse botão.
- Noite 8 horas: refrigeração, temperatura mínima de 24 °C, ventilação automática e desligamento após 8 horas. É um programa local de ajustes documentados; a flag Eco interna não foi confirmada, portanto não se afirma que reproduza o algoritmo de economia da Midea.
- Ligar/desligar em 1, 2, 4 ou 8 horas e cancelar temporizadores. Os prazos absolutos são gravados e retomados após reinício; falhas de comunicação são registradas e tentadas novamente.

Os comandos normais têm retorno sonoro habilitado. No Silencioso, ele é desabilitado. A posição fixa da aleta, limites de energia 75%/50%, ionizador, autolimpeza e Siga-me não foram publicados como funções funcionais: faltam confirmação do protocolo ou, no Siga-me, integração com a medição de temperatura do controle/sensor externo.

## Verificação

Consulte `TEST-REPORT.md` e os registros em `test-results/`. Houve testes reais de comandos no aparelho, com autorização do usuário, e leitura dos pacotes recebidos. O estado inicial salvo foi restaurado: ligado, Cool, 21 °C, ventilação média, sem oscilação, Eco/Turbo/Sleep desativados e visor ligado. O usuário confirmou alterações físicas e o bipe habilitado; não confirmou especificamente o apagamento do visor.

Os timers foram testados com relógio simulado e expiração curta no aparelho. Não se aguardou um ciclo real de oito horas. Respostas do módulo podem demorar; falhas exploratórias por concorrência ou montagem do teste não contam como validação de funções.

## Operação e manutenção

O serviço inicia ao entrar na conta e reinicia após falhas. O Mac precisa estar ligado, acordado e na rede; a política de suspensão não foi alterada. Os temporizadores locais dependem disso. Uma reserva DHCP do IP do aparelho evita mudanças de endereço; o roteador não foi modificado.

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
