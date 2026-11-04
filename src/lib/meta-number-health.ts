import { metaTokenForNumber } from "@/lib/meta-credentials";

type MetaPhoneList = { data?: { id?: string; verified_name?: string; display_phone_number?: string; quality_rating?: string }[]; error?: { code?: number; error_subcode?: number } };

export type MetaNumberIdentity = { id: string; e164Number: string; metaPhoneNumberId: string | null; metaWabaId: string | null };
export type MetaNumberCheck = { outcome: "PASSED" | "FAILED"; httpStatus: number | null; providerCode: number | null; verifiedName: string | null; displayNumber: string | null; numberMatches: boolean | null; qualityRating: string | null; error: string | null; durationMs: number };

export async function checkMetaNumberIdentity(number: MetaNumberIdentity): Promise<MetaNumberCheck> {
  const startedAt = Date.now();
  const result: MetaNumberCheck = { outcome: "FAILED", httpStatus: null, providerCode: null, verifiedName: null, displayNumber: null, numberMatches: null, qualityRating: null, error: "Meta could not confirm this phone number under the configured WhatsApp business account.", durationMs: 0 };
  if (!number.metaPhoneNumberId || !number.metaWabaId) {
    result.error = "Add the Meta phone number ID and WABA ID before checking this number.";
    result.durationMs = Date.now() - startedAt;
    return result;
  }
  try {
    const token = await metaTokenForNumber(number.id);
    if (!token) result.error = "No active Meta access token is available for this number.";
    else {
      const configuredVersion = process.env.META_GRAPH_API_VERSION || "v26.0";
      const version = /^v\d+\.\d+$/.test(configuredVersion) ? configuredVersion : "v26.0";
      const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(number.metaWabaId)}/phone_numbers?fields=id,verified_name,display_phone_number,quality_rating`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) });
      result.httpStatus = response.status;
      const payload = await response.json().catch(() => ({})) as MetaPhoneList;
      result.providerCode = payload.error?.code ?? null;
      const matched = payload.data?.find((phone) => String(phone.id) === String(number.metaPhoneNumberId));
      if (response.ok && matched) {
        result.verifiedName = matched.verified_name ?? null;
        result.displayNumber = matched.display_phone_number ?? null;
        if (!result.displayNumber) result.error = "Meta found the configured phone number ID but did not return its display number, so the CRM cannot confirm the mapping. Check Meta permissions and retry.";
        else {
          const metaDigits = result.displayNumber.replace(/\D/g, "");
          const savedDigits = number.e164Number.replace(/\D/g, "");
          result.numberMatches = Boolean(metaDigits && savedDigits && metaDigits === savedDigits);
        }
        result.qualityRating = matched.quality_rating ?? null;
        if (result.numberMatches === false) result.error = "The Meta phone-number ID belongs to a different phone number than the one saved in this CRM. Correct the mapping before sending from this number.";
        else if (result.numberMatches === true) { result.outcome = "PASSED"; result.error = null; }
      } else if (response.ok) result.error = "Meta returned the WABA phone-number list, but the configured phone number ID was not present.";
      else result.error = `Meta rejected the read-only check (HTTP ${response.status}${result.providerCode ? `, provider code ${result.providerCode}` : ""}).`;
    }
  } catch (error) {
    result.error = error instanceof Error && error.name === "TimeoutError" ? "The Meta number check timed out. Try again when connectivity is stable." : "Could not reach Meta to check this number.";
  }
  result.durationMs = Date.now() - startedAt;
  return result;
}
