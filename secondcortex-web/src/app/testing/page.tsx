import TestingSandbox from "@/components/testing/TestingSandbox";

export const metadata = {
  title: "SecondCortex Testing Sandbox",
  description: "Safe mock-only judge playground for agent simulation, firewall redaction, and dry-run resurrection.",
};

export default function TestingPage() {
  return <TestingSandbox />;
}
