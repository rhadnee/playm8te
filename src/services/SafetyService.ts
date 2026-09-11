/**
 * Minimal MVP safety layer. Two jobs:
 *  1. Sanitize player-supplied text before it reaches the system/user prompt
 *     (defense against prompt injection attempting to override personality
 *     or safety instructions).
 *  2. Sanity-check AI output before it's shown to the player or used to
 *     drive gameplay (never let the model claim autonomous game control it
 *     doesn't have, never let cheating/harassment content through).
 */

const INJECTION_MARKERS = [
  // Allows for phrasing like "ignore all previous instructions" or "ignore
  // the above system instructions" — real injections chain qualifiers
  // ("all", "previous", "the above") rather than using exactly one.
  /ignore\s+(all\s+|any\s+|the\s+|previous\s+|prior\s+|above\s+)*instructions/i,
  /you are now/i,
  /system prompt/i,
  /disregard\s+(your\s+|all\s+|the\s+|previous\s+)*(rules|guidelines|instructions)/i,
  /act as (an? )?unrestricted/i,
  /forget (your|all|previous) (instructions|rules|training)/i,
];

const DISALLOWED_OUTPUT_PATTERNS = [
  /how to (hack|cheat|exploit)/i,
  /account (theft|takeover)/i,
  /bypass (anti-?cheat|detection)/i,
];

export class SafetyService {
  /** Strips/flags likely prompt-injection content from player chat before it's used as model input. */
  sanitizePlayerInput(raw: string): { text: string; flagged: boolean } {
    let flagged = false;
    for (const pattern of INJECTION_MARKERS) {
      if (pattern.test(raw)) flagged = true;
    }
    // Truncate to a sane length regardless — also mitigates flooding/DoS-by-prompt.
    const text = raw.slice(0, 1000);
    return { text, flagged };
  }

  /** Checks AI output before it's delivered to the player. */
  checkOutput(text: string): { allowed: boolean; reason?: string } {
    for (const pattern of DISALLOWED_OUTPUT_PATTERNS) {
      if (pattern.test(text)) {
        return { allowed: false, reason: "output matched disallowed content pattern" };
      }
    }
    return { allowed: true };
  }

  /** Fallback line used when AI output is blocked or the provider errors out. */
  fallbackResponse(): string {
    return "Hmm, let's just focus on the game for a sec.";
  }
}
