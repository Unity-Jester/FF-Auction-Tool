export function draftLoadMessage(code?: string): string {
  if (code === "UNSUPPORTED_DRAFT_TYPE") {
    return "This is a snake draft. This companion supports auction drafts only. Choose an auction draft or return home to connect another one.";
  }
  return "We couldn’t open that auction. Return home and paste another Sleeper draft link.";
}
