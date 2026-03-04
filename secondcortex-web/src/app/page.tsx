"use client";

import { useState } from "react";
import Navbar from "@/components/landing/Navbar";
import ParticleField from "@/components/landing/ParticleField";
import IntroSequence from "@/components/landing/IntroSequence";
import HeroSection from "@/components/landing/HeroSection";
import CenterMessage from "@/components/landing/CenterMessage";

export default function LandingPage() {
  const [introComplete, setIntroComplete] = useState(false);

  return (
    <main className="relative w-full min-h-screen bg-black overflow-x-hidden">
      {/* Cinematic GSAP Intro Overlay */}
      <IntroSequence onComplete={() => setIntroComplete(true)} />

      {/* Main Interface (initially hidden by IntroSequence, then revealed via GSAP) */}
      <div className="relative z-10 w-full flex flex-col items-center">
        <Navbar />
        <ParticleField />

        {/* Sections */}
        <HeroSection />

        {/* Placeholder spacer for scrolling */}
        <div className="h-[20vh] w-full" />

        <CenterMessage />

        {/* Footer/Bottom spacer */}
        <div className="h-[40vh] w-full" />
      </div>
    </main>
  );
}
