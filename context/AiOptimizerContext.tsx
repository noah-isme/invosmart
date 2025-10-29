"use client";

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { PrefetchCandidate, usePredictivePrefetch } from "@/hooks/usePredictivePrefetch";

type AiOptimizerContextValue = {
  predictivePrefetchEnabled: boolean;
  setPredictivePrefetchEnabled: (value: boolean) => void;
  recommendations: PrefetchCandidate[];
  refreshRecommendations: () => Promise<void>;
  isLoading: boolean;
  featureEnabled: boolean;
};

const AiOptimizerContext = createContext<AiOptimizerContextValue | undefined>(undefined);

const STORAGE_KEY = "invosmart:predictive-prefetch";

const getInitialState = () => {
  if (typeof window === "undefined") return true;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === null) return true;
  return stored === "true";
};

export const AiOptimizerProvider = ({ children }: { children: ReactNode }) => {
  const [enabled, setEnabled] = useState<boolean>(getInitialState);
  const [isLoading, setIsLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<PrefetchCandidate[]>([]);

  const featureEnabled = useMemo(() => {
    const envFlag = process.env.NEXT_PUBLIC_ENABLE_AI_OPTIMIZER;
    if (envFlag === "false") return false;
    if (envFlag === "true") return true;
    return process.env.NODE_ENV !== "test";
  }, []);

  const refreshRecommendations = useCallback(async () => {
    if (!featureEnabled) {
      setRecommendations([]);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/ai-optimizer/recommendations");
      if (!response.ok) {
        throw new Error(`Failed to load recommendations: ${response.status}`);
      }

      const json = await response.json();
      const items = Array.isArray(json?.recommendations) ? json.recommendations : [];
      setRecommendations(
        items
          .filter((item: PrefetchCandidate) => typeof item?.route === "string" && typeof item?.confidence === "number")
          .map((item: PrefetchCandidate) => ({
            route: item.route,
            confidence: item.confidence,
          })),
      );
    } catch (error) {
      console.warn("Unable to refresh AI recommendations", error);
      setRecommendations([]);
    } finally {
      setIsLoading(false);
    }
  }, [featureEnabled]);

  useEffect(() => {
    if (!featureEnabled) return;
    void refreshRecommendations();
  }, [featureEnabled, refreshRecommendations]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
  }, [enabled]);

  usePredictivePrefetch(recommendations, { enabled: featureEnabled && enabled });

  const value = useMemo(
    () => ({
      predictivePrefetchEnabled: enabled && featureEnabled,
      setPredictivePrefetchEnabled: setEnabled,
      recommendations,
      refreshRecommendations,
      isLoading,
      featureEnabled,
    }),
    [enabled, featureEnabled, recommendations, refreshRecommendations, isLoading],
  );

  return <AiOptimizerContext.Provider value={value}>{children}</AiOptimizerContext.Provider>;
};

export const useAiOptimizer = () => {
  const ctx = useContext(AiOptimizerContext);
  if (!ctx) {
    throw new Error("useAiOptimizer must be used within AiOptimizerProvider");
  }
  return ctx;
};
