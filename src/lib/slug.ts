import { customAlphabet } from "nanoid";

// URL-safe alphanumerics, 10 chars → ~58 bits of entropy → collision-resistant
// for any realistic personal use (would need billions of records before 0.1% probability)
const nanoid = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  10
);

export function generateSlug(): string {
  return nanoid();
}
