# ECO-00 contract and roadmap freeze

Date: 2026-09-25  
Status: ADOPTED

## Purpose

ECO-00 freezes the minimum cross-repository coordination layer for the four independently versioned my-dev-kit ecosystem programs. It is documentation and interface governance, not a runtime release and not a compatibility certification.

The coordination layer references native evidence. It does not replace native artifact schemas, move responsibility ownership, or create a fifth runtime application.

## Frozen baseline

| Program | Branch | Commit | Published package |
| --- | --- | --- | --- |
| my-dev-kit | main | `675b6373144b962efe1c6d870cec238181d07e14` | `1.12.4` |
| my-dev-kit-orchestrator | main | `a658fb89520ce6987fbd96dee0c5719c50c7659b` | `1.5.0` |
| my-dev-kit-lab | main | `d642e8ac0d1f14436b216c898b4f4bca6e30fb06` | `0.6.0` |
| my-frontend-observer | master | `251cfcd7c6dde6d0d8a423b89dd5791ff31329db` | `0.10.0` |

This tuple is inspection provenance and a supported planning baseline. It is not a tested, certified, or active compatibility bundle.

## Adopted version decisions

- Kit keeps 1.13.0 and 1.14.0 unchanged; 1.15.0 is KIT-API-01 and 1.16.0 is KIT-OPS-01.
- Orchestrator 1.5.0 is published Semantic Continuity; 1.6.0 / ORC-TELEMETRY is published as of 2026-09-26; 1.7.0 remains ORC-EVIDENCE-01.
- Lab 0.6.0-0.9.2 keep their existing meanings. LAB-EVIDENCE-01 is assigned to the first unreserved minor, 0.10.0. Later assurance reservations are 0.11.0-0.17.0. No existing Lab feature is moved.
- Observer 0.11.0-0.14.0 are adopted as diagnostics, controlled state, performance evidence, and bounded browser/viewport matrix milestones, subject to Observer's Project Description and Project Milestones authority.

## Shared reference contracts

The canonical machine-readable registry is `contracts/ecosystem/contract-registry.json`. The v1 schemas are deliberately small:

- `SubjectIdentityV1`: names an identity while retaining the native authority and namespace.
- `EnvironmentIdentityV1`: records explicit environment dimensions without pretending every producer observes the same dimensions.
- `NativeArtifactReferenceV1`: references an existing producer-owned artifact plus optional integrity evidence.
- `EvidenceEnvelopeV1`: associates a subject and capability with a native artifact and explicit freshness.
- `EvidenceRequirementV1`: states a capability requirement and accepted native artifact kinds; it may reference an Orchestrator responsibility but does not redefine RSP.
- `CompatibilityBundleV1`: records an exact package/contract tuple and its compatibility state.

The schemas are a reference layer. Native producers remain authoritative for the content and semantics of their artifacts.

## Native ownership preserved

- Orchestrator owns `RSP-NNN`, workflow/run/stage identity, lifecycle, RunIntegrityGate, judge integrity, and final eligibility.
- Kit owns static repository identities, graph/index artifacts, architecture/classification facts, and bounded source retrieval.
- Observer owns runtime/reference identities, browser evidence, visual/reference contracts, and runtime/static correlation claims it can support.
- Lab owns validation, audit, experiment, verification, metric, and certification evidence it produces.

A common envelope may point at those facts. It may not silently reinterpret them.

## Compatibility states

- **supported**: the contract/version combination is declared structurally supportable; no integration execution is implied.
- **tested**: the exact tuple passed named compatibility tests with evidence references.
- **certified**: the exact tuple passed the designated certification profile and records immutable evidence.
- **active**: a certified tuple has been explicitly selected for use. "Latest" never implies active.

Promotion is forward-only by explicit evidence. A bundle may be superseded, but historical tested/certified bundles remain records.

## Fixture rule

Positive fixtures must validate against their schema. Files named `*.invalid.json` are intentional negative fixtures and must fail for the documented reason. ECO-00 fixtures cover a native-artifact reference requirement and the rule that an active/certified bundle requires certification evidence.

## Dependency outcome

ORC-TELEMETRY is complete with published Orchestrator 1.6.0. The next cross-ecosystem consumer prerequisite is Orchestrator 1.7.0 / ORC-EVIDENCE-01. Kit 1.13.0 and Lab 0.6.1 remain independent valid local next milestones.

ECO-01 requires LAB-EVIDENCE-01 (Lab 0.10.0) and ORC-EVIDENCE-01 (Orchestrator 1.7.0) as exact candidates or releases. ORC-EVIDENCE-01 may be implemented against these frozen contracts before the Lab producer exists, but certification cannot occur until the producer and consumer tuple is tested together.

## Repository adoption/change ledger

- **my-dev-kit:** central roadmap changed from proposal to adopted ECO-00 baseline; shared registry/schemas/fixtures/milestone registry/baseline bundle added; local roadmap gained 1.15.0 and 1.16.0; 1.13.0/1.14.0/2.0.0 preserved.
- **my-dev-kit-orchestrator:** 1.6.0 is now current/published; 1.7.0 remains next as ORC-EVIDENCE-01; native RSP-NNN, telemetry, and integrity ownership remain Orchestrator-owned.
- **my-dev-kit-lab:** 0.6.0-0.9.2 preserved without relocation; 0.10.0-0.17.0 added as new assurance reservations; exact next local action remains 0.6.1.
- **my-frontend-observer:** durable intent and milestone authority extended first, then roadmap/current-state updated for 0.11.0-0.14.0; 0.10.0 remains current.

No package, dependency, tag, release, or publication state is changed by this ledger.

## Non-goals

ECO-00 does not:

- bump any package;
- add runtime dependencies;
- change a native artifact schema;
- certify the frozen baseline;
- execute target applications;
- create a universal evidence payload;
- make every tool depend on every other tool;
- authorize publication.

See `../ECOSYSTEM_COORDINATED_ROADMAP.md` for the full dependency program and `milestones.json` for the machine-readable reservations.
