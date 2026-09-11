import Anthropic from "@anthropic-ai/sdk";
import { AICompletionRequest, AICompletionResult, AIProvider } from "./AIProvider";

/**
 * Anthropic implementation. API key is read server-side only — this class
 * is never imported by any client-facing bundle.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = "claude-sonnet-4-6") {
    if (!apiKey) throw new Error("AnthropicProvider requires an API key");
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const systemMessages = request.messages.filter((m) => m.role === "system");
    const conversation = request.messages.filter((m) => m.role !== "system");

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens ?? 300,
      temperature: request.temperature ?? 0.8,
      system: systemMessages.map((m) => m.content).join("\n\n") || undefined,
      messages: conversation.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    });

    const textBlock = response.content.find((b) => b.type === "text");
    return {
      text: textBlock && "text" in textBlock ? textBlock.text : "",
      raw: response,
    };
  }
}
