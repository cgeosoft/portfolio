import { describe, it, expect } from "bun:test";
import { isBriefDue, nextBriefRun, localDate } from "../daily-brief";
import { gotifyMessageUrl } from "../gotify";
import { isValidNtfyTopic, ntfyPublishUrl } from "../ntfy";

const base = { dailyBriefEnabled: true, dailyBriefTime: "08:00", dailyBriefDays: "weekdays" as string, dailyBriefLastRun: undefined as string | undefined };

// 2026-09-28 is a Monday.
const at = (date: string, time: string) => new Date(`${date}T${time}:00`);

describe("Daily brief schedule", () => {
  it("is due after the set time on a run day", () => {
    expect(isBriefDue(base, at("2026-09-28", "07:59"))).toBe(false);
    expect(isBriefDue(base, at("2026-09-28", "08:00"))).toBe(true);
    expect(isBriefDue(base, at("2026-09-28", "15:30"))).toBe(true);
  });

  it("runs once a day", () => {
    expect(isBriefDue({ ...base, dailyBriefLastRun: "2026-09-28" }, at("2026-09-28", "09:00"))).toBe(false);
    expect(isBriefDue({ ...base, dailyBriefLastRun: "2026-09-27" }, at("2026-09-28", "09:00"))).toBe(true);
  });

  it("skips weekends on weekdays only", () => {
    expect(isBriefDue(base, at("2026-09-26", "09:00"))).toBe(false);
    expect(isBriefDue({ ...base, dailyBriefDays: "daily" }, at("2026-09-26", "09:00"))).toBe(true);
  });

  it("never runs while switched off", () => {
    expect(isBriefDue({ ...base, dailyBriefEnabled: false }, at("2026-09-28", "09:00"))).toBe(false);
    expect(nextBriefRun({ ...base, dailyBriefEnabled: false }, at("2026-09-28", "09:00"))).toBeUndefined();
  });

  it("finds the next run past the weekend", () => {
    const next = nextBriefRun({ ...base, dailyBriefLastRun: "2026-10-02" }, at("2026-10-02", "09:00"));
    expect(localDate(new Date(next!))).toBe("2026-10-05");
  });
});

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
