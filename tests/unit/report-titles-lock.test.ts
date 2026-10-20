import { describe, expect, it } from "vitest";

import { titleStateQuery } from "@/app/api/report-titles/route";

/**
 * PAR-05: ST-01 wrapped the report-title read-modify-write in a transaction and the
 * comment claimed concurrent PATCHes were serialised. They were not — the read was a
 * plain SELECT, so on PostgreSQL both writers can read the same JSON and the later
 * UPDATE loses the earlier one. The locking clause is the part that was missing, and
 * it must appear only where the server understands it.
 */
describe("titleStateQuery", () => {
  it("locks the settings row on postgres", () => {
    expect(titleStateQuery("postgres").text).toContain("LIMIT 1 FOR UPDATE");
  });

  it("sends no locking clause on sqlite, which cannot parse one", () => {
    const text = titleStateQuery("sqlite").text;
    expect(text).not.toMatch(/FOR UPDATE/i);
    expect(text).toContain('FROM "UserSettings" WHERE "id" = 1 LIMIT 1');
  });

  it("takes no parameters, so the clause cannot be steered by request input", () => {
    expect(titleStateQuery("postgres").values).toEqual([]);
    expect(titleStateQuery("sqlite").values).toEqual([]);
  });
});
