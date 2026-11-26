# Relatório histórico de implementação e testes — Midea Casa

**Atualização de 26/11/2026:** removidos os botões Auto/Cool dedicados, Noite, Conforto e todos os temporizadores, incluindo o agendador. Os sete testes atuais passaram, cobrindo a migração dos acessórios já salvos, a ausência dos botões removidos, Auto/Cool pelo seletor, velocidade e Silencioso. A migração não envia comandos ao aparelho. Com `temperatureCard: true`, o termostato fica sozinho no card principal e os seis botões com a velocidade ficam no painel auxiliar `Controles do ar`. A inspeção no Casa do Mac confirmou card branco com 23,0 °C em azul e alvo de 21,0 °C; o modo estava Auto. O painel auxiliar foi conferido e colocado no cômodo Quarto. Esta solução usa dois acessórios; não mantém os botões dentro da tela do termostato. A tela do iPhone ainda não foi inspecionada nesta configuração. A tabela abaixo registra testes de versões anteriores, incluindo funções já retiradas; não representa uma nova execução no aparelho.

As extensões foram publicadas preservando a identidade dos serviços existentes e o pareamento. Os novos serviços são adicionados ao mesmo acessório. Quatro testes de software passaram: pacote do visor, persistência/repetição/cancelamento de timers, callbacks HomeKit e modo Silencioso sem alegar controle de LEDs.

## Verificação de comandos no aparelho

Os 20 itens abaixo tiveram confirmação nos pacotes recebidos do aparelho. Nas verificações de silêncio, o comando leva o sinal de bipe desabilitado; o usuário confirmou que os primeiros testes não emitiram bipes e que o comando posterior com áudio habilitado emitiu bipe. O teste de cancelamento restaura esse sinal. A confirmação não usa apenas os valores que o plugin atualiza de forma otimista antes da resposta.

| Teste | Resultado | Registro |
|---|---|---|
| Cool button | Confirmado | homekit-hardware-results.json |
| Auto button | Confirmado | homekit-hardware-results.json |
| Auto blocks manual fan | Confirmado | homekit-hardware-results.json |
| Fan low | Confirmado | homekit-hardware-results.json |
| Fan medium | Confirmado | targeted-fan.json |
| Fan high | Confirmado | confirmed-controls.json |
| Fan automatic | Confirmado | confirmed-controls.json |
| Dry | Confirmado | confirmed-controls.json |
| Fan only | Confirmado | confirmed-controls.json |
| Super | Confirmado | confirmed-controls.json |
| Comfort 23 | Confirmado | confirmed-controls.json |
| Vertical swing on | Confirmado | confirmed-controls.json |
| Vertical swing off | Confirmado | confirmed-controls.json |
| Timer cancellation | Confirmado | homekit-hardware-results.json |
| Timer power off expiry | Confirmado | confirmed-controls.json |
| Timer power on expiry | Confirmado | confirmed-controls.json |
| Night 8h program | Confirmado | final-night-display.json |
| Quiet fan and mute | Confirmado | final-quiet.json |
| Quiet cancel restores feedback | Confirmado | final-quiet.json |
| Restore initial state | Confirmado | final-quiet.json |

Os timers de ligar/desligar foram executados com expiração curta no aparelho. Os prazos de 1/2/4/8 horas e a persistência após reinício foram verificados em software; não se aguardou um ciclo real de oito horas.

## Limitações e funções não publicadas como funcionais

- **Eco interno:** a flag continuou falsa nos testes, embora temperatura e ventilação tenham mudado. O botão **Noite 8 horas** é um programa local: Cool, temperatura mínima de 24 °C, ventilação automática e desligamento em oito horas. Não se afirma reproduzir o algoritmo de economia interno.
- **Não Perturbe completo / LEDs:** o retorno do visor permaneceu ligado nos testes com as duas formas de comando. O usuário não conseguiu observar especificamente o visor. O botão publicado é **Silencioso**, limitado a ventilação baixa e comandos sem bipe. Foram corrigidos um byte reservado ausente no comando legado e o nome incorreto de uma propriedade do comando alternativo, mas isso não confirmou o suporte do aparelho.
- **Posição fixa da aleta:** os comandos foram tentados, mas não houve retorno confirmando o ângulo. A oscilação liga/desliga está confirmada. Não foi publicado um controle de posição fictício.
- **Energia 75%/50%:** os comandos foram tentados e o retorno dos níveis não foi obtido; a consulta de capacidades declarou apenas o nível normal. O último comando enviado foi retornar a 100%.
- **Ionizador:** tentativa de ativar não retornou estado ativo; a existência do hardware não foi confirmada.
- **Autolimpeza:** os comandos de ativar e desativar foram tentados, sem retorno de estado válido. A consulta de capacidades não declarou suporte.
- **Siga-me:** a função completa depende da temperatura medida no controle remoto ou em um sensor externo integrado. Essa medição não está disponível à ponte; não foi implementado um botão que apenas indique sucesso sem fornecer temperatura externa ao aparelho. A função completa permanece sem teste.

Essas limitações impedem declarar que todas as funções do controle físico foram reproduzidas.

## Integridade do estado e evidência

Estado final confirmado: ligado, modo Cool, alvo de 21 °C, ventilação média (60), oscilação desligada, Eco/Turbo/Sleep desativados e visor ligado. Nenhuma mudança foi feita no roteador ou na política de suspensão do Mac.

Resultados exploratórios com concorrência de consultas, API simulada incompleta ou janela de confirmação curta foram descartados como critérios de aprovação. Os registros finais usados são os da tabela e `validated-summary.json`. Leituras de propriedades extras estão em `optional-features.log`; o teste alternativo do visor está em `display-probe.log`.

Os comandos normais passaram a usar retorno sonoro; o usuário confirmou o bipe. Silencioso guarda o ajuste anterior para restauração. Os timers e o programa Noite dependem de o Mac permanecer ligado, acordado e na rede.
