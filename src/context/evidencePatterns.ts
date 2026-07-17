/**
 * v1.10.1 Batch 3/4: shared naming-convention patterns used to classify contract-like
 * evidence into validators, constants, errors, and (bounded, static) side-effect
 * evidence. Single owner reused by `evidenceGroups.ts` (Batch 3) and
 * `responsibilityMapping.ts` (Batch 4) so the two never drift.
 */
export const VALIDATOR_PATTERN = /valid/i
export const CONSTANT_PATTERN = /constant/i
export const ERROR_PATTERN = /error/i
export const SCHEMA_PATTERN = /schema/i
export const SIDE_EFFECT_PATTERN = /(fs|filesystem|process|exec|spawn|network|http|client|writer|persist|cleanup)/i
