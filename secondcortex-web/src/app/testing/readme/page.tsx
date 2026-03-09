export const metadata = {
  title: "SecondCortex Testing README",
  description: "Step-by-step instructions to transition from sandbox simulation to real VSIX usage.",
};

export default function TestingReadmePage() {
  return (
    <main className="sc-shell" style={{ minHeight: "100vh", padding: "120px 24px 40px" }}>
      <div className="sc-guide-card" style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 16 }}>
        <p className="section-label">Testing to Production</p>
        <h1 className="section-title" style={{ marginBottom: 0 }}>SecondCortex Full README</h1>
        <p className="section-desc" style={{ maxWidth: 760 }}>
          Use this guide when you are ready to move from judge sandbox simulation to real workspace resurrection.
        </p>

        <section style={{ display: "grid", gap: 8 }}>
          <h2 className="sc-guide-title">1. Install VSIX and Login</h2>
          <p className="sc-auth-sub">Install the extension in VS Code and authenticate with your SecondCortex account.</p>
        </section>

        <section style={{ display: "grid", gap: 8 }}>
          <h2 className="sc-guide-title">2. Capture Real Snapshots</h2>
          <p className="sc-auth-sub">Open files, run commands, and switch branches to build your timeline memory naturally.</p>
        </section>

        <section style={{ display: "grid", gap: 8 }}>
          <h2 className="sc-guide-title">3. Run Resurrection</h2>
          <p className="sc-auth-sub">Use your natural language restore command in the extension. Validate suggested actions before approval.</p>
        </section>

        <section style={{ display: "grid", gap: 8 }}>
          <h2 className="sc-guide-title">4. Connect MCP Clients</h2>
          <p className="sc-auth-sub">Generate your MCP key in dashboard and connect Claude/Cursor for external memory retrieval.</p>
        </section>

        <p className="sc-modal-warn" style={{ marginTop: 6 }}>
          This sandbox route is intentionally mock-only and does not mutate production backend state.
        </p>
      </div>
    </main>
  );
}
