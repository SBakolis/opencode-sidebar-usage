/**
 * TokenTable — renders per-model token usage rows + total row.
 *
 * Each model row shows: modelID, input, output, cache (read+write).
 * Total row sums across all models.
 * When there are no models, renders "No usage yet".
 *
 * IMPORTANT (Solid reactivity): the component function body runs ONCE.
 * The `if (models.length === 0) return ...` early-return pattern does NOT
 * react to prop changes — it captures the initial value forever. We use
 * <Show> instead so the fallback re-evaluates when props.models changes.
 * Totals are computed via createMemo so they update reactively.
 */

import { For, Show, createMemo } from "solid-js";
import type { ReportModel } from "../report/build";
import { compactNumber } from "../report/compact";
import type { ThemeColors } from "./theme";

export interface TokenTableProps {
  models: ReportModel[];
  colors: ThemeColors;
}

export function TokenTable(props: TokenTableProps) {
  const totals = createMemo(() => {
    let totalInput = 0;
    let totalOutput = 0;
    let totalCache = 0;
    for (const m of props.models) {
      totalInput += m.input;
      totalOutput += m.output;
      totalCache += m.cacheRead + m.cacheWrite;
    }
    return { totalInput, totalOutput, totalCache };
  });

  return (
    <Show
      when={props.models.length > 0}
      fallback={<text style={{ fg: props.colors.textMuted }}> No usage yet</text>}
    >
      <box style={{ flexDirection: "column" }}>
        <For each={props.models}>{(m) => <ModelRow model={m} colors={props.colors} />}</For>
        <text style={{ fg: props.colors.text, marginTop: 1 }}>
          <span style={{ fg: props.colors.textMuted }}>{"Total  "}</span>
          {`${compactNumber(totals().totalInput)} in`}
          {`  ${compactNumber(totals().totalOutput)} out`}
          {totals().totalCache > 0 ? `  ${compactNumber(totals().totalCache)} cache` : ""}
        </text>
      </box>
    </Show>
  );
}

function ModelRow(props: { model: ReportModel; colors: ThemeColors }) {
  return (
    <box style={{ flexDirection: "column" }}>
      <text style={{ fg: props.colors.textMuted }}>{`  ${props.model.modelID}`}</text>
      <text style={{ fg: props.colors.text }}>
        {`    ${compactNumber(props.model.input)} in  ${compactNumber(props.model.output)} out`}
        {props.model.cacheRead + props.model.cacheWrite > 0
          ? `  ${compactNumber(props.model.cacheRead + props.model.cacheWrite)} cache`
          : ""}
      </text>
    </box>
  );
}
