export type PrecisionTier = "address" | "locality" | "district" | "region" | "country" | "unknown";
export type DatePrecision = "day" | "month" | "year" | "decade" | "range" | "inferred";
export interface ScoreWeights { readonly proximity: number; readonly temporal: number; readonly precision: number; readonly confidence: number; readonly unrelatedness: number; readonly independence: number }
export interface ScoringConfig {
  readonly weights: ScoreWeights;
  readonly precision_tier_weights: Readonly<Record<PrecisionTier, number>>;
  readonly temporal_precision_weights: Readonly<Record<DatePrecision, number>>;
  readonly temporal_overlap_full_days: number;
  readonly temporal_min_overlap_factor: number;
  readonly independence_same_record: number;
  readonly independence_distinct_record: number;
}
export interface ScoreInput {
  readonly distanceKm: number; readonly combinedRadiusKm: number; readonly proximityMultiplier: number;
  readonly overlapDays: number; readonly aDatePrecision: DatePrecision; readonly bDatePrecision: DatePrecision;
  readonly aTier: PrecisionTier; readonly bTier: PrecisionTier;
  readonly aPresenceConfidence: number; readonly bPresenceConfidence: number;
  readonly aGeocodeConfidence: number; readonly bGeocodeConfidence: number;
  readonly bloodDegree: number | null; readonly branchCutoff: number; readonly sameSourceRecord: boolean;
}
export interface ScoreComponents { readonly proximity: number; readonly temporal: number; readonly precision: number; readonly confidence: number; readonly unrelatedness: number; readonly independence: number; readonly score: number }
const clamp = (value: number): number => Math.max(0, Math.min(1, value));
export function proximityScore(distanceKm: number, combinedRadiusKm: number, multiplier: number): number {
  const limit = combinedRadiusKm * multiplier;
  if (limit <= 0 || distanceKm >= limit) return distanceKm === 0 && limit === 0 ? 1 : 0;
  const ratio = clamp(distanceKm / limit);
  return (1 + Math.cos(Math.PI * ratio)) / 2;
}
export function precisionScore(a: PrecisionTier, b: PrecisionTier, weights: Readonly<Record<PrecisionTier, number>>): number { return clamp(Math.min(weights[a], weights[b])); }
export function temporalScore(overlapDays: number, a: DatePrecision, b: DatePrecision, config: ScoringConfig): number {
  if (overlapDays <= 0 || config.temporal_overlap_full_days <= 0) return 0;
  const precision = Math.sqrt(clamp(config.temporal_precision_weights[a]) * clamp(config.temporal_precision_weights[b]));
  const overlap = clamp(overlapDays / config.temporal_overlap_full_days);
  const factor = config.temporal_min_overlap_factor + (1 - config.temporal_min_overlap_factor) * overlap;
  return clamp(precision * factor);
}
export function confidenceScore(aPresence: number, bPresence: number, aGeocode: number, bGeocode: number): number { return clamp(Math.sqrt(clamp(aPresence) * clamp(bPresence)) * Math.sqrt(clamp(aGeocode) * clamp(bGeocode))); }
export function unrelatednessScore(bloodDegree: number | null, branchCutoff: number): number { return bloodDegree === null ? 1 : branchCutoff <= 0 ? 0 : clamp(bloodDegree / branchCutoff); }
export function independenceScore(sameSourceRecord: boolean, config: ScoringConfig): number { return clamp(sameSourceRecord ? config.independence_same_record : config.independence_distinct_record); }
export function scoreCandidate(input: ScoreInput, config: ScoringConfig): ScoreComponents {
  const proximity = proximityScore(input.distanceKm, input.combinedRadiusKm, input.proximityMultiplier);
  const temporal = temporalScore(input.overlapDays, input.aDatePrecision, input.bDatePrecision, config);
  const precision = precisionScore(input.aTier, input.bTier, config.precision_tier_weights);
  const confidence = confidenceScore(input.aPresenceConfidence, input.bPresenceConfidence, input.aGeocodeConfidence, input.bGeocodeConfidence);
  const unrelatedness = unrelatednessScore(input.bloodDegree, input.branchCutoff);
  const independence = independenceScore(input.sameSourceRecord, config);
  const score = clamp(config.weights.proximity * proximity * config.weights.temporal * temporal * config.weights.precision * precision * config.weights.confidence * confidence * config.weights.unrelatedness * unrelatedness * config.weights.independence * independence);
  return { proximity, temporal, precision, confidence, unrelatedness, independence, score };
}
export interface SuppressionInput { readonly sameIndividual: boolean; readonly sameHousehold: boolean; readonly directSpouse: boolean; readonly bloodDegree: number | null; readonly graphDegree: number | null; readonly sharedMrcaWithinCutoff: boolean; readonly sameBranch: boolean; readonly branchDegree: number | null; readonly coarsePlace: boolean; readonly lowConfidence: boolean; readonly living: boolean }
export interface SuppressionConfig { readonly closeKinCutoff: number; readonly inLawCutoff: number; readonly branchCutoff: number; readonly includeLiving: boolean }
export type SuppressionReason = "same_individual" | "same_household" | "spouse" | "close_kin" | "in_law" | "recent_mrca" | "same_branch" | "coarse_place" | "low_conf" | "living";
export function firstSuppression(input: SuppressionInput, config: SuppressionConfig): SuppressionReason | null {
  if (input.sameIndividual) return "same_individual";
  if (input.sameHousehold) return "same_household";
  if (input.directSpouse) return "spouse";
  if (input.bloodDegree !== null && input.bloodDegree <= config.closeKinCutoff) return "close_kin";
  if (input.graphDegree !== null && input.graphDegree <= config.inLawCutoff) return "in_law";
  if (input.sharedMrcaWithinCutoff) return "recent_mrca";
  if (input.sameBranch && input.branchDegree !== null && input.branchDegree < config.branchCutoff) return "same_branch";
  if (input.coarsePlace) return "coarse_place";
  if (input.lowConfidence) return "low_conf";
  if (input.living && !config.includeLiving) return "living";
  return null;
}
