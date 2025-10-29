"use client";

import { memo } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type ConfidenceHistoryDatum = {
  id: string;
  route: string;
  confidence: number;
  timestamp: string;
  rollback: boolean;
};

type AiLearningConfidenceHistoryProps = {
  data: ConfidenceHistoryDatum[];
};

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

function ConfidenceHistory({ data }: AiLearningConfidenceHistoryProps) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 12, right: 24, bottom: 12, left: 12 }}>
          <defs>
            <linearGradient id="confidenceGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#818CF8" stopOpacity={0.9} />
              <stop offset="95%" stopColor="#818CF8" stopOpacity={0.1} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="timestamp"
            tick={{ fill: "#A9ADC1", fontSize: 11 }}
            tickFormatter={(value: string) => new Date(value).toLocaleTimeString()}
          />
          <YAxis tick={{ fill: "#A9ADC1", fontSize: 11 }} domain={[0.4, 1]} tickFormatter={formatPercent} />
          <Tooltip
            formatter={(value: number, _key: string, payload) => [formatPercent(value), payload?.payload?.route ?? ""]}
            labelFormatter={(value) => new Date(value).toLocaleString()}
            contentStyle={{ backgroundColor: "#10111B", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)" }}
          />
          <Area type="monotone" dataKey="confidence" stroke="#818CF8" fill="url(#confidenceGradient)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export const AiLearningConfidenceHistory = memo(ConfidenceHistory);
