# Manual — v2.35.0: gravação e transcrição da reunião

**Versão:** 1.0
**Data:** 28/09/2026
**Versão do sistema:** 2.35.0
**Responsável:** Jair Tavares

Quinta entrega do lote da jornada do lead. A reunião da agenda passa a
ser gravada e transcrita enquanto acontece. É a base dos insights
durante a reunião (2.36.0) e do laudo (2.37.0).

---

## 1. Instalação (feita em 28/09/2026)

**Migração 020**, antes do deploy (segura de rodar duas vezes):

```
npx wrangler d1 execute crm-formatar --remote --file=db/migracao-020-gravacao.sql
```

**O transcritor — um destes dois:**

- **Workers AI** (grátis nos testes): painel da Cloudflare → **Workers &
  Pages → crm-fmt → Settings → Bindings → Add → Workers AI**, nome
  **`AI`**, e um novo deploy. As Configurações dizem "Workers AI: ligado".
- **OpenAI**: cadastrar a chave nas **Configurações → Inteligência
  artificial** (usa o `whisper-1`, pago por minuto).

Sem nenhum dos dois, a janela de gravação avisa **antes** de começar e o
CRM recusa — nada é gravado para depois se perder.

---

## 2. Como gravar

1. Agenda → abrir a **reunião** (já salva) → **● Gravar a reunião**.
2. Marcar **"O lead foi avisado e concordou com a gravação"** —
   obrigatório; fica registrado quem confirmou e quando.
3. Escolher de onde vem o áudio:
   - **Reunião online, no computador**: o seu microfone e o **áudio da
     aba** da reunião (Meet, Teams…), separados — a transcrição mostra
     "Formatar:" e "Lead:". Ao começar, o navegador pede para escolher o
     que compartilhar: escolha a **aba** da reunião e marque
     **"Compartilhar áudio da guia"**. Com fone de ouvido fica melhor (sem
     fone, o microfone também capta o lead pela caixa de som).
   - **Um microfone só**: presencial, externo ou celular. Quem falou não é
     separado. No celular, a tela fica acesa enquanto grava — **no iPhone,
     tela apagada para a gravação**.
4. **● Começar a gravar.** A cada ~20 segundos o que foi dito aparece
   escrito na janela. **Pausar** e **Continuar** quando precisar.
5. **Encerrar**: o CRM espera o último pedaço, encerra e marca a reunião
   como **realizada** (o próximo e o último contato do lead acompanham).

A transcrição fica na própria reunião: abrindo-a de novo na agenda,
aparece abaixo de "Gravação".

---

## 3. O que acontece com o áudio

**Nada fica guardado além do texto.** O navegador corta o áudio em
pedaços de ~20 s (WAV 16 kHz mono), manda cada um para a transcrição e o
descarta. Pedaço de silêncio nem sai do computador. Não existe coluna de
áudio no banco.

Cada pedaço é transcrito em português, com o nome do lead de dica. As
frases que o Whisper às vezes "ouve" no silêncio ("Obrigado por
assistir.") são descartadas. Um pedaço que falhar é reenviado até 3
vezes; o reenvio substitui, nunca duplica.

A gravação guarda também a **versão do roteiro** em vigor quando começou
— os insights da 2.36.0 leem essa, mesmo que o roteiro mude depois.

---

## 4. Arquivos

| Arquivo | O quê |
|---|---|
| `db/migracao-020-gravacao.sql` | `gravacoes` (consentimento, modo, roteiro) e `transcricao_trechos` |
| `functions/api/_lib/transcricao.js` | Novo: Workers AI (Whisper large v3 turbo) ou OpenAI (whisper-1); filtro de frases fantasma |
| `functions/api/gravacoes.js` | Novo: começar, pedaço, encerrar, ler a transcrição |
| `public/js/audio-wav.js` | Novo: o áudio vira WAV 16 kHz mono em pedaços completos |
| `public/js/gravacao.js` | Novo: o gravador (uma voz por fonte), a fila de envio e a janela |
| `public/js/agenda.js`, `index.html`, `agenda.css` | O bloco "Gravação" na reunião; a janela por cima da reunião |
| `dev/prova/gravacao.mjs` | Nova: 32 conferências |

## 5. Como verificar

1. Ctrl+F5. Agenda → uma reunião → **Gravação: Ainda não gravada** e o
   botão **● Gravar a reunião**.
2. Se aparecer o aviso amarelo, falta o transcritor (item 1).
3. Gravar 1 minuto falando; o texto aparece a cada ~20 s.
4. Encerrar: a reunião fica "Realizada" e a transcrição aparece nela.
