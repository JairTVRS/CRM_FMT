# Roadmap dos lotes — CRM Formatar

**Atualizado em:** 05/09/2026
**Versão no ar:** 2.15.0 (migração 008 aplicada e conferida no D1 remoto)

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

**A versão segue a ordem de ENTREGA, não a do plano.** O H saiu como
2.14.0 e o L como 2.15.0, embora o plano original os numerasse mais à
frente. Quando o F sair, será a próxima da fila — não a 2.15.

### A seguir

**A ordem mudou duas vezes**, sempre pela mesma razão: entregar o que não
depende de material externo. Em 04/09 o H passou na frente do F; em 05/09
o L passou na frente do I. Os lotes abaixo não têm mais versão reservada
— ganham a próxima quando saírem.

| Lote | Entrega | Depende de |
|---|---|---|
| **F** | **Cliente e conversão** — "Finalizado" abre a conversão, busca do CNPJ no ERP com trava, vínculo de ID, classificação herdada | chave do hub com escopo ampliado |
| **G** | **Contrato e boas-vindas** — reaproveitam a casca do Lote E; cadastro das empresas contratadas; qualificação do representante preenchida na geração | template do contrato |
| **I** | **Reuniões e atas** — sinais diretos do `/meetings`, parser do manual v2.3 para o plano de ação; traz a **carteira** (cliente + núcleo) | chave do hub — o `/meetings` está fora do escopo atual |
| **J** | **Webhooks e notas** — recepção assinada, protocolo de 6 passos nas notas de Erro | endpoint de notas + webhooks |
| **K** | **KPIs Empresariais** — série contínua com marco zero | endpoint de indicadores |
| **M** | **Saúde de CX** — Saúde e Aderência do ERP mais a camada de percepção | F, I, J, K |
| **N** | **Check-in, NPS/CSAT e Voz do Cliente** | F |
| **O** | **Relatório de Valor Gerado** | G, K |
| **P** | **Dashboard de CX**, pauta da CX Review e Expansão | tudo |

### Com o L entregue, acabaram os lotes desbloqueados

O L era o último que dava para fazer só com o que o CRM já tem. **Todos
os lotes restantes esperam material externo.** A tabela do I dizia
"depende de —", mas isso estava errado: o `/meetings` também está fora do
escopo da chave atual. Corrigido acima.

A chave do hub com escopo ampliado é o gargalo real — destrava F e I, e
por tabela M e N. Enquanto ela não chega, não há próximo lote para puxar
à frente; o que sobra é trabalho fora da fila: a verificação em navegador
pendente do H e do L, ou a unificação dos três geradores de documento.

**O que o Lote H já adiantou do F:** a tabela `clientes` existe com
`erp_id` e `lead_id` nascendo nulos, a ficha está pronta e a aba de
inativos foi entregue junto. O F acrescenta por cima — busca no ERP,
trava, preenchimento dos vínculos e a tela de conversão a partir do lead
— sem refazer nada.

---

## Travado, esperando material

| O quê | Bloqueia |
|---|---|
| **Chave do hub com escopo ampliado** — clientes, reuniões, carteiras, tipos de reunião, times, notas | F em diante |
| **Endpoint das notas da carteira** (em desenvolvimento) | J |
| **Estrutura dos webhooks** | J |
| **Endpoint de indicadores** (em desenvolvimento) | K |
| **Template do contrato em Word** | G |

**O Lote H foi entregue em 04/09/2026** justamente porque não dependia de
nada disso. O próximo lote sem bloqueio é o **L**.

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

**O versionamento de documento agora tem TRÊS implementações irmãs** — o
dossiê executivo, a proposta e, desde o Lote L, o dossiê de CX. Todas
fazem o mesmo: calcular a próxima versão, gravar e reprocessar na colisão
do `UNIQUE`. Com um consumidor era abstração prematura; com três já não
é. **Esta é a dívida mais madura da lista** — e é candidata natural para
o tempo em que a chave do hub não chegar, já que não depende de nada
externo.

O cuidado: unificar mexe no caminho da proposta, que já quebrou em
produção uma vez. Vale fazer com a prova em SQLite antes.

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
