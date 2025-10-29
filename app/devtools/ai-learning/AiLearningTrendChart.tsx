"use client";

import { memo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

type LearningCurveDatum = {
  route: string;
  successRate: number;
  avgImpact: number;
  confidence: number;
};

type AiLearningTrendChartProps = {
  data: LearningCurveDatum[];
};

function Chart({ data }: AiLearningTrendChartProps) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 12, right: 24, left: 12, bottom: 12 }}>
          <CartesianGrid stroke="#2A2B3A" strokeDasharray="4 8" />
          <XAxis dataKey="route" tick={{ fill: "#A9ADC1", fontSize: 12 }} interval={0} angle={-20} textAnchor="end" height={60} />
          <YAxis tick={{ fill: "#A9ADC1", fontSize: 12 }} tickFormatter={formatPercent} domain={[0, 1]} />
          <Tooltip
            formatter={(value: number, key: string) => [formatPercent(value), key]}
            labelFormatter={(label) => `Route ${label}`}
            contentStyle={{ backgroundColor: "#11121b", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)" }}
          />
          <Legend wrapperStyle={{ color: "#D7DBFF" }} />
          <Line type="monotone" dataKey="successRate" stroke="#60A5FA" strokeWidth={2} dot={false} name="Success rate" />
          <Line type="monotone" dataKey="avgImpact" stroke="#F472B6" strokeWidth={2} dot={false} name="Avg impact" />
          <Line type="monotone" dataKey="confidence" stroke="#34D399" strokeWidth={2} dot={false} name="Confidence" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export const AiLearningTrendChart = memo(Chart);
