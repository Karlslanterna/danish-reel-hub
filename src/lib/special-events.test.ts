import { describe, expect, it } from "vitest";
import { extractTags } from "./showtime-tags";
import { publicSpecialEventOptions } from "./special-events";

describe("special screening tags", () => {
  it("recognizes Filmporten and Biografklub Danmark from feed text", () => {
    expect(extractTags("Filmporten – månedens film").events).toContain("Filmporten");
    expect(extractTags("Biografklubben Danmark").events).toContain("Biografklub Danmark");
  });

  it("only exposes the four curated filter choices", () => {
    expect(
      publicSpecialEventOptions([
        "Opera",
        "Biografklub Danmark",
        "Babybio",
        "Formiddagsbio",
        "Filmporten",
      ]),
    ).toEqual(["Babybio", "Filmporten", "Biografklub Danmark"]);
  });
});
