import { describe, expect, it } from "vitest";
import { isActionableQuestion, analyzeQuestionCompleteness, isIncompleteScenario, isLikelyNonSpeech } from "./util";

describe("isLikelyNonSpeech", () => {
  it("recognizes common short system-audio noises", () => {
    expect(isLikelyNonSpeech("[Coughing]")).toBe(true);
    expect(isLikelyNonSpeech("cough cough cough")).toBe(true);
    expect(isLikelyNonSpeech("ahem")).toBe(true);
    expect(isLikelyNonSpeech("hem hem")).toBe(true);
    expect(isLikelyNonSpeech("Clears his throat")).toBe(true);
    expect(isLikelyNonSpeech("throat clearing")).toBe(true);
    expect(isLikelyNonSpeech("(laughter)")).toBe(true);
    expect(isLikelyNonSpeech("background noise")).toBe(true);
    expect(isLikelyNonSpeech("sneezing")).toBe(true);
  });

  it("preserves real questions that mention noise", () => {
    expect(isLikelyNonSpeech("How do you handle background noise in audio processing?")).toBe(false);
    expect(isLikelyNonSpeech("Can you explain cough detection algorithms?")).toBe(false);
  });

  it("blocks noise in every-pause mode", () => {
    expect(isActionableQuestion("cough cough cough", "every-pause")).toBe(false);
    expect(isActionableQuestion("clears their throat", "every-pause")).toBe(false);
  });
});

describe("isActionableQuestion", () => {
  it("recognizes standard interrogative interview questions", () => {
    expect(isActionableQuestion("What is your approach to microservices?")).toBe(true);
    expect(isActionableQuestion("How do you design a highly available database")).toBe(true);
    expect(isActionableQuestion("Why did you choose PostgreSQL over MongoDB")).toBe(true);
    expect(isActionableQuestion("When would you use Kafka instead of RabbitMQ")).toBe(true);
    expect(isActionableQuestion("Where do you see the biggest trade-offs in cloud migration")).toBe(true);
  });

  it("recognizes imperative and directive interview prompts without question marks", () => {
    expect(isActionableQuestion("Tell me about yourself")).toBe(true);
    expect(isActionableQuestion("Walk me through your background")).toBe(true);
    expect(isActionableQuestion("Give me an example of a time you resolved a team conflict")).toBe(true);
    expect(isActionableQuestion("Describe a challenging project you led")).toBe(true);
    expect(isActionableQuestion("Explain your experience with Azure Kubernetes Service")).toBe(true);
    expect(isActionableQuestion("Discuss your strategy for cost optimization in AWS")).toBe(true);
    expect(isActionableQuestion("Share a situation where a production deployment failed")).toBe(true);
  });

  it("recognizes comparison and behavioral phrasing", () => {
    expect(isActionableQuestion("Compare monolithic architecture versus microservices")).toBe(true);
    expect(isActionableQuestion("What is the tradeoff between consistency and availability")).toBe(true);
    expect(isActionableQuestion("Talk about a time when you disagreed with a product manager")).toBe(true);
  });

  it("rejects non-question filler phrases and noises", () => {
    expect(isActionableQuestion("hello")).toBe(false);
    expect(isActionableQuestion("thank you")).toBe(false);
    expect(isActionableQuestion("sounds good")).toBe(false);
    expect(isActionableQuestion("got it")).toBe(false);
    expect(isActionableQuestion("yeah sure")).toBe(false);
    expect(isActionableQuestion("testing 1 2 3")).toBe(false);
  });

  it("respects every-pause mode for general statements", () => {
    expect(isActionableQuestion("The project had multiple microservices in production", "every-pause")).toBe(true);
    expect(isActionableQuestion("ok", "every-pause")).toBe(false);
  });
});

describe("analyzeQuestionCompleteness", () => {
  it("scores complete questions with high confidence", () => {
    const score1 = analyzeQuestionCompleteness("How do you handle zero downtime deployments in Kubernetes?");
    expect(score1).toBeGreaterThanOrEqual(0.75);

    const score2 = analyzeQuestionCompleteness("Tell me about a time you had to optimize cloud costs.");
    expect(score2).toBeGreaterThanOrEqual(0.70);
  });

  it("penalizes incomplete questions ending in connectors", () => {
    const incomplete = analyzeQuestionCompleteness("Can you explain how you design the system and");
    const complete = analyzeQuestionCompleteness("Can you explain how you design the system?");
    expect(incomplete).toBeLessThan(complete);
    expect(incomplete).toBeLessThan(0.60);
  });

  it("penalizes incomplete scenario starters", () => {
    expect(isIncompleteScenario("Suppose you have a database cluster")).toBe(true);
    expect(isIncompleteScenario("Suppose you have a database cluster, how would you scale it?")).toBe(false);
  });
});
