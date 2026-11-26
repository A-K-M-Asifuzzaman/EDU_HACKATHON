// Named echarts imports only (tree-shakable). Loaded dynamically by echart.tsx, so pages without charts never download echarts.
// Dynamic import of the barrel modules (`import("echarts/charts")`) defeated tree-shaking and shipped all 23 chart types.
import * as core from "echarts/core";
import { BarChart, BoxplotChart, CustomChart, GaugeChart, HeatmapChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import { AxisPointerComponent, DataZoomComponent, DatasetComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent,
  MarkPointComponent, TitleComponent, ToolboxComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

core.use([LineChart, BarChart, ScatterChart, HeatmapChart, BoxplotChart, PieChart, GaugeChart, CustomChart, GridComponent, TooltipComponent,
  LegendComponent, DataZoomComponent, VisualMapComponent, MarkLineComponent, MarkAreaComponent, MarkPointComponent, ToolboxComponent,
  TitleComponent, AxisPointerComponent, DatasetComponent, CanvasRenderer]);

export default core;
