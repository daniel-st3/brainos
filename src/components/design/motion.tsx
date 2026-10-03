"use client";
import { useEffect } from "react";
/** One observer per editorial surface; content remains visible without JS. */
export function EditorialMotion({ scope }: { scope: string }) {
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const elements = document.querySelectorAll<HTMLElement>(
      `${scope} [data-reveal]`,
    );
    if (media.matches || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            entry.target.classList.add("reveal-visible");
            observer.unobserve(entry.target);
          }
      },
      { threshold: 0.08 },
    );
    // Only offscreen sections enter the reveal sequence. Never hide critical controls.
    for (const element of elements)
      if (element.getBoundingClientRect().top > window.innerHeight) {
        element.classList.add("reveal-ready");
        observer.observe(element);
      }
    const restore = () => {
      if (media.matches)
        for (const e of elements) e.classList.remove("reveal-ready");
    };
    media.addEventListener("change", restore);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", restore);
      for (const e of elements) e.classList.remove("reveal-ready");
    };
  }, [scope]);
  return null;
}
