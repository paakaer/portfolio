# carta

**Paper menus into structured data, with a human in the loop.**

A photograph of a laminated trattoria card becomes 40 priced, sectioned,
reviewable dishes. Nothing reaches a live storefront until a person has agreed to
it.

Extracted from a production pipeline that ingests real restaurants' menus. MIT.

```bash
bun install
bun run demo:ingest     # a flyer in, a reviewable draft out
bun run demo:review     # the queue — and a publish that refuses
bun run demo:review --fix
```

**Runs offline with no API key and no spend.** An extraction repo that needs a
funded account before it shows you anything is a repo nobody evaluates, so the
whole pipeline runs against a deterministic provider by default. Set
`ANTHROPIC_API_KEY` and the same pipeline runs against Claude instead — the code
path is identical, because the vendor sits behind a port.

---

## Why this is not a wrapper

The interesting problems in document extraction are not the API call. They are:

1. **Escalation** — when to spend more on a harder model, and when spending more
   is hiding a bug (§ *The fallback trap*).
2. **The review queue** — extraction is probabilistic and a wrong price is a
   wrong charge to a real customer (§ *The model may not publish*).
3. **Keeping the model's job small** — everything deterministic pulled *out* of
   the prompt (§ *The pipeline*).

The API call is thirty lines. The other three are the product.

---

## The pipeline

```
  source (photo | PDF | text)
        │
        ▼
  1. EXTRACT     ← the ONLY probabilistic step, isolated behind a port
        │
        ▼
  2. NORMALIZE   ← pure. ALL-CAPS → title case, "pom." → "pomodoro"
        │
        ▼
  3. FLAG        ← pure. finds the rows a human must look at
        │
        ▼
  4. DRAFT       ← a proposal. never a publish.
```

Steps 2–4 are **pure functions over step 1's output**. That is not tidiness, it
is the design:

- **It keeps the prompt small.** "Transcribe exactly what is printed" and "also
  tidy up the capitalisation" are competing instructions. Asking for both gets
  you a model that feels licensed to edit, and a model that feels licensed to
  edit will improve a price.
- **It makes confidence real.** Asking a model to score its own confidence
  returns a number, not evidence. The flags in step 3 are deterministic
  assertions about the data — a price outside a plausible window, a name that
  appears twice — and they are checkable.
- **It makes everything testable without a key.** 37 tests, no API calls.

---

## The fallback trap

**The bug this repo exists to document.** The first version of this router
escalated on *any* failure. That seemed obviously right.

Then a credential was misconfigured on the primary provider. The router caught
the auth error, escalated, and the fallback returned output. Everything looked
healthy — no error, no alert, no failed job. The pipeline just quietly started
producing worse results, and nobody found out for weeks.

**A fallback chain that swallows configuration errors is not a resilience
feature. It is a correctness bug wearing a resilience costume.**

The fix is to split failures into two kinds:

| Kind | Codes | Router behaviour | Why |
|---|---|---|---|
| **Quality** | `BAD_OUTPUT`, `REQUEST_FAILED` | **Escalate** | This tier tried and could not do it. A better model is the right answer. |
| **Config** | `NOT_CONFIGURED`, `AUTH_FAILED` | **Abort** | This tier was never going to work. Escalating buys a more expensive answer *and* hides a broken deployment. |

```ts
if (e.fatal) throw e     // do not escalate past a broken deployment
```

The regression test is `tests/router.test.ts`:

```
✓ AUTH_FAILED does NOT escalate — a broken deployment must not be hidden
```

It asserts the *second provider is never called*. That assertion is the whole
lesson, and it is the one line that would have saved those weeks.

**Two corollaries** that fall out of the same principle:

- **A provider with no key is not built at all.** The registry omits it, so it
  never enters the ladder. Present-and-always-failing is what produces a chain
  that silently degrades; absent is honest.
- **An empty extraction is a failure.** A provider returning zero dishes has
  failed in the *shape* of success. Letting it win publishes an empty menu over a
  restaurant's real one.

---

## The model may not publish

It may only propose. Every dish lands in a review queue carrying deterministic
flags:

| Flag | Blocking | What it catches |
|---|---|---|
| `MISSING_PRICE` | yes | No price read. Cannot be sold. |
| `SUSPICIOUS_PRICE` | yes | Outside a plausible window — the decimal-comma misread, where `11,00` becomes €1,100. |
| `PER_KG_AMBIGUOUS` | yes | Priced by weight but marked per portion. **A silent 10x overcharge** that looks completely normal in the data. |
| `DUPLICATE_NAME` | yes | One printed line read as two rows. |
| `NO_SECTION` | no | Lands under "Altro". Still sells. |

`canPublish()` refuses while any blocking flag is unresolved. There is
deliberately **no force flag and no confidence threshold for auto-publish.**

That feature gets asked for every time, and it is the one that ends the product.
Its failure mode is a plausible wrong price on a live menu, discovered when a
customer is charged. And the confidence score it would key on is produced by the
same class of system that made the error — which is not independent evidence.

The reviewer gets three verbs, not one: **correct**, **confirm**, **delete**. A
queue that only lets you approve is a rubber stamp, and a reviewer who cannot
disagree stops reading.

**Flags are relational**, which is subtle and easy to get wrong: deleting one
copy of a duplicate must clear the flag on the *other* copy. Re-flagging only the
edited row leaves a phantom block that no edit can clear. `tests/review.test.ts`
covers both directions.

---

## The prompt has one rule

```
REGOLA FONDAMENTALE: non inventare e non dedurre nulla.
```

A model that knows what goes in an amatriciana will write you an ingredient list
the restaurant never printed — and it will be a *good* list: plausible,
well-formed, indistinguishable downstream from one that was actually on the page.

**That is worse than a blank field**, because a blank field is visibly missing
and an invented one is not. So the instruction is repeated per-field in the tool
schema, and output is forced through a tool call rather than parsed from prose.

---

## Running against Claude

```bash
export ANTHROPIC_API_KEY=sk-ant-...
bun run demo:ingest
```

The ladder is cheapest-first, and escalation is driven by **output**, never by a
guess made in advance:

| Tier | Model | Role |
|---|---|---|
| 1 | `claude-haiku-4-5` | A clean printed card. Handles most of the backlog. |
| 2 | `claude-opus-5` | The photo taken at an angle in a dark room. Adaptive thinking on. |

Override with `CARTA_MODEL_CHEAP` / `CARTA_MODEL_RICH`. Both live in
`src/providers.ts`, the one file that names a vendor — the domain, the router,
the review queue and the CLI never import the SDK.

---

## What this repo is not

- **The Claude path has not been run against the live API here.** Request
  shaping and response parsing are covered by unit tests with an injected
  `create` (nine of them: forced tool choice, cents rounding, malformed payload
  coercion, refusal handling, block ordering, re-prompt contents). Whether the
  live model reads a real photograph *well* is an eval question, not a unit-test
  question — and this repo has no eval.
- **The fixture provider is not an extractor.** It parses one known text layout
  with line rules, to stand in for a model offline. It reproduces the *shape* of
  model output including its three most common real mistakes — a line read
  twice, a missing price, a missed "al kg" — so the review queue has something
  real to catch. Real input is a photograph, which is why the real path is a
  vision model.
- **No accuracy numbers.** I have no held-out labelled set, so any figure here
  would be invented. Building that set is the honest next step, and it is more
  work than everything in this repo.
- **Italian-specific normalisation.** The small-word list and the abbreviation
  dictionary are Italian. The structure ports; the dictionary does not.

## Licence

MIT.
