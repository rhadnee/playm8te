export type TrashTalkLevel = "none" | "light" | "moderate" | "heavy";

export interface PersonalityConfig {
  id: string;
  displayName: string;
  communicationStyle: string; // free-text descriptor fed into the system prompt
  confidence: number; // 0-1
  humor: number; // 0-1
  competitiveness: number; // 0-1
  coachingIntensity: number; // 0-1
  verbosity: number; // 0-1, controls target reply length
  emotionalReactivity: number; // 0-1, how much it reacts to swings in the game
  acceptableTrashTalkLevel: TrashTalkLevel;
  preferredVocabulary: string[]; // words/phrases to lean toward
  playerRelationshipStyle: string; // e.g. "supportive friend", "rival", "mentor"
}
