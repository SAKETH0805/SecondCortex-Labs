"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export default function CenterMessage() {
    const containerRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLHeadingElement>(null);

    useEffect(() => {
        // Only run animation after intro sequence (which might take a few seconds)
        // to avoid scroll trigger measuring wrong values.
        const ctx = gsap.context(() => {
            if (!textRef.current || !containerRef.current) return;

            gsap.fromTo(
                textRef.current,
                {
                    opacity: 0,
                    y: 40,
                },
                {
                    opacity: 1,
                    y: 0,
                    duration: 0.7,
                    ease: "power2.out",
                    scrollTrigger: {
                        trigger: containerRef.current,
                        start: "top 70%",
                        toggleActions: "play none none reverse",
                    },
                }
            );
        });

        return () => ctx.revert();
    }, []);

    return (
        <section
            ref={containerRef}
            className="min-h-[60vh] flex items-center justify-center px-6 py-24 relative z-10 w-full max-w-7xl mx-auto"
        >
            <div className="max-w-4xl mx-auto text-center">
                <h2
                    ref={textRef}
                    className="text-4xl md:text-5xl lg:text-6xl font-medium tracking-tight text-white p-4"
                >
                    A step change from current extraction-based methods
                </h2>
            </div>
        </section>
    );
}
