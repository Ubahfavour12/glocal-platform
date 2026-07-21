import { describe, expect, it } from "vitest";
import { scrapeNiche } from "@/lib/research/youtube";
import { generateConcepts } from "@/lib/research/concepts";
import { runGateway } from "@/lib/compliance/gateway";
import { llmGatewayScan } from "@/lib/compliance/llm";

/**
 * LIVE smoke test — hits YouTube + Claude, so it costs real (tiny) money and
 * only runs when LIVE_AI=1. Skipped in normal `npm test`. Proves the whole
 * brain end to end: scrape → concepts → LLM gateway.
 */
const live = process.env.LIVE_AI === "1";

describe.skipIf(!live)("live brain smoke", () => {
  it("scrapes, writes concepts, and gateways them", async () => {
    const viral = await scrapeNiche(process.env.YOUTUBE_DATA_API_KEY!, {
      keywords: ["wine ad"],
      competitorHandles: [],
    });
    expect(viral.length).toBeGreaterThan(0);

    const concepts = await generateConcepts(
      { businessName: "Sample Wine Shop", category: "wine retailer", goal: "whatsapp", description: "Spanish wines delivered in Lagos" },
      viral,
      3,
    );
    expect(concepts.length).toBe(3);
    expect(concepts[0].hook.length).toBeGreaterThan(5);
    console.log("\nCONCEPTS:");
    for (const c of concepts) console.log(`  #${c.rank} ${c.hook}`);

    const bad = await runGateway(
      { copy: "Drink our wine and make 500k a week from home guaranteed!", category: "wine retailer", destinationKind: "whatsapp" },
      llmGatewayScan,
    );
    console.log(`\nBAD concept -> ${bad.verdict} (risk ${bad.riskScore})`);
    expect(bad.verdict).toBe("block");

    const good = await runGateway(
      { copy: concepts[0].copyAngle, category: "wine retailer", destinationKind: "whatsapp" },
      llmGatewayScan,
    );
    console.log(`GOOD concept -> ${good.verdict} (risk ${good.riskScore})\n`);
    expect(good.verdict).toBe("pass");
  }, 120_000);
});
