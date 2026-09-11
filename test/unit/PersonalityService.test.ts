import { describe, it, expect } from "vitest";
import { PersonalityService } from "../../src/services/PersonalityService";

describe("PersonalityService", () => {
  it("loads all 7 built-in presets", () => {
    const service = new PersonalityService();
    const ids = service.list().map((p) => p.id).sort();
    expect(ids).toEqual(
      ["chill", "coach", "competitive", "funny", "savage", "strategic", "supportive"].sort()
    );
  });

  it("throws for an unknown personality id", () => {
    const service = new PersonalityService();
    expect(() => service.get("nonexistent")).toThrow(/Unknown personality/);
  });

  it("produces different system prompt fragments for different personalities (wording must differ)", () => {
    const service = new PersonalityService();
    const savage = service.toSystemPromptFragment(service.get("savage"));
    const supportive = service.toSystemPromptFragment(service.get("supportive"));
    expect(savage).not.toBe(supportive);
    expect(savage).toContain("heavy trash talk is acceptable");
    expect(supportive).toContain("never trash talk");
  });

  it("never allows trash talk framing to omit the safety instruction, regardless of intensity", () => {
    // Personality must not override safety — every rendered prompt should
    // still carry the "never be cruel" guardrail even for the most intense
    // personality (savage).
    const service = new PersonalityService();
    for (const personality of service.list()) {
      const prompt = service.toSystemPromptFragment(personality);
      expect(prompt).toContain("Never be cruel, discouraging, or demeaning");
    }
  });

  it("allows registering a custom personality without disturbing built-ins", () => {
    const service = new PersonalityService();
    service.register({
      id: "custom-1",
      displayName: "Custom",
      communicationStyle: "test",
      confidence: 0.5,
      humor: 0.5,
      competitiveness: 0.5,
      coachingIntensity: 0.5,
      verbosity: 0.5,
      emotionalReactivity: 0.5,
      acceptableTrashTalkLevel: "none",
      preferredVocabulary: ["x"],
      playerRelationshipStyle: "test",
    });
    expect(service.get("custom-1").displayName).toBe("Custom");
    expect(service.list().length).toBe(8);
  });
});
