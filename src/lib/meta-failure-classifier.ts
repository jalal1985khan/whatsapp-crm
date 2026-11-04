export type MetaFailureClass =
  | "TRANSIENT"
  | "PERMANENT_RECIPIENT"
  | "SENDER_NUMBER"
  | "WABA_BUSINESS"
  | "POLICY_TEMPLATE"
  | "AUTHENTICATION_CONFIGURATION"
  | "UNKNOWN_HOLD"
  | "OUTCOME_UNKNOWN";

/** Conservative operator guidance; a classification never authorizes a retry. */
export function classifyMetaFailure(input: { code?: unknown; httpStatus?: number }): MetaFailureClass {
  const code = Number(input.code);
  if (input.httpStatus != null && input.httpStatus >= 500) return "OUTCOME_UNKNOWN";
  if (input.httpStatus === 401 || input.httpStatus === 403 || code === 190) return "AUTHENTICATION_CONFIGURATION";
  if (code === 133010) return "SENDER_NUMBER";
  if (input.httpStatus === 429) return "TRANSIENT";
  return "UNKNOWN_HOLD";
}

export function metaFailureGuidance(failureClass: MetaFailureClass) {
  switch (failureClass) {
    case "TRANSIENT": return { severity: "WARNING" as const, title: "WhatsApp rate limit reached", message: "Meta rejected this request because of a rate limit. Review current throughput and retry manually after the limit clears." };
    case "PERMANENT_RECIPIENT": return { severity: "WARNING" as const, title: "WhatsApp could not deliver to this customer", message: "The provider rejected delivery for this recipient. Check the customer number and WhatsApp reachability; the CRM did not switch sender numbers." };
    case "SENDER_NUMBER": return { severity: "CRITICAL" as const, title: "WhatsApp sender number needs attention", message: "Meta rejected this sender number. Review the number's connection and registration status before sending again." };
    case "WABA_BUSINESS": return { severity: "CRITICAL" as const, title: "WhatsApp business account needs attention", message: "Meta reported an account-level send failure. Review the connected WhatsApp business account before sending again." };
    case "POLICY_TEMPLATE": return { severity: "WARNING" as const, title: "WhatsApp policy or template issue", message: "Meta rejected this message for a policy or template-related reason. Review the approved template and message content before trying again." };
    case "AUTHENTICATION_CONFIGURATION": return { severity: "CRITICAL" as const, title: "WhatsApp authorization needs attention", message: "Meta rejected the configured credentials or permissions. Reconnect the business account or restore valid access before sending again." };
    case "UNKNOWN_HOLD": return { severity: "WARNING" as const, title: "WhatsApp send failed and needs review", message: "Meta rejected this message, but the CRM could not safely classify the cause. Review the provider error before retrying; no number switch or automatic retry was made." };
    case "OUTCOME_UNKNOWN": return { severity: "WARNING" as const, title: "WhatsApp send outcome is unknown", message: "The CRM could not confirm whether Meta accepted this message. Check the delivery status before retrying to avoid sending a duplicate." };
  }
}
