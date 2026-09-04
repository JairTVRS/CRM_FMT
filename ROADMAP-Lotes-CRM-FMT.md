# Roadmap dos lotes — CRM Formatar

**Atualizado em:** 04/09/2026
**Versão no ar:** 2.14.0

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

### A seguir

**A ordem mudou em 04/09/2026.** O Lote H foi puxado para a frente porque
era o único adiante que não dependia de material externo, e o F seguia
travado. As versões abaixo são as próximas na fila, não as do plano
original.

| Lote | Versão | Entrega | Depende de |
|---|---|---|---|
| **F** | 2.15 | **Cliente e conversão** — "Finalizado" abre a conversão, busca do CNPJ no ERP com trava, vínculo de ID, classificação herdada | chave do hub com escopo ampliado |
| **G** | 2.16 | **Contrato e boas-vindas** — reaproveitam a casca do Lote E; cadastro das empresas contratadas; qualificação do representante preenchida na geração | template do contrato |
| **I** | 2.17 | **Reuniões e atas** — sinais diretos do `/meetings`, parser do manual v2.3 para o plano de ação; traz a **carteira** (cliente + núcleo) | — |
| **J** | 2.18 | **Webhooks e notas** — recepção assinada, protocolo de 6 passos nas notas de Erro | endpoint de notas + webhooks |
| **K** | 2.19 | **KPIs Empresariais** — série contínua com marco zero | endpoint de indicadores |
| **L** | 2.20 | **Dossiê de Experiência e stakeholders** — consumidor de verdade dos papéis criados no Lote H | — |
| **M** | 2.21 | **Saúde de CX** — Saúde e Aderência do ERP mais a camada de percepção | F, I, J, K |
| **N** | 2.22 | **Check-in, NPS/CSAT e Voz do Cliente** | F |
| **O** | 2.23 | **Relatório de Valor Gerado** | G, K |
| **P** | 2.24 | **Dashboard de CX**, pauta da CX Review e Expansão | tudo |

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

**O `_lib/storage.js` do dossiê e o versionamento da proposta são
irmãos, não compartilhados.** Com um consumidor cada, extrair seria
abstração prematura. Quando o contrato chegar no Lote G, vale unificar.

**Perfis de acesso ficaram mais caros com o Lote H.** A trilha de CX
guarda dado de cliente ativo — contato, observações e, no Lote L, juízo
sobre pessoas nomeadas. Continua aceitável porque só uma pessoa usa o CX,
mas a dívida cresceu.

**A ficha do cliente é um modal próprio, não a gaveta do lead.** As duas
têm pouco em comum além de nome e documento; um formulário com metade dos
campos ocultos por trilha seria mais difícil de manter que dois
formulários honestos. Se a sobreposição crescer, reavaliar.
