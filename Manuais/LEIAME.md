# Manuais do CRM Formatar

Um manual por entrega, na ordem em que foram ao ar. Cada um traz o passo
de instalação, o que mudou, as decisões técnicas, como verificar e o que
ficou pendente.

**Onde começar:** o [ROADMAP](../ROADMAP-Lotes-CRM-FMT.md), na raiz, diz
o que já saiu e o que vem. Estes manuais são o detalhe de cada linha dele.

---

## Por versão do sistema

| Versão | Manual | Entrega |
|---|---|---|
| — | [Login Google](Manual-Login-Google-CRM-FMT-v1.0.md) | Autenticação e proteção da API |
| — | [Dossiê, lotes 1 e 2](Manual-Dossie-Lotes-1-2-CRM-FMT-v1.0.md) | Dossiê Executivo, base |
| — | [Dossiê, lote 5](Manual-Dossie-Lote-5-CRM-FMT-v1.0.md) | Dossiê Executivo e correções |
| — | [Dossiê, lote 6](Manual-Dossie-Lote-6-CRM-FMT-v1.0.md) | Dossiê Executivo, fechamento |
| 2.8.0 | [Persistência de Leads](Manual-Persistencia-Leads-CRM-FMT-v1.0.md) | Leads deixam de viver em arquivo |
| 2.9.0 | [Lote A](Manual-Funil-Lote-A-CRM-FMT-v1.0.md) | Base do funil: campos, advisors, tags, etapas |
| 2.10.0 | [Lote B](Manual-Importacao-Lote-B-CRM-FMT-v1.0.md) | Importação de planilhas |
| 2.11.0 | [Lote C](Manual-Quadro-Lote-C-CRM-FMT-v1.0.md) | Quadro kanban por pipeline |
| 2.12.0 | [Lote D](Manual-Gaveta-Lote-D-CRM-FMT-v1.0.md) | Gaveta lateral e ficha completa |
| 2.13.0 | [Lote E](Manual-Proposta-Lote-E-CRM-FMT-v1.0.md) | Gerador de documentos e proposta |
| 2.14.0 | [Lote H](Manual-Jornada-Lote-H-CRM-FMT-v1.0.md) | Jornada do cliente |
| 2.15.0 | [Lote L](Manual-Stakeholders-Lote-L-CRM-FMT-v1.0.md) | Stakeholders e Dossiê de Experiência |
| 2.16.0 | [Ajustes de tela](Manual-Ajustes-Tela-CRM-FMT-v1.0.md) | Calendário, CEP e a análise falsa removida |
| 2.17.0 | [Versionamento](Manual-Versionamento-CRM-FMT-v1.0.md) | Os três geradores num módulo só |
| 2.18.0 | [Lote F, parte 1](Manual-Conversao-Lote-F1-CRM-FMT-v1.0.md) | O lead vira cliente |
| 2.19.0 | [Lote F, parte 2](Manual-ERP-Lote-F2-CRM-FMT-v1.0.md) | Os clientes do ERP na Jornada |
| 2.21.0 | [Lote I](Manual-Plano-Acao-Lote-I-CRM-FMT-v1.0.md) | Reuniões, atas e plano de ação em 5W2H |
| 2.23.0 | [Correções v2.23](Manual-Correcoes-v2.23-CRM-FMT-v1.0.md) | A sessão para de cair, o dossiê para de inventar |
| 2.23.2 | [Importação, lote 1](Manual-Importacao-Lote-1-CRM-FMT-v1.0.md) | Ler a planilha certa |
| 2.23.2 | [Importação, lote 2](Manual-Importacao-Lote-2-CRM-FMT-v1.0.md) | Modelo, formatos e mapeamento |
| 2.23.2 | [Importação, lote 3](Manual-Importacao-Lote-3-CRM-FMT-v1.0.md) | Etapas novas passam pelo usuário |

Os quatro primeiros são anteriores à convenção de registrar a versão do
sistema no cabeçalho — estão na ordem de data.

---

## Convenções

**Nome do arquivo:** `Manual-<assunto>-CRM-FMT-v<versão do documento>.md`.
A versão no nome é a do **documento**, não a do sistema; ela sobe quando
o manual é revisado depois de publicado.

**Cabeçalho:** todo manual abre com versão do documento, data, versão do
sistema e responsável.

**Seções:** instalação primeiro, sempre. Quem abre um manual às pressas
quase sempre quer saber o que rodar e em que ordem.

**Migração antes do deploy.** Quando há migração de banco, o manual diz
se ela é segura para rodar duas vezes e traz a conferência de antes e a
de depois — as duas metades da convenção.

**Pendências são registradas, não escondidas.** O que ficou de fora, o
que depende de outro lote e as dívidas técnicas conhecidas vão na seção
de pendências do próprio manual.
