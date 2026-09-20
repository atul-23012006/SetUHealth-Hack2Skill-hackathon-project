# Governance

**Status: intention and roadmap, not a description of anything that exists
yet.** As of this writing, SetuHealth has one repository and the
contributors who show up in its commit history — no foundation, no
steering committee, no legal entity. This page states what we intend to
build toward, and is written to be checked against reality later, not
mistaken for it now.

## Why this matters for a project like this

The reason DHIS2 is trusted by health ministries in more than 80 countries
is not that it has good code — plenty of software does. It's that DHIS2 is
not owned by a single vendor with a commercial incentive to lock a ministry
in. It is developed at the University of Oslo's HISP Centre, together with
a global network of HISP (Health Information Systems Programme) groups —
universities and research institutions across dozens of countries — and
released under a permissive license. A government adopting it isn't
betting its national health data infrastructure on one company's roadmap
or survival.

National PHC/facility resource data is exactly the kind of thing a state or
national health ministry should be wary of putting behind a single
vendor's platform. If SetuHealth is ever going to be something a health
ministry outside of a hackathon demo would actually run, it needs the same
property: no single company should be able to unilaterally change the
terms, hold data hostage, or shut it down. That's the entire reason
`LICENSE` is AGPL-3.0 rather than a permissive or proprietary license —
see the "Why AGPL" section below.

## What we intend to build toward

1. **A neutral steward, not a company.** The long-term intent is for
   SetuHealth's governance to move to a nonprofit foundation or an
   existing academic/public-health host institution — the DHIS2/HISP model
   — once there are multiple independent contributing organizations (see
   `CONTRIBUTING.md`'s node-onboarding process for what "independent
   contributing organization" concretely means here: a state health
   department or partner nation running its own node adapter). Today,
   with a single contributor base, this would be a claim with nothing
   behind it, so it isn't made.
2. **Decisions made in the open.** Technical decisions that affect the
   node-summary contract (`CONTRIBUTING.md`) or the privacy boundary
   (Guardrail 3 in `SETUHEALTH_NEXT_LEVEL_PLAN.md`) should be proposed and
   discussed as GitHub issues/PRs before merging, not decided privately —
   this is achievable immediately and doesn't wait for a foundation to
   exist.
3. **No unilateral relicensing.** AGPL-3.0 (see `LICENSE`) means no future
   maintainer can quietly relicense the project into a closed, vendor-locked
   product out from under the states or countries depending on it, without
   every contributor's agreement.
4. **A path for a contributing state/nation to have a real voice**,
   proportional to what they actually contribute (running a node,
   maintaining a resource-type adapter, funding development) — modeled
   loosely on how HISP country groups earn technical influence over DHIS2
   by doing real implementation work, not by title. The specific mechanism
   (a technical steering committee? seats tied to node-operator status?)
   is deliberately left open here: it should be designed once there is
   more than one contributing organization to design it with, not
   pre-decided by whoever happens to hold the repository today.

## Why AGPL-3.0

Three real properties, not just "open source sounds trustworthy":

- **Network use counts as distribution.** Unlike the plain GPL, AGPL
  closes the "run it as a hosted service and never share changes"
  loophole (AGPL §13) — relevant because SetuHealth's primary deployment
  shape is a hosted service a health ministry's IT department accesses
  over a network, not shrink-wrapped software they install.
- **Copyleft, so improvements flow back.** A state or vendor that extends
  SetuHealth for their own deployment must make those changes available
  under the same terms if they let anyone use the modified version over a
  network — the same mechanism that keeps DHIS2 and OpenLMIS improvements
  shared across their respective networks of adopters instead of forking
  into silos.
- **No single party can extract and close it.** Nobody — including the
  current maintainers — can take this codebase private and relicense it
  restrictively later, because doing so requires every copyright holder's
  consent.

## What this page is not

It is not a claim that a foundation exists, that a steering committee has
been formed, or that any government or institution has committed to
anything described here. Anyone citing this document as evidence of an
existing governance structure is citing it incorrectly — check
`CONTRIBUTING.md`'s commit history and this repository's actual contributor
list for what's real today.
