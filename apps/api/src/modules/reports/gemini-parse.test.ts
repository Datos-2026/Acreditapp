import { describe, expect, it } from "vitest";
import { extractBalancedJsonObject, parseAnalysisPayload } from "./gemini-event-analysis";

describe("parseo resilient de respuesta Gemma/Gemini", () => {
  it("extrae JSON con texto previo", () => {
    const raw = `Aquí está el análisis:
{"executiveSummary":"Hola","keyFindings":["a"],"operationalAlerts":[],"recommendations":[],"conclusion":"Fin"}`;
    const obj = extractBalancedJsonObject(raw);
    expect(obj).toContain("executiveSummary");
    expect(parseAnalysisPayload(raw).executiveSummary).toBe("Hola");
  });

  it("tolera fence markdown", () => {
    const raw = "```json\n{\"executiveSummary\":\"X\",\"keyFindings\":[],\"operationalAlerts\":[],\"recommendations\":[],\"conclusion\":\"Y\"}\n```";
    expect(parseAnalysisPayload(raw).conclusion).toBe("Y");
  });
});
