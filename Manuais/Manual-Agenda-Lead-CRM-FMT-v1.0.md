# Manual — v2.32.0: a agenda do lead

**Versão:** 1.0
**Data:** 28/09/2026
**Versão do sistema:** 2.32.0 · revisto na 2.32.1 (escolha do lead)
**Responsável:** Jair Tavares

Segunda entrega do lote da jornada do lead (ver o ROADMAP). A agenda é
onde as próximas entregas se penduram: a gravação, a transcrição, os
insights e o laudo são todos de uma **reunião** desta agenda.

---

## 1. Instalação

### 1.1 Migração 017, antes do deploy

```
npx wrangler d1 execute crm-formatar --remote --file=db/migracao-017-agenda-lead.sql
npx wrangler d1 execute crm-formatar --remote --command="SELECT COUNT(*) AS contatos_migrados FROM agenda_lead WHERE criado_por = 'migracao-017'"
```

A segunda mostra quantos "Próximo contato" viraram contatos agendados.
**Segura de rodar duas vezes.**

### 1.2 O Time "Vendas" no hub

Os tipos de reunião do lead são os tipos do **hub** cujo Time é
**Vendas**. No hub: cadastre o Time "Vendas" e, em cada tipo de reunião
de venda (ex.: Diagnóstico, Apresentação, Proposta), escolha esse Time.

Sem isso a agenda funciona, mas a reunião fica sem tipo e a visão Agenda
mostra um aviso amarelo dizendo o que falta. Um tipo novo cadastrado lá
aparece no CRM em até 10 minutos, sem deploy.

Se o Time tiver outro nome: variável `TIME_VENDAS` no painel da
Cloudflare.

---

## 2. O que mudou

### 2.1 A visão Agenda

Na tela de Leads, ao lado de **Tabela** e **Quadro**, agora há **Agenda**:

- **Semana** ou **Mês**, com ‹ **Hoje** › para navegar;
- o **filtro de responsável** e a **busca** da barra valem aqui — "Meus
  leads" mostra só a sua agenda;
- clicar num compromisso abre; clicar no espaço vazio de um dia agenda
  naquele dia; **+ Agendar** agenda escolhendo o lead: digite parte do
  nome, do CNPJ ou do telefone e **clique** nele na lista que abre abaixo
  do campo (2.32.1 — antes eram sugestões do navegador, que algumas
  extensões escondiam);
- no celular, os dias da semana se empilham.

### 2.2 Reunião ou contato

| | Reunião | Contato |
|---|---|---|
| Quando | data, hora, duração | data e hora |
| O quê | tipo de reunião (hub, Time Vendas) | canal: ligação, WhatsApp, e-mail, outro |
| Onde | **Online** (link da sala), **Presencial** ou **Externo** — só a informação | — |
| Quem | CX responsável, participantes do lado do lead | CX responsável |
| Dossiê | **dentro da reunião**, para estudar antes | — |

O CX responsável nasce com o responsável do lead e pode ser trocado.

### 2.3 O dossiê dentro da reunião

A janela da reunião mostra se o lead tem dossiê (versão e data) com o
botão **Abrir o dossiê**, ou **Gerar o dossiê** quando ainda não tem.
Lead com CPF fica sem dossiê, como decidido.

### 2.4 O que aconteceu com o compromisso

A situação muda depois: **Realizada**, **Não compareceu**, **Cancelada**.

- **Remarcar** não edita a data: a atual fica "Remarcada" e nasce outra
  na data nova, com tipo, local e link. O histórico mostra que o lead
  remarcou.
- **Excluir** é para o que foi lançado por engano. O que não aconteceu é
  "Cancelada".

### 2.5 O próximo contato vem da agenda

O **Próximo contato** da ficha agora é a **primeira reunião ou contato
ainda agendado**. O campo ficou só de leitura; para mudar, agende na aba
**Agenda** da ficha.

- Os "Próximo contato" que já existiam viraram **contatos agendados às
  9h**, com o responsável do lead (migração 017).
- O da **planilha de importação** também vira contato agendado.
- **Realizada** atualiza o **Último contato** — só para a frente.

### 2.6 A aba Agenda da ficha

Na ficha do lead, a aba **Agenda** lista tudo dele, do mais recente para
o mais antigo, com **+ Reunião** e **+ Contato**. É o histórico da
pré-venda, e fica com o lead quando ele vira cliente.

### 2.7 "Sem agenda"

Lead **em aberto** sem nada agendado aparece com o selo amarelo **sem
agenda** na tabela e no cartão do quadro. É o lead que esfria sem
ninguém ver. Lead em Contrato emitido ou Perdido não precisa de agenda.

---

## 3. Arquivos

| Arquivo | O quê |
|---|---|
| `db/migracao-017-agenda-lead.sql` | Tabela `agenda_lead`; os próximos contatos viram agenda |
| `functions/api/_lib/agenda.js` | Regras: data e hora, próximo contato derivado, tipos do Time Vendas |
| `functions/api/agenda.js` | Novo: listar, criar, alterar, remarcar, excluir |
| `functions/api/leads.js` | A ficha não grava mais o próximo contato |
| `functions/api/importar.js` | O próximo contato da planilha vira agenda |
| `public/js/agenda.js` | Novo: visão Agenda, janela do compromisso, aba da ficha |
| `public/js/leads.js`, `quadro.js`, `app.js` | Terceira visão, selo "sem agenda", Esc |
| `public/assets/css/agenda.css` | Novo |
| `dev/prova/agenda.mjs` | Nova: 37 conferências |

---

## 4. Como verificar

1. Ctrl+F5. Leads → **Agenda**. Se aparecer o aviso amarelo, falta o
   Time Vendas no hub (1.2).
2. **+ Agendar** → Reunião → escolher o lead, data, hora, local Online e
   o link → Salvar. Ela aparece no dia.
3. Abrir a reunião: o dossiê aparece com o botão.
4. Abrir o lead → aba **Agenda**: a reunião está lá. Aba **Funil**: o
   Próximo contato é a data dela.
5. Na reunião, **Remarcar** para outro dia: a antiga fica riscada, a nova
   aparece, e o Próximo contato acompanha.
6. Marcar como **Realizada**: some da conta do próximo contato, e o
   Último contato vira a data dela.
7. Um lead em aberto sem nada agendado mostra **sem agenda** na tabela.
