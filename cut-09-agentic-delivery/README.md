# How one person ships a multi-tenant SaaS

**An agentic delivery harness: a milestone in, one reviewable branch out.**

A write-up. Read it as a description of a working process, not a product pitch —
there is nothing here to buy.

> **Positioning note, stated once.** Some readers will conclude "AI wrote his
> code" and discount everything else. That reading is wrong — the review gate
> rejects more than it approves, and every line still lands through a human-opened
> PR — but the reaction is real, so this cut sits below the fold. If you came here
> from the runnable repos, they are the work; this is how the work gets made.

---

## The problem

One person, a production multi-tenant SaaS with paying restaurants on their own
domains, and a backlog that is mostly *small, well-specified, independent*
changes. That last property is the whole opportunity: a ticket that says "add the
per-kg flag to the admin form" needs judgement to *specify* and very little to
*execute*.

The bottleneck is not typing. It is that fifteen such tickets require fifteen
context switches, and a solo maintainer's context is the scarce resource.

---

## The shape

```
  milestone (= one feature)
        │
        ├── issue → sandbox → implementer → PATH GUARD → security gate → branch
        ├── issue → sandbox → implementer → PATH GUARD → security gate → branch
        └── issue → sandbox → implementer → PATH GUARD → security gate → branch
                                                              │
                                       consolidated into ONE local branch
                                                              │
                                          a human tests it, opens ONE PR
```

**One feature is one milestone; the milestone *is* the batch.** Every open issue
in it runs, except those explicitly held or blocked by an open dependency. There
is no separate queue to maintain — the tracker is the input.

Each issue gets its own Docker sandbox and its own git worktree, so failures are
isolated and concurrency is bounded by the machine rather than by a model's
opinion of how many things to do at once.

---

## The four design decisions that matter

### 1. Only two roles are agents

The implementer writes code. The reviewer gates it. **Everything else is
deterministic script.**

Reading the milestone, classifying tickets, resolving dependencies, consolidating
branches, opening the PR — those are mechanical API calls. Making them agentic
would add cost, latency, and a failure mode (an agent that misreads the batch)
in exchange for nothing.

**The general rule: use a model where judgement is required and a script
everywhere else.** Most disappointing agent systems get this backwards, and the
symptom is a model being asked to do arithmetic.

### 2. The reviewer is a gate, not a commenter

The security reviewer emits `APPROVE` or `REJECT`. A rejection feeds its reasons
back into the next implementation round, up to a bounded number of rounds, after
which the work **parks** rather than merging.

A reviewer whose output is advice is decoration — someone has to read the advice
and act on it, and that someone is the bottleneck you were trying to remove. A
gate that can actually stop the pipeline is the only kind that changes anything.

**Model asymmetry is deliberate:** a cheaper, faster model implements; a stronger
one reviews. Reviewing is the harder cognitive task and the one where a mistake is
expensive, so that is where the capability goes. Most people spend it the other
way round.

### 3. The path guard is deterministic and runs before the reviewer

Some surfaces do not get to be decided by a model. Authentication, tenant
isolation and RLS, cryptography, role grants, payments, database migrations.

So there is a **host-side git diff check**, not a prompt: if the diff touches a
guarded path, or the issue carries the human-required label, the work stops and is
held for a human — regardless of what any model thinks about it.

This is the piece I would keep if I had to throw the rest away. **A guardrail
implemented as an instruction is a request; implemented as a diff check it is a
constraint.** The two are not close, and only one of them survives a model that is
confidently wrong.

### 4. A human opens the pull request

Every branch is consolidated into one local branch that a human tests, on real
infrastructure, before a single PR is opened. Nothing merges itself. Nothing
reaches the default branch without a person having run it.

---

## What actually goes wrong

The honest part. Four failure modes, all found in production use:

**The harness merges empty branches.** An agent that idles out still gets
consolidated, contributing zero commits. The pipeline reports success and the
ticket is silently not done. You need a content check — did this branch actually
contribute anything — because "the job finished" and "the work happened" are
different facts.

**"Contributed nothing" is usually wrong.** The naive version of that same check
fires constantly for dependency-chained issues that *were* built, because
consolidation rewrites commits and ancestry, patch-equivalence and
content-equivalence all read "diverges". Proving a branch is safe to delete needs
a real ladder of checks, not one.

**The reviewer can be reviewing a dead architecture.** Ours spent months enforcing
a schema-per-tenant model and an auth library that the platform had *retired* —
because the standards document it reads was written before the re-platform and
nobody updated it. A review gate is only as good as the document it grades
against, and that document rots silently while everything stays green.

**"Held for a human" did not mean "excluded".** The path guard skips *review* but
does not block *consolidation*, so held work still landed in the PR. The label
said one thing and the pipeline did another. Worth knowing that a guard which
diverts a step is not the same as a guard which removes work from the batch.

Each of those produced green output while being wrong, which is the recurring
theme across everything in this portfolio.

---

## What it is good for, and what it is not

**Good:** small, well-specified, independent tickets. Wiring a flag through to its
read site. Adding a field end to end. Porting a pattern to a fifth surface. Test
coverage for a module that has none.

**Bad:** anything requiring a decision. The harness executes a milestone; it does
not plan one. Planning happens separately and slowly, one decision at a time, with
a human — which is the actual reason the execution can be fast.

**Never:** the guarded surfaces. Not because a model could not write the code, but
because the cost of being wrong about tenant isolation is unbounded and the cost
of writing it myself is an afternoon.

---

## Would I recommend it

For a solo maintainer with a well-specified backlog: yes, with the guard rails
above, and only after the planning discipline exists. **The harness amplifies
whatever your specification quality already is.** Given vague tickets it produces
vague code faster, and the review gate cannot save you because the gate is also
reading the vague ticket.

For a team: probably not as described. Most of what this buys back is context
switching, and a team has other people to switch to.

The measurable claim I will make is narrow: **a week run this way beat the manual
week before it on every process metric I tracked** — cycle time, tickets closed,
review rounds. The comparison is one week against one week, by one person, on one
codebase, which is an anecdote and not a study. I am not going to dress it up as
more than that.

---

## What is not here

- **No repo.** The harness is coupled to one project's conventions, labels and
  guarded paths. Published as-is it would be a config file that only works for me.
- **No cost figures.** I have not tracked spend per milestone carefully enough to
  quote a number, and an invented one would be worse than none.
- **No claim that this generalises.** It works for a solo maintainer on a
  well-specified backlog with a hard guard on the dangerous surfaces. That is the
  claim; anything wider is not evidenced here.
