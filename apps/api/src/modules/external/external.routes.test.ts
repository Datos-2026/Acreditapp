import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EventStatus } from "../../prisma-exports";

/** Mirrors createExternalEventSchema defaults used by the external API. */
const createExternalEventSchema = z.object({
  name: z.string().min(3).max(200),
  description: z.string().max(2000).optional().nullable(),
  location: z.string().max(300).optional().nullable(),
  kind: z.enum(["gcba", "vecinos"]).optional().default("gcba"),
  status: z.nativeEnum(EventStatus).optional().default(EventStatus.draft),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional()
});

describe("external create event schema", () => {
  it("acepta solo name y completa defaults", () => {
    const parsed = createExternalEventSchema.parse({ name: "Encuentro test" });
    expect(parsed.name).toBe("Encuentro test");
    expect(parsed.kind).toBe("gcba");
    expect(parsed.status).toBe("draft");
    expect(parsed.startAt).toBeUndefined();
    expect(parsed.endAt).toBeUndefined();
  });

  it("rechaza name corto", () => {
    expect(() => createExternalEventSchema.parse({ name: "ab" })).toThrow();
  });
});
