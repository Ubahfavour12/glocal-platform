import { describe, expect, it } from "vitest";
import {
  AD_LANGUAGES,
  DEFAULT_AD_LANGUAGE,
  asAdLanguage,
  languageDirective,
  languageLabel,
  sameLanguage,
  type AdLanguage,
} from "./language";

const NON_ENGLISH = AD_LANGUAGES.filter((l) => l !== "english");

describe("asAdLanguage", () => {
  it("accepts every supported language", () => {
    for (const l of AD_LANGUAGES) expect(asAdLanguage(l)).toBe(l);
  });

  it("normalises case and padding", () => {
    expect(asAdLanguage(" Pidgin ")).toBe("pidgin");
    expect(asAdLanguage("YORUBA")).toBe("yoruba");
  });

  it("falls back to English for anything unknown", () => {
    // A stored typo must not become a half-followed instruction in a live ad.
    for (const bad of ["pidgeon", "yorùbá", "french", "", "   ", null, undefined]) {
      expect(asAdLanguage(bad)).toBe("english");
    }
  });

  it("defaults to English, which is what every ad was before this existed", () => {
    expect(DEFAULT_AD_LANGUAGE).toBe("english");
  });
});

describe("languageDirective", () => {
  it("adds nothing at all for English", () => {
    // Byte-identical to the prompt before this module existed: unchanged
    // default behaviour, and a stable cache prefix for most accounts.
    expect(languageDirective("english")).toBe("");
  });

  it("names the language for every non-English option", () => {
    for (const l of NON_ENGLISH) {
      expect(languageDirective(l)).toMatch(/LANGUAGE/);
      expect(languageDirective(l).length).toBeGreaterThan(100);
    }
  });

  it("protects the things that must never be translated", () => {
    // A translated brand name is not the brand; a translated price is a
    // misprice. Both are worse than the ad being in the wrong language.
    for (const l of NON_ENGLISH) {
      const d = languageDirective(l);
      expect(d).toMatch(/business name, product names, and any brand names/);
      expect(d).toMatch(/[Pp]rices/);
    }
  });

  it("forbids caricature in every language", () => {
    // The failure mode is not bad grammar, it is a model performing what it
    // imagines the language sounds like.
    for (const l of NON_ENGLISH) {
      expect(languageDirective(l)).toMatch(/[Nn]ever caricature/);
    }
  });

  it("keeps production notes in English", () => {
    // The storyboard is read by the team, not the customer's audience.
    for (const l of NON_ENGLISH) {
      expect(languageDirective(l)).toMatch(/storyboard and sourcePattern stay in English/);
    }
  });

  it("allows code-switching only where it is genuinely normal", () => {
    // Pidgin and Lagos Yoruba mix with English in real advertising; Hausa and
    // Igbo as briefed here do not, so they must not be told to.
    expect(languageDirective("pidgin")).toMatch(/code-switching/);
    expect(languageDirective("yoruba")).toMatch(/code-switching/);
    expect(languageDirective("hausa")).not.toMatch(/code-switching/);
    expect(languageDirective("igbo")).not.toMatch(/code-switching/);
  });

  it("describes a real register rather than the language in the abstract", () => {
    expect(languageDirective("hausa")).toMatch(/Kano/);
    expect(languageDirective("pidgin")).toMatch(/Lagos/);
    expect(languageDirective("igbo")).toMatch(/southeast/);
  });
});

describe("languageLabel", () => {
  it("gives every language a label for the settings UI", () => {
    for (const l of AD_LANGUAGES) {
      expect(languageLabel(l).length).toBeGreaterThan(0);
    }
    expect(languageLabel("pidgin")).toBe("Nigerian Pidgin");
  });
});

describe("sameLanguage", () => {
  it("is true for an empty or single-ad comparison", () => {
    expect(sameLanguage([])).toBe(true);
    expect(sameLanguage(["pidgin"])).toBe(true);
  });

  it("is true when every ad shares a language", () => {
    expect(sameLanguage(["hausa", "hausa"])).toBe(true);
  });

  it("is false when a duel mixes languages", () => {
    // Then the winner is partly the language, not the hook, and the duel does
    // not control for that.
    expect(sameLanguage(["english", "pidgin"] as AdLanguage[])).toBe(false);
  });
});
