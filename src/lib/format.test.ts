import { describe, expect, it } from "vitest";
import { formatDate } from "./format";

describe("date formatting", () => {
  it("shows day and month for the current year", () => {
    const currentYear = new Date().getFullYear();

    expect(formatDate(new Date(currentYear, 7, 23))).toBe("23 августа");
  });

  it("adds the year for non-current dates", () => {
    const previousYear = new Date().getFullYear() - 1;

    expect(formatDate(new Date(previousYear, 7, 23))).toBe(`23 августа, ${previousYear}`);
  });
});
