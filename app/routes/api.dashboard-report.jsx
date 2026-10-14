import { authenticate } from "../shopify.server";
import { loadDashboardAuditReportSummary } from "../lib/dashboard-report-loader.server";

/** Step 3 report payload — loaded on demand, not on every dashboard paint. */
export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const auditReportSummary = await loadDashboardAuditReportSummary(session.shop);
  return { auditReportSummary };
}
