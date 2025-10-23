import React from "react";
import { vi } from "vitest";

export const signIn = vi.fn();
export const signOut = vi.fn();
export const useSession = vi.fn(() => ({ data: null, status: "unauthenticated" }));
export const SessionProvider = ({ children }: { children: React.ReactNode }) =>
  React.createElement(React.Fragment, null, children);
