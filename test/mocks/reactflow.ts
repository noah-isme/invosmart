import { createElement } from "react";
import type { FC, ReactNode } from "react";

const ReactFlow: FC<{ children?: ReactNode }> = ({ children }) =>
  createElement("div", { "data-testid": "reactflow" }, children);

export const Background: FC = () => null;
export const Controls: FC = () => null;
export const MiniMap: FC = () => null;
export const MarkerType = { Arrow: "Arrow" } as const;

export default ReactFlow;
