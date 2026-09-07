# Consenso, marketing e diritto italiano

**Cosa può inviare lecitamente un'attività di ristorazione italiana, a chi, e come
modellarlo perché la risposta regga a un controllo.**

*English version: [`README.md`](README.md).*

> **Non è un parere legale.** È documentazione tecnica di decisioni prese con le
> fonti primarie alla mano, e le cita perché il ragionamento sia verificabile.
> Confronta con un legale prima di agire: le fonti sono indicate proprio per
> potergli portare qualcosa di preciso invece di una domanda.

---

## L'affermazione che sorprende

**L'email commerciale a freddo verso un'azienda è illecita in Italia senza
consenso preventivo, e il legittimo interesse GDPR non può sostituirlo.**

Quasi tutti i manuali di outbound in lingua inglese dicono il contrario: il B2B va
bene in legittimo interesse, basta offrire l'opt-out. In Italia è falso dal
**1° giugno 2012**, e ripeterlo significa citare qualcosa scaduto da quattordici
anni.

### Perché quasi tutti sbagliano

L'Italia ha esercitato la discrezionalità dell'art. 13(5) ePrivacy **dentro una
definizione**, non dove uno andrebbe a cercarla.

- L'art. 130 c.1/c.2 subordina l'email promozionale al consenso del *contraente o
  utente*.
- L'**art. 121 c.1-bis lett. f)** definisce poi *contraente* **includendo la
  persona giuridica**.

Così l'obbligo di consenso arriva alle aziende, e ci arriva attraverso un articolo
di definizioni che chi legge solo l'art. 130 non apre mai. Il Garante ha
confermato che il Titolo X capo 1 raggiunge le persone giuridiche (provv.
20/9/2012, doc. web 2094932), e sono parole sue che prima di quella data le
persone giuridiche erano *"liberamente contattabili"* — che è esattamente
l'origine del malinteso.

**La via del legittimo interesse è chiusa**, non semplicemente dubbia: EDPB
Opinion 5/2019 ¶40, e il provvedimento del Garante *Aesir s.r.l.* (17/4/2026)
contro una società che aveva raccolto contatti da LinkedIn Sales Navigator e
Snov.io invocando l'art. 6(1)(f) — *"unicamente sul consenso"*.

**Cosa resta lecito:** posta cartacea a freddo e telefonata con operatore, fuori
dall'art. 130 su base di legittimo interesse, previa verifica del Registro
Pubblico delle Opposizioni.

### Cosa significa per un prodotto

Non puoi rilasciare una funzionalità di outreach a freddo via email per il mercato
italiano. Né con un opt-out, né con una riga "ti abbiamo trovato su LinkedIn", né
in B2B.

L'abbiamo scoperto pianificando proprio quella funzionalità, e la scoperta **ha
ridisegnato l'intero piano**, da outreach a freddo a consenso-primo. È questo il
costo onesto di farlo bene: una funzionalità già dimensionata ha smesso di
esistere.

Ha anche fatto emergere un **difetto già in produzione**: un segmento costruito su
chi aveva richiesto un preventivo catering. Il soft opt-in dell'art. 130 c.4 vale
*"nel contesto della vendita"*, e una richiesta di preventivo non è una vendita.
Il Garante ha espressamente escluso che l'opt-out sani una base giuridica assente
(*Mevaluate* §8), quindi la correzione non è stata "aggiungere la
disiscrizione" — è stata smettere di usare il segmento.

---

## Il modello che regge al controllo

La domanda del regolatore non è mai "ha dato il consenso". È **"dimostra cosa hai
chiesto, quando, su quale schermata e con quali parole."** Questo plasma lo schema
più di qualsiasi funzionalità.

### Il consenso è per canale, non per persona

```ts
type ConsentChannel = 'email' | 'whatsapp'
```

Indipendenti, perché sono disciplinati in modo indipendente. Una persona può
volere l'email mensile e non volere WhatsApp, e **un solo booleano non può dirlo.**
Fondere due canali in una casella sola non è recuperabile: non puoi separare a
posteriori una decisione mai registrata separatamente.

### Il meccanismo nomina un atto che qualcuno ha compiuto

Ogni meccanismo memorizzato è una cosa precisa fatta su una schermata precisa:
`checkout`, `preference_page`, `whatsapp_stop`, `in_person_capture`,
`catering_request`, `corporate_form`, `group_order`, `operator_import`.

Sono valori distinti e non un unico contenitore `catering` per un motivo concreto:
una risposta a una richiesta di accesso che dice *"hai acconsentito sul modulo
aziendale"* è utile. Una che dice *"hai acconsentito da qualche parte nel
catering"* non è una risposta.

### Il soft opt-in si calcola, non si memorizza

È il punto sottile, e la scelta che difenderei con più convinzione.

L'art. 130 c.4 fornisce una base giuridica **derivata**: puoi scrivere al tuo
cliente per beni analoghi, perché ha acquistato. Nessuno ha deciso nulla. Perciò
non esiste, deliberatamente, un valore `soft_opt_in`.

Memorizzarlo come consenso farebbe due danni insieme: rappresenterebbe male la
base giuridica (un acquisto non è un consenso) e corromperebbe la tracciabilità
(dichiareresti una decisione mai avvenuta). Si calcola al momento della verifica
di raggiungibilità, e un vincolo CHECK sul database impedisce che venga scritto —
così la regola non può perdersi in mano a chi non ha letto questo documento.

**Principio generale: memorizza gli atti, deriva i permessi.** Un permesso
memorizzato come fatto è un fatto che un giorno non saprai giustificare.

### Chi ha deciso — esattamente un soggetto, mai due

```ts
type ConsentSubject =
  | { kind: 'customer'; id: string }
  | { kind: 'azienda';  id: string }
  | { kind: 'contact';  id: string }
```

**Un'azienda non è un tipo di persona.** L'entità aziendale vive in una tabella
propria, così che cancellare un cliente ex art. 17 non porti via con sé
un'impresa attiva — e quindi il suo consenso non può pendere da un id cliente. Un
contatto anonimo non ha né l'uno né l'altro: il soggetto è la riga stessa.

Sembra sovra-modellazione finché non arriva la prima richiesta di cancellazione da
qualcuno che è anche il referente amministrativo di un'azienda.

### Versiona il testo

Ogni record memorizza la **versione del testo mostrato**. Una modifica successiva
alla copy non deve poter riscrivere ciò a cui qualcuno ha acconsentito. Sono tre
caratteri di schema, e sono la differenza fra una prova e un'affermazione.

---

## La trappola: due archivi di consenso

Ci siamo ritrovati con il consenso registrato in due posti — un registro rivolto
al cliente e un percorso separato di preferenze marketing — ed **entrambi vanno
consultati** prima di ogni invio.

Non era un progetto, era sedimentazione, ed è la forma più pericolosa in questo
ambito. Controllare un archivio e non l'altro produce un invio a chi ha rifiutato
— esattamente il fallimento che il sistema esiste per impedire — e fallisce **in
silenzio**, perché l'invio riesce.

Se da questo documento porti via una sola lezione operativa: **deve esistere una
sola funzione che risponde "posso contattare questa persona su questo canale", e
nessun percorso di invio deve poter evitare di chiamarla.** Non una convenzione:
un punto di strozzatura.

---

## Perché è un vantaggio, non un costo

Ogni concorrente che vende a ristoranti italiani ha la stessa superficie
normativa, e quasi nessuno l'ha letta. Chi l'ha letta, fatica a spiegarla al
commercialista del cliente.

Poter dire *"ecco l'articolo, ecco il provvedimento del Garante, ecco cosa
memorizza il nostro sistema e perché"* non è un costo di conformità. In questo
mercato è la conversazione di vendita: il commercialista del titolare è uno
stakeholder reale dell'acquisto, e la domanda la fa.

Ed è il differenziatore più economico che esista, perché il lavoro è leggere.

---

## Cosa non c'è

- **Nessun repository.** L'artefatto interessante è lo schema e il ragionamento,
  entrambi citati sopra.
- **È una sola giurisdizione.** La struttura canale/meccanismo/soggetto è
  portabile; le conclusioni giuridiche no. Non portare la risposta italiana in
  Germania.
- **Le fonti sono citate, non riprodotte.** Artt. 121 c.1-bis lett. f) e 130 del
  Codice delle comunicazioni elettroniche, Garante provv. 20/9/2012 (doc. web
  2094932), *Aesir s.r.l.* 17/4/2026, *Mevaluate* §8, EDPB Opinion 5/2019 ¶40.
  Andate a leggerle: è per questo che sono elencate.
