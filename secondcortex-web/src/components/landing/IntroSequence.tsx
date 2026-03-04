"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";

export default function IntroSequence({ onComplete }: { onComplete: () => void }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const fragmentsRef = useRef<HTMLDivElement>(null);
    const logoMarkRef = useRef<HTMLDivElement>(null);
    const letterWrapperRef = useRef<HTMLDivElement>(null);
    const [isIntroComplete, setIsIntroComplete] = useState(false);

    useEffect(() => {
        if (!containerRef.current) return;

        // Prevent scrolling during intro
        document.body.style.overflow = 'hidden';

        // The word to split and animate
        const word = "Second Cortex";
        if (letterWrapperRef.current) {
            letterWrapperRef.current.innerHTML = word.split('').map(char =>
                `<span class="inline-block opacity-0 translate-y-5 intro-letter">${char === ' ' ? '&nbsp;' : char}</span>`
            ).join('');
        }

        const tl = gsap.timeline({
            onComplete: () => {
                setIsIntroComplete(true);
                document.body.style.overflow = '';
                onComplete();
            }
        });

        // Scatter them randomly on the client side only
        gsap.set(".intro-fragment", {
            x: () => (Math.random() - 0.5) * 200,
            y: () => (Math.random() - 0.5) * 200,
            rotation: () => Math.random() * 90,
        });

        // Stage 1 - Fragments Appearance
        tl.to(".intro-fragment", {
            scale: 1,
            opacity: 1,
            rotation: "+=15",
            x: 0,
            y: 0,
            duration: 1.2,
            ease: "power4.out",
            stagger: 0.1
        }, 0.2);

        // Stage 2 - Logo Morphing (Fragments pull tightly into center and fade, logomark fades in)
        tl.to(".intro-fragment", {
            scale: 0.5,
            opacity: 0,
            duration: 0.6,
            ease: "power2.inOut"
        }, "+=0.3");

        tl.to(logoMarkRef.current, {
            opacity: 1,
            scale: 1,
            duration: 0.5,
            ease: "back.out(1.7)"
        }, "-=0.3");

        // Stage 3 - Logo Text Reveal
        tl.to(".intro-letter", {
            opacity: 1,
            y: 0,
            duration: 0.6,
            stagger: 0.05,
            ease: "power2.out"
        }, "+=0.1");

        // Stage 4 - Interface Reveal
        // The logo text translates up to exactly where the navbar logo will be, then fades out as interface fades in
        // To calculate this generically is hard relative to viewport, so we fade out the intro hero
        // and simultaneously fade in the main UI which is already in the background.

        tl.to(containerRef.current, {
            opacity: 0,
            pointerEvents: "none",
            duration: 0.8,
            ease: "power2.inOut"
        }, "+=0.5");

        // Animate the actual interface (Hero, Navbar Logo, Brain)
        tl.to(".navbar-logo-text, .navbar-live-btn", {
            opacity: 1,
            duration: 0.8,
            ease: "power2.out",
        }, "-=0.4");

        tl.to(".hero-content", {
            opacity: 1,
            y: 0,
            duration: 0.8,
            ease: "power2.out",
        }, "-=0.6");

        tl.to(".hero-brain", {
            opacity: 1,
            duration: 1.2,
            ease: "power2.out",
        }, "-=0.6");

        return () => {
            tl.kill();
        };
    }, [onComplete]);

    if (isIntroComplete) return null;

    return (
        <div
            ref={containerRef}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black"
        >
            <div className="relative flex flex-col items-center justify-center">
                {/* Stage 1 Fragments (abstract shapes initially scattered) */}
                <div ref={fragmentsRef} className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    {[...Array(6)].map((_, i) => (
                        <div
                            key={i}
                            className="intro-fragment absolute w-8 h-8 bg-zinc-900 border border-zinc-700 opacity-0"
                            style={{
                                transform: `translate(0px, 0px) scale(0.8) rotate(0deg)`
                            }}
                        />
                    ))}
                </div>

                {/* Stage 2 Clean Morph Target */}
                <div
                    ref={logoMarkRef}
                    className="w-12 h-12 bg-white rounded-lg opacity-0 scale-50 mb-8 shadow-[0_0_30px_rgba(255,255,255,0.3)]"
                />

                {/* Stage 3 Text */}
                <div
                    ref={letterWrapperRef}
                    className="text-3xl font-bold tracking-widest text-white flex space-x-1"
                />
            </div>
        </div>
    );
}
