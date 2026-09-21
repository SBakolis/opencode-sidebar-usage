// Run with Bun and the Solid preload; invoked by sidebar.test.ts.
import assert from "node:assert/strict";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { noQuotaSnapshot } from "../../src/quota/types";
import { buildReport } from "../../src/report/build";
import { SidebarContent } from "../../src/tui/sidebar";
import type { ThemeColors } from "../../src/tui/theme";

const colors = {
  text: "#eeeeee",
  textMuted: "#888888",
  border: "#444444",
  quotaColor: () => "#00ff00",
} as unknown as ThemeColors;
const report = buildReport(
  "test-session",
  new Map(),
  {
    ...noQuotaSnapshot("ok", ""),
    resetCredits: {
      availableCount: 2,
      credits: [
        { resetType: "codex_rate_limits", title: "Full reset", expiresAt: "2026-10-04T03:00:00Z" },
        { resetType: "codex_rate_limits", title: "Full reset", expiresAt: "2026-10-05T03:00:00Z" },
      ],
    },
  },
  { generatedAt: "2026-09-09T00:00:00Z", warningThreshold: 80 },
);
const [current, setCurrent] = createSignal(report);
const quota = report.quota;
assert.ok(quota);
const setup = await testRender(
  () => <SidebarContent report={current()} sessionID="test-session" colors={colors} />,
  { width: 34, height: 30 },
);

try {
  await setup.renderOnce();
  const initial = setup.captureCharFrame();
  assert.match(initial, /Usage limit resets/);
  assert.match(initial, /2 available/);
  assert.match(initial, /Full reset \(Weekly \+ 5 hr\)/);
  assert.match(initial, /Expires Oct 4/);
  assert.match(initial, /Expires Oct 5/);
  assert.match(initial, /Tokens \(this session\)/);
  console.log(initial);

  setCurrent({ ...report, quota: { ...quota, resetCredits: { availableCount: 0, credits: [] } } });
  await setup.renderOnce();
  const empty = setup.captureCharFrame();
  assert.match(empty, /No resets available/);
  assert.doesNotMatch(empty, /2 available|Expires Oct/);

  setCurrent({
    ...report,
    quota: { ...quota, resetCredits: { availableCount: 2, credits: null } },
  });
  await setup.renderOnce();
  assert.match(setup.captureCharFrame(), /Details unavailable/);

  setCurrent({ ...report, quota: { ...quota, status: "stale" } });
  await setup.renderOnce();
  assert.match(setup.captureCharFrame(), /2 available \(stale\)/);
  console.log("Sidebar rendering and reactive updates passed.");
} finally {
  setup.renderer.destroy();
}
