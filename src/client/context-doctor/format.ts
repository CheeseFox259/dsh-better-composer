export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${value >= 100_000 ? Math.round(value / 1_000) : (value / 1_000).toFixed(1)}k`
  return String(value)
}
