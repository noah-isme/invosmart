import type { ImageProps } from "next/image";
import type { LinkProps } from "next/link";
import React, { type AnchorHTMLAttributes, type PropsWithChildren } from "react";
import "@testing-library/jest-dom";
import { vi } from "vitest";

type MockedImageProps = ImageProps & { alt: string };

type MockedLinkProps = PropsWithChildren<
  LinkProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">
>;

type StaticImageLike = { src?: string };
type StaticModuleLike = { default?: StaticImageLike };

const resolveImageSrc = (source: MockedImageProps["src"]): string => {
  if (typeof source === "string") {
    return source;
  }

  if (typeof source === "object" && source) {
    if ("src" in source && typeof source.src === "string") {
      return source.src;
    }

    if ("default" in source) {
      const candidate = (source as StaticModuleLike).default;
      if (candidate && typeof candidate.src === "string") {
        return candidate.src;
      }
    }
  }

  return "";
};

vi.mock("next/image", () => ({
  __esModule: true,
  default: (props: MockedImageProps) => {
    const { alt, src, ...rest } = props;
    return React.createElement("img", { ...rest, alt, src: resolveImageSrc(src) });
  },
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: MockedLinkProps) => {
    const resolvedHref = typeof href === "string" ? href : href.toString();
    return React.createElement("a", { ...rest, href: resolvedHref }, children);
  },
}));
