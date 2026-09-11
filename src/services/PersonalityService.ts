import { z } from "zod";
import presets from "../personalities/presets.json";
import { PersonalityConfig } from "../types/personality";

const PersonalityConfigSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  communicationStyle: z.string(),
  confidence: z.number().min(0).max(1),
  humor: z.number().min(0).max(1),
  competitiveness: z.number().min(0).max(1),
  coachingIntensity: z.number().min(0).max(1),
  verbosity: z.number().min(0).max(1),
  emotionalReactivity: z.number().min(0).max(1),
  acceptableTrashTalkLevel: z.enum(["none", "light", "moderate", "heavy"]),
  preferredVocabulary: z.array(z.string()),
  playerRelationshipStyle: z.string(),
});

/**
 * Loads personality configs (currently from the bundled presets.json; later
 * this can read custom/player-authored personalities from Postgres without
 * any caller needing to change). Nothing about a personality's *behavior*
 * is hardcoded in application logic — it's all data consumed by
 * ConversationService when building the system prompt.
 */
export class PersonalityService {
  private registry = new Map<string, PersonalityConfig>();

  constructor(customConfigs: PersonalityConfig[] = []) {
    for (const raw of [...presets, ...customConfigs]) {
      const parsed = PersonalityConfigSchema.parse(raw);
      this.registry.set(parsed.id, parsed);
    }
  }

  list(): PersonalityConfig[] {
    return Array.from(this.registry.values());
  }

  get(id: string): PersonalityConfig {
    const config = this.registry.get(id);
    if (!config) throw new Error(`Unknown personality id: ${id}`);
    return config;
  }

  /** Allows registering a new/custom personality at runtime (e.g. loaded from DB). */
  register(config: PersonalityConfig): void {
    const parsed = PersonalityConfigSchema.parse(config);
    this.registry.set(parsed.id, parsed);
  }

  /** Renders a personality config into system-prompt instructions for the AI provider. */
  toSystemPromptFragment(config: PersonalityConfig): string {
    return [
      `You are an AI gaming companion named M8 with a "${config.displayName}" personality.`,
      `Communication style: ${config.communicationStyle}`,
      `Relationship to the player: ${config.playerRelationshipStyle}.`,
      `Confidence level: ${describeLevel(config.confidence)}.`,
      `Humor level: ${describeLevel(config.humor)}.`,
      `Competitiveness: ${describeLevel(config.competitiveness)}.`,
      `Coaching intensity: ${describeLevel(config.coachingIntensity)}.`,
      `Target reply length: ${describeVerbosity(config.verbosity)}.`,
      `Trash talk: ${config.acceptableTrashTalkLevel === "none" ? "never trash talk" : `${config.acceptableTrashTalkLevel} trash talk is acceptable, always good-natured`}.`,
      `Lean toward vocabulary like: ${config.preferredVocabulary.join(", ")}.`,
      `Never be cruel, discouraging, or demeaning regardless of personality intensity.`,
    ].join("\n");
  }
}

function describeLevel(v: number): string {
  if (v >= 0.8) return "very high";
  if (v >= 0.6) return "high";
  if (v >= 0.4) return "moderate";
  if (v >= 0.2) return "low";
  return "very low";
}

function describeVerbosity(v: number): string {
  if (v >= 0.7) return "2-4 sentences, willing to elaborate";
  if (v >= 0.4) return "1-2 sentences";
  return "one short sentence, sometimes just a few words";
}
