export function isDeepgramPaymentRequiredError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const record = err as Record<string, unknown>;
  const status =
    record.status ??
    record.statusCode ??
    record.code ??
    record.responseStatus ??
    (typeof record.response === "object" && record.response !== null
      ? (record.response as Record<string, unknown>).status
      : undefined);
  if (status === 402 || status === "402") return true;

  const text = [
    record.err_code,
    record.err_msg,
    record.message,
    record.body,
    record.responseBody,
  ]
    .filter((value) => typeof value === "string")
    .join(" ");
  return (
    text.includes("ASR_PAYMENT_REQUIRED") ||
    text.includes("does not have enough credits") ||
    text.includes("Payment Required")
  );
}
