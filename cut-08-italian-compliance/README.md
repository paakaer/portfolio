# Consent, marketing, and Italian law

**What an Italian food business can lawfully send, to whom, and how you model it
so the answer survives an audit.**

A write-up. *Versione italiana: [`README.it.md`](README.it.md).*

> **Not legal advice.** This is engineering documentation of decisions taken with
> primary sources in hand, and it names them so you can check the reasoning
> yourself. Verify with a lawyer before acting on it — the sources are cited so
> you can hand your lawyer something specific rather than a question.

---

## The claim that surprises people

**Cold commercial email to a business is unlawful in Italy without prior consent,
and GDPR legitimate interest cannot substitute for it.**

Most English-language outbound playbooks say the opposite: B2B email is fine under
legitimate interest, just offer an opt-out. In Italy that has been wrong since
**1 June 2012**, and repeating it is quoting something fourteen years expired.

### Why almost everyone gets this wrong

Italy exercised its ePrivacy Art. 13(5) discretion **inside a definition**, not
where you would look for it.

- Art. 130 c.1/c.2 gates promotional email on the consent of the *contraente o
  utente* — the subscriber or user.
- **Art. 121 c.1-bis lett. f)** then defines *contraente* to **include the
  *persona giuridica*** — the legal person.

So the consent requirement reaches companies, and it does so via a definitions
article that a reader of Art. 130 alone never opens. The Garante confirmed Title X
capo 1 reaches legal persons (provv. 20/9/2012, doc. web 2094932), and its own
wording is that before that date legal persons were *"liberamente contattabili"* —
which is precisely the folklore's origin.

**The legitimate-interest escape is closed**, not merely doubtful: EDPB Opinion
5/2019 ¶40, and the Garante's *Aesir s.r.l.* decision (17/4/2026) against a
company that scraped LinkedIn Sales Navigator and Snov.io and pleaded Art. 6(1)(f)
— *"unicamente sul consenso"*.

**What remains lawful:** cold paper post and operator-dialled telephone, outside
Art. 130 on a legitimate-interest basis, subject to a Registro Pubblico delle
Opposizioni check.

### What it means for a product

You cannot ship an email-based cold-outreach feature for the Italian market. Not
with an opt-out, not with a "we found you on LinkedIn" line, not for B2B.

We found this while planning an outreach feature, and the finding **redrew the
whole plan** from cold outreach to consent-first. That is the honest cost of
getting it right: a feature we had scoped stopped existing.

It also exposed a **live defect in something already shipped** — a segment built
on people who had requested a catering quote. The Art. 130 c.4 soft opt-in applies
*"nel contesto della vendita"*, and a quote request is not a sale. The Garante has
expressly refused an opt-out as a cure for an absent basis (*Mevaluate* §8), so
the fix was not "add unsubscribe" — it was to stop using the segment.

---

## The model that survives the audit

The regulatory question is never "did they consent". It is **"prove what you asked,
when, on which screen, and in which words."** That shapes the schema more than any
feature does.

### Consent is per channel, not per person

```ts
type ConsentChannel = 'email' | 'whatsapp'
```

Independent, because they are governed independently. A person may want the
monthly email and not want WhatsApp, and **one boolean cannot say so.** Collapsing
two channels into one box is not recoverable later — you cannot un-merge a
decision that was never separately recorded.

### The mechanism names an act a person performed

Every stored mechanism is a specific thing someone did on a specific screen:
`checkout`, `preference_page`, `whatsapp_stop`, `in_person_capture`,
`catering_request`, `corporate_form`, `group_order`, `operator_import`.

They are separate values rather than one `catering` bucket for a concrete reason:
a subject-access response that says *"you agreed on the corporate form"* is
useful. One that says *"you agreed somewhere in catering"* is not an answer.

### The soft opt-in is computed, never stored

This is the subtle one, and it is the design decision I would defend hardest.

Art. 130 c.4 gives a **derived** lawful basis: you may email your own customer
about similar goods, because they bought something. Nobody made a decision. So
there is deliberately **no `soft_opt_in` mechanism value.**

Storing it as a grant would do two bad things at once: misrepresent the basis (a
purchase is not a consent), and corrupt the audit trail (you would be claiming a
decision that never happened). It is computed at reachability time, and a database
CHECK constraint enforces that it can never be written — so the rule cannot be
lost to a future caller who did not read this document.

**The general principle: store the acts, derive the permissions.** A permission
stored as a fact is a fact you will one day be unable to justify.

### Who decided — exactly one subject, never two

```ts
type ConsentSubject =
  | { kind: 'customer'; id: string }
  | { kind: 'azienda';  id: string }
  | { kind: 'contact';  id: string }
```

**A company is not a kind of person.** The corporate entity lives in its own
table, so that erasing a customer under Art. 17 cannot take a trading business
with it — and its consent therefore cannot hang off a customer id. An anonymous
contact has neither: the register row itself is the subject.

That separation looks like over-modelling until the first erasure request arrives
for someone who is also a company's billing contact.

### Version the wording

Every record stores the **version of the text that was shown**. A later copy edit
must not be able to rewrite what someone agreed to. This is three characters of
schema and it is the difference between evidence and an assertion.

---

## The trap: two consent stores

We ended up with consent recorded in two places — a customer-facing register and a
separate marketing-preferences path — and **both must be consulted** before any
send.

That was not a design; it was accretion, and it is the single most dangerous shape
in this area. Checking one store and not the other produces a send to someone who
refused, which is the exact failure the whole system exists to prevent, and it
fails **silently** because the send succeeds.

If you take one operational lesson from this document: **there must be exactly one
function that answers "may I contact this person on this channel", and every send
path must be unable to avoid calling it.** Not a convention — a chokepoint.

---

## Why this is a moat, not overhead

Every competitor selling to Italian restaurants has the same regulatory surface
and most of them have not read it. The ones who have, cannot easily explain it to
a customer's commercialista.

Being able to say *"here is the article, here is the Garante decision, here is
what our system stores and why"* is not a compliance cost. In this market it is
the sales conversation — a restaurant owner's accountant is a real stakeholder in
the purchase, and they ask.

It is also the cheapest possible differentiator, because the work is reading.

---

## What is not here

- **No repo.** The interesting artefact is the schema and the reasoning, both of
  which are quoted above.
- **This is one jurisdiction.** The channel/mechanism/subject structure ports;
  the legal conclusions do not. Do not carry the Italian answer to Germany.
- **Sources are cited, not reproduced.** Art. 121 c.1-bis lett. f) and Art. 130 of
  the Codice delle comunicazioni elettroniche, Garante provv. 20/9/2012 (doc. web
  2094932), *Aesir s.r.l.* 17/4/2026, *Mevaluate* §8, EDPB Opinion 5/2019 ¶40. Go
  and read them; that is the point of listing them.
