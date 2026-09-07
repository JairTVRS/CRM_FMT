# Roadmap dos lotes — CRM Formatar

**Atualizado em:** 07/09/2026
**Versão no ar:** 2.23.0

**Migrações:** 008, 009 e 010 aplicadas e conferidas no D1 remoto. **A
011 está PENDENTE** — o token `wrangler` desta máquina não tem escopo de
D1 (erro 7403). A 2.23.0 é segura sem ela: sem a coluna, o dossiê trata
como "o CRM não sabe", que é a verdade de hoje.

**A chave do hub tem `hub:customers:read`** — confirmado em 06/09/2026,
com os clientes do ERP listando na Jornada. **Faltam os quatro escopos do
Lote I** (`portfolios`, `meetings`, `meeting-types`, `teams`): desde a
2.22.0 o Plano de Ação nomeia os quatro de uma vez, numa tela só.

Este documento é o ponto de retomada. Registra o que já foi entregue, o
que vem a seguir e o que está travado esperando material.

---

## Onde estamos

O CRM deixou de ser só captação e passou a ter **duas trilhas no mesmo
produto**: o funil comercial (lead) e o relacionamento com cliente ativo
(CX). São dois pipelines separados — captar cliente e cuidar de cliente
são processos diferentes.

A área de CX da Formatar existe e é a dona da segunda trilha.

### Entregue

| Lote | Versão | Entrega |
|---|---|---|
| A | 2.9.0 | Base do funil: campos, advisors, tags e etapas |
| B | 2.10.0 | Importação de planilhas |
| **C** | **2.11.0** | **Quadro kanban genérico por pipeline**, classificação 1–6, arraste com suporte a toque, correção do Canal que não gravava |
| **D** | **2.12.0** | **Gaveta lateral** e ficha completa com a aba do Funil |
| **E** | **2.13.0** | **Gerador de documentos** e proposta comercial; paleta oficial da marca |
| **H** | **2.14.0** | **Jornada do cliente**, clientes, núcleos e papéis (2.14.1 corrigiu a proposta) |
| **L** | **2.15.0** | **Mapa de stakeholders e Dossiê de Experiência** — consumidor de verdade dos papéis criados no H |
| — | **2.16.0** | **Ajustes de tela** — calendário abre pelo campo, busca de CEP no ViaCEP, e a análise falsa da IA removida |
| — | **2.17.0** | **Versionamento num módulo só** — os três geradores passam a compartilhar `_lib/versionamento.js`; a proposta ganha registro de falha (migração 009) |
| **F¹** | **2.18.0** | **O lead vira cliente** — conversão a partir de "Finalizado", com tela de setup |
| **F²** | **2.19.0** | **Os clientes do ERP na Jornada** — lista ao vivo, "sem jornada" com um clique para começar, trava do CNPJ e vínculo do `erp_id` |
| — | **2.20.0** | **Trazer todos de uma vez** — a carteira inteira do ERP entra na jornada em lotes transacionais |
| **I** | **2.21.0** | **Reuniões, atas e plano de ação em 5W2H** — parser do manual v2.3, tela própria com a fila de ações de todas as carteiras (migração 010) |
| — | **2.21.1** | **Correção do cartão que parou de abrir** — uma segunda `registroPorId` declarada na 2.19.0 sombreava a primeira e travava os dois quadros |
| — | **2.22.0** | **As permissões do hub todas de uma vez**, filtros do Plano de Ação nunca vazios e o nome padrão dos documentos (`Dossie_Prospeccao_Cliente_2026_09`) |
| — | **2.23.0** | **A sessão para de cair** (403 do hub não é mais expulsão), guarda contra afirmação sem fonte no dossiê, `etapa_desde` (migração 011) e nome de arquivo pelo fantasia |

**A versão segue a ordem de ENTREGA, não a do plano.** O H saiu como
2.14.0 e o L como 2.15.0, embora o plano original os numerasse mais à
frente. Quando o F sair, será a próxima da fila — não a 2.15.

### A seguir

**A ordem mudou duas vezes**, sempre pela mesma razão: entregar o que não
depende de material externo. Em 04/09 o H passou na frente do F; em 05/09
o L passou na frente do I. Os lotes abaixo não têm mais versão reservada
— ganham a próxima quando saírem.

**Os dois proximos ja estao desenhados**, decididos com o usuario em
07/09/2026:

| Versao | Entrega | Depende de |
|---|---|---|
| **2.24.0** | **Identidade do ERP, avaliacao do CRM** — os stakeholders vem de `GET /customers/{id}` (`contacts`) e do `customerParticipants` das carteiras; o CRM nao cria nem renomeia pessoa. Influencia, postura e patrocinador ficam no CRM, amarrados ao id do contato. O cadastro de **Papeis** sai: vale o Cargo do ERP | a estrutura do `contacts`, que o proprio lote descobre por diagnostico |
| **2.25.0** | **O dossie le as atas** + **Balanca Avaliativa**, aba propria no cliente: positivos e negativos lado a lado, cada um ancorado em acao, ata ou registro com data | nada — `hub:meetings:read` ja esta na chave |

A 2.25.0 nao depende da 2.24.0. Se o `contacts` der problema, a ordem
inverte.

**Reversao registrada:** em 05/09 eu deixei `contacts` fora do `fields`
do `/customers`, com a justificativa de que "a ficha do CRM tem os seus".
A premissa estava errada — para cliente, o dono dos contatos e o ERP,
como ja valia para a lista de clientes e para as atas. O principio "o CRM
nao replica o ERP" estava aplicado em todo lugar menos ali.

| Lote | Entrega | Depende de |
|---|---|---|
| **G** | **Contrato e boas-vindas** — reaproveitam a casca do Lote E; cadastro das empresas contratadas; qualificação do representante preenchida na geração | template do contrato |
| **J** | **Webhooks e notas** — recepção assinada, protocolo de 6 passos nas notas de Erro | endpoint de notas + webhooks |
| **K** | **KPIs Empresariais** — série contínua com marco zero | endpoint de indicadores |
| **M** | **Saúde de CX** — Saúde e Aderência do ERP mais a camada de percepção | F, I, J, K |
| **N** | **Check-in, NPS/CSAT e Voz do Cliente** | F |
| **O** | **Relatório de Valor Gerado** | G, K |
| **P** | **Dashboard de CX**, pauta da CX Review e Expansão | tudo |

### A chave do hub: o que já vale e o que ainda falta

**O Lote F está fechado, e funcionando de verdade.** O escopo
`hub:customers:read` foi cadastrado e os clientes do ERP listam na
Jornada — deixou de ser promessa contra dublê.

**O Lote I ainda não.** Faltam quatro escopos na mesma chave:

| Permissão | Para quê |
|---|---|
| `hub:portfolios:read` | as carteiras |
| `hub:meetings:read` | as reuniões e as atas |
| `hub:meeting-types:read` | os tipos de reunião (os núcleos) |
| `hub:teams:read` | os times |

Até a 2.21.0 a tela nomeava **uma por vez**: cada ida ao painel da
Cloudflare revelava a seguinte, quatro viagens para um problema só. A
2.22.0 consulta as cinco fontes com `Promise.allSettled` e lista todas as
que faltam de uma vez. É diagnóstico, não conveniência — a mesma lição do
incidente da migração 007.

Destravado o I, destravam-se por tabela o M e o N.

**Três caminhos para um cliente chegar à trilha de CX**, e os três
existem: o lead finalizado que converte (2.18.0), o ativo do ERP que
aparece sozinho (2.19.0) e o cadastro manual (Lote H).

---

## Travado, esperando material

| O quê | Bloqueia |
|---|---|
| **Chave do hub com os quatro escopos do Lote I** — carteiras, reuniões, tipos de reunião, times | I, e por tabela M e N |
| **Endpoint das notas da carteira** (em desenvolvimento) | J |
| **Estrutura dos webhooks** | J |
| **Endpoint de indicadores** (em desenvolvimento) | K |
| **Template do contrato em Word** | G |

O contrato do endpoint de clientes **deixou de faltar**: veio da
documentação em 05/09/2026 e está implementado. `GET /customers`,
permissão `hub:customers:read`, `fields` obrigatório, filtro `status`
com `prospect|ad_hoc|active|inactive`, e resposta `{ size, data[] }`.

O que resta é **cadastrar a chave** — passo operacional, não de código.

---

## Decisões que valem para os próximos lotes

**O CRM não replica o ERP.** Lê ao vivo e guarda só o que anota por cima.
Onde há protocolo de CX sobre uma nota do ERP, o CRM guarda o estado do
protocolo, não o conteúdo da nota.

**A API do hub é somente leitura por ora.** Escrita é possível, mas ficou
decidido não usar — escrita de mão dupla cria divergência difícil de
rastrear.

**Lead finalizado não vira cliente sozinho.** Abre a conversão, e só com
o setup feito grava.

**Todo cliente de CX tem que existir no ERP.** Se o CNPJ não estiver lá,
o CRM barra e avisa. Cliente inativado no ERP é inativado no CX, mas
segue consultável na aba Inativos.

**Expansão é acréscimo de produto ou serviço** à entrega — não gera
contrato novo nem volta ao funil.

**Três níveis que não se confundem:** Time é agrupamento interno
(Governança, Operações); Tipo de Reunião é o núcleo de atendimento
(Logística, Estoque, Conselho Gestor); Carteira é cliente + tipo de
reunião. **A sequência de AÇÃO da ata é por carteira.**

**A jornada é do cliente; a saúde é da carteira.** No nível do cliente
vale a pior das carteiras — nunca a média, que esconderia o vermelho.

**Dois dossiês distintos:** o Executivo é pré-venda e existe; o de
Experiência é pós-venda e vem no Lote L.

**O 5W2H do plano de ação é meio da ata, meio do CRM.** Decidido em
06/09/2026. A ata dá três dos sete campos — What (a descrição da AÇÃO),
Who (`Resp.:`) e When (`Prazo:`). Why, Where, How e How much **não
existem no texto** e são preenchidos pela CX.

Foi recusada a alternativa de a IA sugeri-los a partir do contexto:
sugestão não confirmada vira verdade com o tempo, e este é um plano que
as pessoas cobram umas das outras.

**A chave da anotação é (carteira + número da ação)**, não a reunião. O
manual v2.3 diz que o ID nasce e morre com a ação e que a sequência é por
carteira; a mesma AÇÃO 7 reaparece nas atas seguintes até ser encerrada.
Chavear por reunião perderia a anotação na semana seguinte — justamente
quando ela passa a valer.

**A ata mais recente manda:** ação encerrada sai do plano, então o que
está na última ata é o que continua aberto.

**O CRM numera as ações por CLIENTE; a ata numera por tipo de reunião.**
Decidido em 06/09/2026. Um cliente com três carteiras tem três "AÇÃO 1"
no ERP. O identificador do CRM é `N.M` — N é a sequência do cliente, M é
o número da ação no núcleo.

O N é **gravado na primeira vez que a ação é vista e nunca reaproveitado**.
Calculado na hora, renumeraria quando uma ação fechasse, e o identificador
mudaria de significado. Consequência assumida: a leitura do plano escreve.

**O nome do núcleo vem do ERP** (`GET /meeting-types`), não do cabeçalho
da ata — o cadastro é dono do nome, e a ata é a reserva para quando o
tipo de reunião não estiver na lista. O **Time** vem do `GET /teams`, e
os três níveis chegam à tela sem se confundir: Time é o agrupamento
interno da Formatar, núcleo é o tipo de reunião no cliente, carteira é
cliente + núcleo.

**`participants` são os funcionários da Formatar; `customerParticipants`
são os do cliente.** Confirmado em 06/09/2026. Importa porque a presença
do cliente nas reuniões é insumo do Health Score.

**O hub é dono da lista de clientes ativos; o CRM anota por cima.**
Decidido em 05/09/2026, ao verificar a Jornada em navegador. A Jornada
passa a listar os clientes ativos do hub **ao vivo**, e a linha de
`clientes` no CRM guarda só a camada de jornada — etapa, núcleos,
stakeholders, observações. Cliente que existe no hub e ainda não tem
linha no CRM aparece como **"sem jornada definida"**, e não some da tela.

É a leitura coerente com a decisão que já estava aqui — o CRM não replica
o ERP, lê ao vivo — e **muda o que o Lote F precisa ser**: ele deixa de
ser "converter lead em cliente e cadastrar" para ser "ligar o lead
convertido a um cliente que o hub já conhece". A tabela `clientes`
continua existindo, mas deixa de ser a fonte de quem é cliente.

Implementado na 2.19.0. O cruzamento é **por CNPJ**, não por `erp_id`:
enquanto o vínculo não é gravado, o CNPJ é a única coisa que os dois
lados têm em comum — e é por isso que a ficha exige CNPJ e recusa CPF.

**"Sem ERP" e "sem jornada" não são a mesma coisa**, e a tela não pode
deixar parecer que são: o primeiro é cadastro que ninguém conferiu contra
o ERP; o segundo é cliente confirmado lá cuja jornada ainda não começou.

**No endereço, o CEP manda.** Decidido em 05/09/2026. Quando a consulta
de CNPJ (Receita) e a de CEP (ViaCEP) discordarem, vence o CEP: é a
intenção mais recente e mais específica de quem está digitando. A Receita
segue preenchendo o que a base de CEP não tem — o número do imóvel, que é
justamente o que só a pessoa sabe.

**Cliente sem `erp_id` é cadastro manual não conferido, não é cliente
fora do ERP.** São coisas diferentes, e o cartão do quadro diz "sem ERP"
para que uma não passe pela outra enquanto a trava do Lote F não existe.

---

## Incidente: a migração 006 ficou para trás

Descoberto em 04/09/2026, ao ler o esquema remoto antes de aplicar a
007: a tabela `propostas` **não existia em produção**, embora o Lote E
tenha subido na v2.13.0 no dia anterior. A geração de proposta estava
quebrada no ar desde então. Corrigido na v2.14.1.

**A convenção passa a ter duas metades**, não uma: migração antes do
deploy **e conferência depois de aplicar**. Um
`SELECT name FROM sqlite_master` custa segundos e teria pego isso.

**A lição maior é outra.** O erro na tela dizia só "Falha ao gerar a
proposta". A causa real — `no such table: propostas` — vinha na
resposta da API, no campo `details`, e o front a descartava. O bug de
banco durou um dia; o bug de diagnóstico é que o tornou invisível.
Mensagem de erro que engole a causa não protege ninguém numa
ferramenta interna: só transfere o trabalho de descobrir para quem tem
menos meios de fazê-lo.

---

## Incidente: o prompt proibia, o modelo escreveu assim mesmo

Em 07/09/2026, o primeiro Dossie de Experiencia gerado sobre um cliente
real afirmou, com **CONFIANCA ALTA**, que a ALPHATEX estava "estagnada na
etapa de Diagnostico ha mais de 83 meses". Tambem escreveu "percepcao de
baixa entrega da Formatar" e apoiou um risco em "sem registro de pessoas
ou reunioes".

O prompt proibia as tres coisas, com todas as letras. Proibia falar de
reunioes e de percepcao, e proibia tratar a ausencia de mapa como risco
do cliente.

Duas causas, e as duas importam:

**O dado nao existia.** O CRM sabia `data_inicio` (2019, o contrato) e a
etapa atual (posta na importacao em massa do dia anterior). Nao sabia
desde quando o cliente estava naquela etapa — e o vazio e onde a
inferencia entra. Corrigido com `etapa_desde` (migracao 011), onde nulo
significa "nao sei" e o contexto declara isso ao modelo.

**A guarda so existia no prompt.** Instrucao em prompt e pedido, nao
garantia. Este documento nomeia pessoas de um cliente real e e lido como
se fosse apurado; o que ele afirma passa agora por `filtrarPorFontes`,
que descarta todo item apoiado em fonte que o CRM nao tem — e **declara**
o descarte, porque sumir em silencio seria trocar um defeito por outro
mais dificil de ver.

**A regra geral que fica:** onde saida de IA vira documento com o nome da
Formatar, a conferencia e codigo, nao instrucao. Vale para o Dossie
Executivo, para a Balanca Avaliativa e para o que vier depois. E o mesmo
principio da analise falsa removida na 2.16.0, agora com mecanismo.

---

## Incidente: uma função sombreou a outra e o quadro parou de abrir

Na v2.19.0 declarei uma segunda `registroPorId` no mesmo escopo de
`public/js/quadro.js`. A última declaração vence, e a minha comparava o
id com `===` estrito — mas o `dataset.id` do cartão é **texto** e o `id`
do registro é **número**. Nunca casava.

O efeito não ficou no quadro. Sem abrir o cartão não se chega à ficha, e
sem a ficha não se chega ao Dossiê Executivo nem à proposta: um erro de
uma linha tornou inalcançável meia trilha comercial. **Ficou assim de
05/09 a 06/09** e travou o trabalho do lado do usuário.

Nada apontou para o defeito porque não houve erro — a função existia e
retornava `null`, que o código trata como "cartão sem registro". Falha
silenciosa em JavaScript não é exceção: é o comportamento normal de
sombreamento de escopo.

**O que passou a existir:** a prova `ids.mjs` falha se qualquer arquivo
do front declarar duas funções com o mesmo nome. Foi verificada
injetando uma duplicata falsa — guarda que não se viu falhar não é
guarda. As funções legitimamente repetidas entre arquivos (`renderizar`,
`iniciar`) estão numa lista de conhecidas.

**A lição:** o front é feito de scripts clássicos sem empacotador, e
todos partilham o mesmo escopo global. Não há linter no caminho do
deploy, e a redeclaração é legal na linguagem. Enquanto for assim, a
prova é o único lugar onde isso pode ser pego.

---

## Dívidas técnicas registradas

**Perfis de acesso não existem.** Aceitável enquanto só uma pessoa usa o
CX. O Dossiê de Experiência e o mapa de stakeholders guardam juízo sobre
pessoas nomeadas do cliente — quando a equipe crescer, isso vira
requisito, não melhoria.

**O `server.js` local não acompanha as rotas das Functions** desde a
migração para o Cloudflare. Para testar, use `npx wrangler pages dev` ou
o ambiente publicado, não `npm start`.

**Contrato e proposta divergem entre si** nos documentos atuais: km a
R$ 1,60 no contrato e R$ 1,75 na proposta; a rescisão da proposta
acrescenta "acerto proporcional aos serviços já implantados". No Lote G
os dois passam a sair do mesmo formulário — mas qual texto vale é
decisão de quem responde pelo jurídico.

~~**O versionamento de documento tem três implementações irmãs.**~~
**PAGA na 2.17.0.** Está tudo no `_lib/versionamento.js`, uma fábrica
parametrizada por tabela e coluna-chave. O contrato do Lote G será o
quarto consumidor quase de graça.

A comparação lado a lado revelou dois defeitos que ninguém veria lendo
uma cópia só, e os dois foram corrigidos junto: **a proposta era a única
que não registrava falha** (migração 009), e **o `dados_json` do
Executivo guardava `versao: null`**, o que faria um reprocessamento do
template renderizar capa sem versão.

**Os rótulos de influência e postura estão duplicados** entre o
`_lib/schema-dossie-cx.js` e o `public/js/stakeholders.js`. É inevitável
enquanto as Functions forem módulos ES e o front for script clássico —
mas se um rótulo mudar, mudam os dois, e nada avisa.

**Perfis de acesso ficaram mais caros de novo com o Lote L.** O que era
previsão agora está no banco: a tabela `stakeholders` guarda juízo da
Formatar sobre pessoas nomeadas do cliente — "resistente", "não
avaliada", observações escritas à mão — e o Dossiê de Experiência imprime
isso num documento. Continua aceitável porque só uma pessoa usa o CX. Na
segunda pessoa, vira requisito.

**A ficha do cliente é um modal próprio, não a gaveta do lead.** As duas
têm pouco em comum além de nome e documento; um formulário com metade dos
campos ocultos por trilha seria mais difícil de manter que dois
formulários honestos. Se a sobreposição crescer, reavaliar.
