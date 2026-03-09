"use client";

import { useEffect } from "react";

const INTERACTIVE_SELECTOR = "button, a, input, textarea, select, [role='button'], .mem-entry, .suggestion-chip, .agent-card";

export default function CursorLayer() {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (window.matchMedia("(hover: none), (pointer: coarse)").matches) {
      return;
    }

    const cursor = document.getElementById("cursor");
    const ring = document.getElementById("cursor-ring");
    if (!cursor || !ring) {
      return;
    }

    let disposed = false;
    let mx = 0;
    let my = 0;
    let rx = 0;
    let ry = 0;
    let rafId = 0;

    const setExpanded = (expanded: boolean) => {
      cursor.style.width = expanded ? "20px" : "12px";
      cursor.style.height = expanded ? "20px" : "12px";
      ring.style.width = expanded ? "52px" : "36px";
      ring.style.height = expanded ? "52px" : "36px";
      ring.style.borderColor = expanded ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.4)";
    };

    const onMouseMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };

    const onMouseOver = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest(INTERACTIVE_SELECTOR)) {
        setExpanded(true);
      }
    };

    const onMouseOut = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const related = e.relatedTarget as Element | null;
      if (target?.closest(INTERACTIVE_SELECTOR) && !related?.closest(INTERACTIVE_SELECTOR)) {
        setExpanded(false);
      }
    };

    const animate = () => {
      if (disposed) {
        return;
      }
      cursor.style.left = `${mx}px`;
      cursor.style.top = `${my}px`;
      rx += (mx - rx) * 0.15;
      ry += (my - ry) * 0.15;
      ring.style.left = `${rx}px`;
      ring.style.top = `${ry}px`;
      rafId = requestAnimationFrame(animate);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseover", onMouseOver);
    document.addEventListener("mouseout", onMouseOut);
    animate();

    return () => {
      disposed = true;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseover", onMouseOver);
      document.removeEventListener("mouseout", onMouseOut);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <>
      <div id="cursor" />
      <div id="cursor-ring" />
    </>
  );
}
