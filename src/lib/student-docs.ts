/** Student document types, upload limits and a magic-byte sniffer (never trust the browser's content type). */
export const DOC_BUCKET = "student-docs";

export const DOC_TYPES: [string, string][] = [
  ["birth_certificate", "Birth certificate / age proof"],
  ["photo", "Photograph"],
  ["previous_marksheet", "Previous marksheet / report card"],
  ["transfer_certificate", "Transfer certificate (TC)"],
  ["migration_certificate", "Migration certificate"],
  ["address_proof", "Address proof"],
  ["caste_certificate", "Caste certificate"],
  ["income_certificate", "Income certificate"],
  ["disability_certificate", "Disability certificate"],
  ["apaar_consent", "APAAR consent form"],
  ["medical_declaration", "Medical declaration"],
  ["transport_declaration", "Transport declaration"],
  ["other", "Other"],
];

export const DOC_LIMITS = { photo: { bytes: 1 * 1024 * 1024 }, document: { bytes: 5 * 1024 * 1024 } };

export function sniffFile(b: Uint8Array): { ext: "pdf" | "jpg" | "png"; mime: string } | null {
  if (b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { ext: "pdf", mime: "application/pdf" };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", mime: "image/png" };
  return null;
}
