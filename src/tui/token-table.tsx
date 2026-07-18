/**
 * TokenTable — renders per-model token usage rows + total row.
 *
 * Each model row shows: modelID, input, output, cache (read+write).
 * Total row sums across all models.
 * When there are no models, renders "No usage yet".
 */

import { For } from "solid-js";
import type { ReportModel } from "../report/build";
import { compactNumber } from "../report/compact";
import type { ThemeColors } from "./theme";

export interface TokenTableProps {
  models: ReportModel[];
  colors: ThemeColors;
}

export function TokenTable(props: TokenTableProps) {
  if (props.models.length === 0) {
    return <text style={{ fg: props.colors.textMuted }}> No usage yet</text>;
  }

  let totalInput = 0;
  let totalOutput = 0;
  let totalCache = 0;

  for (const m of props.models) {
    totalInput += m.input;
    totalOutput += m.output;
    totalCache += m.cacheRead + m.cacheWrite;
  }

  return (
    <box style={{ flexDirection: "column" }}>
      <For each={props.models}>{(m) => <ModelRow model={m} colors={props.colors} />}</For>
      <text style={{ fg: props.colors.text, marginTop: 1 }}>
        <span style={{ fg: props.colors.textMuted }}>{"Total  "}</span>
        {`${compactNumber(totalInput)} in`}
        {`  ${compactNumber(totalOutput)} out`}
        {totalCache > 0 ? `  ${compactNumber(totalCache)} cache` : ""}
      </text>
    </box>
  );
}

function ModelRow(props: { model: ReportModel; colors: ThemeColors }) {
  const m = props.model;
  const cache = m.cacheRead + m.cacheWrite;
  return (
    <box style={{ flexDirection: "column" }}>
      <text style={{ fg: props.colors.textMuted }}>{`  ${m.modelID}`}</text>
      <text style={{ fg: props.colors.text }}>
        {`    ${compactNumber(m.input)} in  ${compactNumber(m.output)} out`}
        {cache > 0 ? `  ${compactNumber(cache)} cache` : ""}
      </text>
    </box>
  );
}
