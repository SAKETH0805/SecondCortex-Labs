"use client";

import { useEffect, useRef } from "react";

export default function ParticleField() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        let animationFrameId: number;
        let particles: Particle[] = [];

        // Config
        const PARTICLE_COUNT = 35;
        const MIN_SIZE = 1;
        const MAX_SIZE = 3;

        class Particle {
            x: number;
            y: number;
            size: number;
            vx: number;
            vy: number;
            opacity: number;
            targetOpacity: number;
            lifePhase: number;

            constructor(width: number, height: number) {
                this.x = Math.random() * width;
                this.y = Math.random() * height;
                this.size = Math.random() * (MAX_SIZE - MIN_SIZE) + MIN_SIZE;
                this.vx = (Math.random() - 0.5) * 0.3;
                this.vy = (Math.random() - 0.5) * 0.3;
                this.opacity = 0;
                this.targetOpacity = Math.random() * 0.4 + 0.2; // 0.2 to 0.6
                this.lifePhase = Math.random() * Math.PI * 2;
            }

            update(width: number, height: number) {
                this.x += this.vx;
                this.y += this.vy;

                // Wrap around
                if (this.x < 0) this.x = width;
                if (this.x > width) this.x = 0;
                if (this.y < 0) this.y = height;
                if (this.y > height) this.y = 0;

                // Slow pulse fade in/out
                this.lifePhase += 0.005;
                this.opacity = this.targetOpacity * ((Math.sin(this.lifePhase) + 1) / 2);
            }

            draw(ctx: CanvasRenderingContext2D) {
                ctx.fillStyle = `rgba(255, 255, 255, ${this.opacity})`;
                ctx.beginPath();
                // small squares/dots
                if (this.size > 2) {
                    ctx.rect(this.x, this.y, this.size, this.size);
                } else {
                    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                }
                ctx.fill();
            }
        }

        const init = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            particles = [];
            for (let i = 0; i < PARTICLE_COUNT; i++) {
                particles.push(new Particle(canvas.width, canvas.height));
            }
        };

        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles.forEach((p) => {
                p.update(canvas.width, canvas.height);
                p.draw(ctx);
            });
            animationFrameId = requestAnimationFrame(animate);
        };

        init();
        animate();

        const handleResize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };

        window.addEventListener("resize", handleResize);

        return () => {
            window.removeEventListener("resize", handleResize);
            cancelAnimationFrame(animationFrameId);
        };
    }, []);

    return (
        <div className="fixed inset-0 z-0 pointer-events-none opacity-60">
            <canvas ref={canvasRef} className="w-full h-full block" />
        </div>
    );
}
