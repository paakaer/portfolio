import type { Features } from '../domain/registry'

export function showsAnalyticsDashboard(features: Features): boolean {
  return features.analytics
}

/**
 * The weekly report is opt-in and independent of the dashboard: a tenant may want
 * the Sunday email without ever opening a chart, and enablement is the ONLY gate
 * on who receives one. Nobody is auto-subscribed by having analytics on.
 */
export function receivesWeeklyReport(features: Features): boolean {
  return features.weeklyReport
}
