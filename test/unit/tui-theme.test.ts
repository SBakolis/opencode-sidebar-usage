import { describe, expect, it } from "vitest";
import { resolveThemeColors } from "../../src/tui/theme";
import type { TuiThemeCurrent } from "../../src/tui/types";

function makeTheme(overrides: Partial<TuiThemeCurrent> = {}): TuiThemeCurrent {
  return {
    primary: [0, 0, 0, 1],
    secondary: [0, 0, 0, 1],
    accent: [0, 0, 0, 1],
    error: [255, 0, 0, 1],
    warning: [255, 255, 0, 1],
    success: [0, 255, 0, 1],
    info: [0, 0, 255, 1],
    text: [200, 200, 200, 1],
    textMuted: [120, 120, 120, 1],
    selectedListItemText: [255, 255, 255, 1],
    background: [0, 0, 0, 1],
    backgroundPanel: [20, 20, 20, 1],
    backgroundElement: [30, 30, 30, 1],
    backgroundMenu: [40, 40, 40, 1],
    border: [60, 60, 60, 1],
    borderActive: [80, 80, 80, 1],
    borderSubtle: [40, 40, 40, 1],
    diffAdded: [0, 255, 0, 1],
    diffRemoved: [255, 0, 0, 1],
    diffContext: [200, 200, 200, 1],
    diffHunkHeader: [100, 100, 100, 1],
    diffHighlightAdded: [0, 200, 0, 1],
    diffHighlightRemoved: [200, 0, 0, 1],
    diffAddedBg: [0, 50, 0, 1],
    diffRemovedBg: [50, 0, 0, 1],
    diffContextBg: [30, 30, 30, 1],
    diffLineNumber: [100, 100, 100, 1],
    diffAddedLineNumberBg: [0, 50, 0, 1],
    diffRemovedLineNumberBg: [50, 0, 0, 1],
    markdownText: [200, 200, 200, 1],
    markdownHeading: [255, 255, 255, 1],
    markdownLink: [0, 100, 255, 1],
    markdownLinkText: [100, 200, 255, 1],
    markdownCode: [0, 255, 0, 1],
    markdownBlockQuote: [150, 150, 150, 1],
    markdownEmph: [200, 200, 200, 1],
    markdownStrong: [255, 255, 255, 1],
    markdownHorizontalRule: [100, 100, 100, 1],
    markdownListItem: [200, 200, 200, 1],
    markdownListEnumeration: [150, 150, 150, 1],
    markdownImage: [0, 100, 255, 1],
    markdownImageText: [100, 200, 255, 1],
    markdownCodeBlock: [0, 200, 0, 1],
    syntaxComment: [100, 100, 100, 1],
    syntaxKeyword: [0, 100, 255, 1],
    syntaxFunction: [255, 200, 0, 1],
    syntaxVariable: [200, 200, 200, 1],
    syntaxString: [0, 255, 0, 1],
    syntaxNumber: [255, 150, 0, 1],
    syntaxType: [0, 200, 255, 1],
    syntaxOperator: [200, 200, 200, 1],
    syntaxPunctuation: [150, 150, 150, 1],
    thinkingOpacity: 0.5,
    ...overrides,
  };
}

describe("resolveThemeColors", () => {
  it("returns success color for percentage under threshold", () => {
    const theme = makeTheme();
    const colors = resolveThemeColors(theme, 80);
    expect(colors.quotaColor(50)).toEqual(theme.success);
    expect(colors.quotaColor(79)).toEqual(theme.success);
  });

  it("returns warning color for percentage at threshold", () => {
    const theme = makeTheme();
    const colors = resolveThemeColors(theme, 80);
    expect(colors.quotaColor(80)).toEqual(theme.warning);
    expect(colors.quotaColor(94)).toEqual(theme.warning);
  });

  it("returns error color for percentage at 95 or above", () => {
    const theme = makeTheme();
    const colors = resolveThemeColors(theme, 80);
    expect(colors.quotaColor(95)).toEqual(theme.error);
    expect(colors.quotaColor(100)).toEqual(theme.error);
  });

  it("exposes text and textMuted from theme", () => {
    const theme = makeTheme();
    const colors = resolveThemeColors(theme, 80);
    expect(colors.text).toBe(theme.text);
    expect(colors.textMuted).toBe(theme.textMuted);
  });

  it("exposes border from theme", () => {
    const theme = makeTheme();
    const colors = resolveThemeColors(theme, 80);
    expect(colors.border).toBe(theme.border);
  });
});
