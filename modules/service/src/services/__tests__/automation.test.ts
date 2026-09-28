import { describe, it, expect } from "bun:test";
import { gotifyMessageUrl } from "../gotify";
import { isValidNtfyTopic, ntfyPublishUrl } from "../ntfy";

describe("Gotify URL", () => {
  it("targets the message endpoint", () => {
    expect(gotifyMessageUrl("https://gotify.example.com")).toBe("https://gotify.example.com/message");
    expect(gotifyMessageUrl("https://gotify.example.com/")).toBe("https://gotify.example.com/message");
    expect(gotifyMessageUrl("https://example.com/gotify/message")).toBe("https://example.com/gotify/message");
  });
});

describe("ntfy", () => {
  it("publishes to the server root", () => {
    expect(ntfyPublishUrl("https://ntfy.sh")).toBe("https://ntfy.sh/");
    expect(ntfyPublishUrl("https://ntfy.example.com/")).toBe("https://ntfy.example.com/");
  });

  it("accepts only topics ntfy allows", () => {
    expect(isValidNtfyTopic("portfolio-a1b2_c3")).toBe(true);
    expect(isValidNtfyTopic("")).toBe(false);
    expect(isValidNtfyTopic("with space")).toBe(false);
    expect(isValidNtfyTopic("a/b")).toBe(false);
    expect(isValidNtfyTopic("x".repeat(65))).toBe(false);
  });
});
