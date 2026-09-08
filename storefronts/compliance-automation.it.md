# Pressione di conformità dai tuoi clienti

I tuoi clienti hanno cominciato a chiedere cosa conservi, chi può accedervi e come
lo dimostreresti. NIS2, ISO 27001, GDPR, AI Act — arriva come questionario e finisce
sul tavolo di chi manda avanti i sistemi.

**Cosa non è:** una pratica di certificazione — nessuna gap analysis ISO 27001,
nessuna valutazione NIS2, nessun lavoro di conformità all'AI Act. Qui c'è un sistema
che produce le prove come sottoprodotto del funzionamento: la parte costosa da
aggiungere dopo.

## Da qui

**[Cut 8 — Consenso e diritto italiano](../cut-08-italian-compliance/README.it.md)**
L'email commerciale a freddo verso un'azienda è illecita in Italia senza consenso
preventivo: il legittimo interesse non basta. Articolo e provvedimenti del Garante
sono citati, così il tuo legale ha qualcosa di preciso. Il modello: consenso per
canale, un meccanismo che nomina un atto su una schermata precisa, il testo
versionato, un soft opt-in calcolato all'invio anziché memorizzato.

**[Cut 1 — Controllo degli accessi dimostrabile](../cut-01-multitenant/)** ·
eseguibile. Il confine sta in Postgres, non nel codice. Un test enumera ogni tabella
di tenant e fa fallire la CI su una senza policy: "chi può leggere questo dato" è il
risultato di un test, non un'affermazione.

**[Cut 7 — Dove stanno le prove](../cut-07-observability/)** — i record di audit
vanno nel database, non presso un fornitore di telemetria: sopravvivono al piano
gratuito e al cambio di fornitore.

## Poi

**[Cut 6 — Abilitazioni](../cut-06-entitlements/)** · eseguibile — ogni interruttore
dichiara il file che lo legge; la fatturazione è solo registrazione.
**[Cut 4 — Infrastruttura](../cut-04-selfhosted/)** · eseguibile — gli otto modi in
cui si è rotta, e la prova di ripristino.

## Il resto

[Pagamenti](../cut-02-payments/) ·
[WhatsApp](../cut-03-whatsapp/README.it.md) ·
[Estrazione AI](../cut-05-menu-ingestion/) ·
[Consegna](../cut-09-agentic-delivery/)

La parte ripetitiva — raccogliere prove, spostare record, rincorrere ciò che scade —
la automatizzo con n8n. È il modello qui sopra a decidere se valga qualcosa.

## Un primo incarico

Una superficie di consenso o di controllo accessi modellata e collegata a un unico
punto obbligato per ogni invio; oppure un audit trail reso interrogabile. Da due a
sei settimane
<!-- TODO: Albert — confirm duration -->, in consegna: uno schema, un test che
fallisce quando la regola è violata, una nota che cita le fonti.
