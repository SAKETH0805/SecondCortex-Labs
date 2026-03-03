import ContextGraph from '@/components/ContextGraph';

export const metadata = {
  title: 'SecondCortex — Live Context Graph',
  description: 'Real-time visualization of the SecondCortex agent reasoning network.',
};

export default function Home() {
  return (
    <main>
      <ContextGraph />
    </main>
  );
}
