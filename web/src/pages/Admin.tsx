import { SECTION_GROUPS } from '@/components/sections';
import { TileGrid } from '@/components/tiles';
import { PageHeader } from '@/components/ui';

/** Department-wide setup, gathered in one place so it stays off the home page. */
export default function Admin() {
  const sections = SECTION_GROUPS.find((g) => g.title === 'Admin')?.sections ?? [];
  return (
    <div className="stack">
      <PageHeader title="Admin" subtitle="Department-wide setup. Only admins see this." />
      <TileGrid sections={sections} />
    </div>
  );
}
