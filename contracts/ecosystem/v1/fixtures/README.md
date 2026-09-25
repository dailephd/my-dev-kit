# ECO-00 contract fixtures

- `evidence-envelope.valid.json` is expected to validate.
- `evidence-envelope.missing-native-artifact.invalid.json` is expected to fail because `nativeArtifact` is required.
- `compatibility-bundle.valid.json` is expected to validate as a `supported` bundle.
- `compatibility-bundle.active-without-certification.invalid.json` is expected to fail because `active` requires non-empty `testEvidenceRefs` and `certificationProfile`.

These are reference-layer fixtures and do not claim that the future Lab verification artifact already exists.
