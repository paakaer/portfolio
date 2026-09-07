# WhatsApp Cloud API per gli ordini

**Stato Tech Provider, approvazione dei template e finestra di sessione — la
conoscenza operativa, non la documentazione delle API.**

*English version: [`README.md`](README.md).*

La documentazione Cloud API spiega come inviare un messaggio. Non spiega che la
categoria di un template può cambiare senza che tu faccia nulla, che un template
può essere approvato e comunque non inviabile, o che un pulsante corretto
nell'anteprima di Meta può produrre silenziosamente un link rotto per ogni
cliente. Sono queste le cose che costano settimane.

---

## 1. I tre fatti che decidono l'architettura

**La finestra di sessione di 24 ore.** Un'attività può scrivere liberamente per 24
ore dall'ultimo messaggio del cliente. Fuori da quella finestra, solo un
**template pre-approvato**. Non è un rate limit: è un altro tipo di messaggio, con
un altro percorso di approvazione e un altro prezzo. O lo progetti da subito, o lo
scopri la prima volta che un operatore prova a rispondere il mattino dopo.

**I template si approvano per WABA, e vengono ri-categorizzati senza preavviso.**
L'approvazione è asincrona e revocabile. Un template che non hai toccato può
passare da `APPROVED` a `PAUSED` o `DISABLED` per motivi di qualità, e la sua
**categoria** può essere riclassificata da Meta — nel caso peggiore
`UTILITY → MARKETING`, che cambia sia il prezzo sia il diritto di inviarlo.

**La categoria la decide Meta, non tu.** Da aprile 2025 `allow_category_change` è
**true** di default. Tu invii un template UTILITY, Meta può restituirtene uno
MARKETING, e nessun errore viene sollevato. Se la tua base giuridica per scrivere
è transazionale, questo ti sposta silenziosamente fuori: la base non cambia, ma
Meta applica le sue regole sulla categoria che ha assegnato *lei*.

**Quindi: leggi la categoria dalla risposta dell'API e fallisci in modo netto se
non corrisponde.** Non dare per scontato che la categoria richiesta sia quella
ottenuta.

---

## 2. Tech Provider, e perché cambia la forma del prodotto

Da **Meta Tech Provider** puoi attivare il WhatsApp Business Account di un cliente
con l'**Embedded Signup**: il cliente completa un flusso ospitato da Meta e il suo
numero finisce sotto la tua app, senza che nessuno si scambi password.

L'alternativa è chiedere al titolare di una pizzeria di creare un Business
Manager, verificare l'azienda e registrare un numero. Nella pratica è lì che il
progetto muore.

Tre conseguenze non ovvie finché non ci sei dentro:

- **L'onboarding diventa una funzionalità, non un ticket di assistenza.** È la
  differenza fra "registrati" e "prenota una call con il fondatore".
- **Diventi custode dei token di altre aziende.** Un vault per-tenant con
  cifratura seria smette di essere opzionale. Ruotare la chiave di cifratura
  distrugge crittograficamente la connessione di ogni tenant, senza recupero se
  non riconnettendoli uno per uno.
- **La versione delle Graph API è una dipendenza viva.** Le versioni fissate
  scadono, e una versione scaduta non fallisce in modo evidente: **viene
  reindirizzata silenziosamente** a una più recente che non hai testato. Tieni
  d'occhio il calendario di deprecazione e tratta un aggiornamento di versione
  come una modifica, non come una formalità.

Anche l'Embedded Signup viene deprecato e sostituito secondo i tempi di Meta, non
i tuoi. Metti in conto una migrazione che non hai scelto.

---

## 3. Il reconcile sweep — il pezzo che nessuno costruisce finché non fa male

Il tuo stato locale di un template è una **cache di una decisione remota che
cambia senza chiedertelo.** I webhook ti avvisano delle transizioni, ma i webhook
perdono pezzi: una consegna fallisce, arriva uno stato che non gestisci, un
operatore modifica qualcosa dall'interfaccia di Meta.

Servono due meccanismi, entrambi:

1. **I webhook** — `message_template_status_update` e `template_category_update`
   arrivano sul callback condiviso dell'app, raggruppati per entry e per change,
   nella *stessa* busta dei messaggi in arrivo. Percorri tutta la busta, o
   perderai gli eventi arrivati insieme ad altro.
2. **Uno sweep periodico di riconciliazione** — rileggi la verità dall'API, per
   WABA, e aggiorna. Idempotente: verifica se il template esiste, crealo se manca,
   leggi la categoria dalla risposta, fallisci se non corrisponde, aggiorna il
   registro. Eseguirlo due volte non lascia duplicati da nessuna parte.

**Gestisci gli stati che non conosci.** Meta ha stati oltre quelli che modelli
(`IN_APPEAL`, `FLAGGED`, e altri nel tempo). Ignorare uno stato sconosciuto va
bene *se* lo sweep prima o poi corregge il record. Senza sweep, ignorare significa
perdere dati.

---

## 4. Il bug che vale l'intero documento

Tutti i link agli ordini per gli operatori erano morti in produzione, per giorni,
e nessun errore lo segnalava.

I pulsanti dei template WhatsApp sono di due tipi. Un pulsante URL **dinamico**
porta un segnaposto `{{1}}` e il valore lo passi al momento dell'invio. Un
pulsante URL **statico** ha un URL fisso e non accetta parametri.

Il nostro era statico. L'anteprima di Meta lo mostrava correttamente. Gli invii
andavano a buon fine. L'API rispondeva 200. Ma alla consegna il valore passato
veniva **accodato** all'URL fisso invece che sostituito dentro, e ogni operatore
riceveva un link a un indirizzo inesistente.

Tre proprietà lo hanno reso costoso:

- **Si manifesta solo alla consegna.** Non nell'editor, non nella risposta
  dell'API, non in nessuno stato.
- **L'invio riesce.** Non c'è un messaggio fallito su cui allertare, nessun tasso
  di errore da guardare, nessun retry che l'avrebbe intercettato.
- **Gli operatori hanno pensato di aver sbagliato loro.** Un link morto sembra un
  telefono rotto, non una piattaforma rotta, e per giorni nessuno l'ha segnalato.

**La lezione generalizzabile:** in questa API la differenza fra statico e dinamico
non è un flag che imposti, è la forma che hai inviato al momento dell'approvazione
— e una volta approvato, una discordanza fra quella forma e il payload di invio
non è un errore, è un risultato sbagliato. **Testa una consegna reale su un
telefono reale per ogni template.** Non l'anteprima. Non un 200 dell'API. Un
telefono.

---

## 5. Cosa inviamo, e cosa deliberatamente no

**Solo in uscita, per cominciare.** Il percorso base per ordinare è un link
`wa.me` precompilato: il cliente tocca, WhatsApp si apre con l'ordine già scritto,
e lo invia lui. Nessuna API, nessun template, nessuna finestra di sessione,
nessun onboarding per-tenant.

Non è un ripiego, è un buon default. Funziona dal primo giorno per ogni tenant,
non costa nulla, e mette il messaggio nella conversazione fra il cliente e il
ristorante — che è dove il cliente lo andrà a cercare comunque.

La Cloud API si ripaga per i messaggi che deve iniziare il *ristorante*: ordine
confermato, ordine pronto, ordine annullato, orario di ritiro aggiornato. Una
dozzina di template, tutti UTILITY, tutti brevi.

**Le ricevute di consegna oggi vengono scartate.** I payload del webhook
`statuses` sono trattati come eventi non-messaggio e ignorati: significa che
"inviato" è l'ultima cosa che sappiamo davvero. È una lacuna reale, e la dichiaro:
possiamo dirti che un messaggio è partito, non che è arrivato.

---

## 6. La checklist in cinque righe

Se questa settimana inizi un'integrazione WhatsApp:

1. **Ottieni lo stato Tech Provider prima di costruire l'onboarding.** Cambia
   *cosa sia* l'onboarding.
2. **Leggi la categoria da ogni risposta di approvazione e fallisci se non
   corrisponde.** Non fidarti della categoria che hai inviato.
3. **Costruisci il reconcile sweep insieme al webhook, non dopo.** Il webhook
   perde pezzi; lo sweep è la fonte di verità.
4. **Invia un messaggio reale per ogni template a un telefono reale prima del
   go-live.** L'API ti ingannerà riuscendo.
5. **Fissa la versione delle Graph API e segna in agenda la scadenza.** Alla
   scadenza il reindirizzamento è silenzioso.

---

## Cosa non c'è

- **Nessun repository.** Servono un'app Meta, un'azienda verificata, un WABA e un
  numero attivo. Un repo dimostrativo sarebbe uno screenshot con passaggi in più.
- **L'artefatto è il Loom.** Un ordine partito da uno storefront che arriva su
  WhatsApp su un numero sandbox, e la risposta dell'operatore che torna indietro —
  circa novanta secondi. Questo documento è la nota di supporto.
- **Nessun flusso conversazionale in ingresso.** Non gestiamo un bot. Il cliente
  parla con il ristorante, non con noi — scelta che ritengo corretta per questo
  mercato, ma che significa che non ho costruito NLU, routing di intent o una
  macchina a stati conversazionale.
