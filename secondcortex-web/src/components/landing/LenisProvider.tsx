"use client";

import { ReactLenis } from "@studio-freight/react-lenis";
import { ReactNode } from "react";

export default function LenisProvider({ children }: { children: ReactNode }) {
    return (
        <ReactLenis
            root
            options={{
                lerp: 0.05, // Smoothness. Lower = smoother.
                duration: 1.5,
                smoothWheel: true,
            }}
        >
            {/* @ts-ignore - legacy lenis @types/react mismatch with React 19 */}
            {children}
        </ReactLenis>
    );
}
