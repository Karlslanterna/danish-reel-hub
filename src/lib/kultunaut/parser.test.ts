import { describe, expect, it } from "vitest";
import { parseKultunautXml } from "./parser.server";

describe("Kultunaut parser screening tags", () => {
  it("uses the movie synopsis when arrangement metadata is not on the showtime", () => {
    const parsed = parseKultunautXml(`
      <xffd>
        <theaters>
          <theater theaterId="t1">
            <name>Test Bio</name>
            <address><city>Testby</city></address>
          </theater>
        </theaters>
        <movies>
          <movie movieId="m1">
            <officialTitle><title>Vinderfilmen</title></officialTitle>
            <synopsis language="da">Biografklub Danmark. Festaften og visning af sæsonens film.</synopsis>
          </movie>
        </movies>
        <showTimes>
          <showTime date="20260820" theaterId="t1" movieId="m1">
            <times><time>1900</time></times>
          </showTime>
        </showTimes>
      </xffd>
    `);

    expect(parsed.showtimes).toHaveLength(1);
    expect(parsed.showtimes[0]?.events).toEqual(["Biografklub Danmark"]);
  });
});
