/**
 * Rule versions stamped onto every ScanReport. A report missing any current
 * version is stale and must be recomputed by rescanning. Pure constants, safe
 * for both host and client bundles.
 */
export const METRIC_VERSION = 'doctor-metrics/3'
export const ELIGIBILITY_VERSION = 'doctor-eligibility/1'
export const AGGREGATE_VERSION = 'doctor-aggregate/1'

export const REPORT_RULE_VERSIONS: readonly string[] = [
  METRIC_VERSION,
  ELIGIBILITY_VERSION,
  AGGREGATE_VERSION,
]

export function hasCurrentRuleVersions(ruleVersions: readonly string[] | undefined): boolean {
  return ruleVersions !== undefined && REPORT_RULE_VERSIONS.every((version) => ruleVersions.includes(version))
}
