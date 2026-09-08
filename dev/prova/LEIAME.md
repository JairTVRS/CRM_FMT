# As provas

```bash
cd dev/prova
for f in *.mjs; do node "$f"; done
```

Ou, da raiz: `npm run prova`.

São 427 conferências em 11 suítes. Rodam com `node:sqlite` em memória e,
onde precisam do ERP, sobem o dublê (`dev/hub-stub.mjs`) num processo à
parte. **Nenhuma chama IA de verdade** — todas usam resposta fabricada.

## Por que elas vivem aqui agora

Viveram num diretório temporário de sessão até 07/09/2026. Duas coisas
estavam erradas nisso.

A primeira é óbvia: o diretório some, e com ele 427 conferências.

A segunda é pior, e só apareceu quando fui movê-las. As suítes
importavam de uma **cópia** do código — `prova/_lib/`, `prova/plano-acao.js`
— em vez do arquivo de verdade. Quatro dessas cópias estavam
desatualizadas: exatamente os quatro arquivos que a v2.23.0 alterou.

**As provas estavam passando contra código morto.** Três asserções ainda
exigiam o comportamento antigo (403 em vez de 503, `ALPHATEX` em vez de
`Alphatex`) e continuavam verdes, porque a cópia que elas liam nunca
mudou. Repontadas para o original, as três falharam de imediato — e eram
mudanças intencionais, não regressões, mas eu não teria sabido a
diferença.

Prova que lê cópia não é prova. É um teste do passado, verde para
sempre, que dá a sensação de cobertura sem a cobertura.

**Regra que fica:** toda suíte importa de `../../functions/api/...`, por
caminho relativo. Nada de cópia, nada de caminho absoluto desta máquina
— o `RAIZ` sai de `import.meta.url`.

## O que cada uma protege

| Suíte | O quê |
|---|---|
| `ata.mjs` | o parser das atas contra o manual v2.3 |
| `ata-real.mjs` | os quatro defeitos que só uma ata de verdade revelou |
| `cep.mjs` | ViaCEP, e o número que não pode se perder |
| `conversao.mjs` | o lead que vira cliente |
| `etapa-desde.mjs` | os gatilhos da migração 011, contra SQLite real |
| `hub.mjs` | o cliente do ERP e os códigos de erro |
| `ids.mjs` | id que o JS procura existe no HTML; função duplicada no mesmo arquivo reprova |
| `plano.mjs` | o plano de ação ponta a ponta, com o dublê do hub |
| `prova.mjs` | o Dossiê de Experiência e o mapa de stakeholders |
| `sessao.mjs` | a sessão que não pode cair, o nome dos arquivos, a guarda das fontes |
| `versionamento.mjs` | as versões dos três documentos |

`ids.mjs` existe por causa de um incidente: uma segunda `registroPorId`
declarada no mesmo escopo sombreou a primeira e travou os dois quadros
por um dia, sem erro nenhum no console. Ela reprova qualquer arquivo do
front com duas funções de mesmo nome.
