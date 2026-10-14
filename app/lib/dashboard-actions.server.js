import { authenticate } from "../shopify.server";
import {
  handleToggleApp,
  handleStopAudit,
  handleStartAudit,
} from "./dashboard-actions-audit.server.js";
import {
  handleRetryHeadInject,
  handleSelectTheme,
} from "./dashboard-actions-theme.server.js";
import {
  handleToggleAuditField,
  handleScriptTokenAction,
  handleSaveAuditArrays,
} from "./dashboard-actions-step3.server.js";
import {
  handleSaveStorefrontPassword,
  handleSaveCustomPageUrls,
} from "./dashboard-actions-settings.server.js";

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "retry-head-inject":
      return handleRetryHeadInject({ admin, session });
    case "toggle-app":
      return handleToggleApp({ admin, session, formData });
    case "stop-audit":
      return handleStopAudit({ session });
    case "start-audit":
      return handleStartAudit({ admin, session });
    case "select-theme":
      return handleSelectTheme({ admin, session, formData });
    case "toggle-audit-field":
      return handleToggleAuditField({ session, formData });
    case "script-token-action":
      return handleScriptTokenAction({ session, formData });
    case "save-audit-arrays":
      return handleSaveAuditArrays({ session, formData });
    case "save-storefront-password":
      return handleSaveStorefrontPassword({ admin, session, formData });
    case "save-custom-page-urls":
      return handleSaveCustomPageUrls({ session, formData });
    default:
      return { ok: false };
  }
};
