import { useParams } from 'react-router';

import { SupplySection } from './Inventory';

/** /supplies/:section – one Supplies section, by its path (uniforms, fire-gear, medical, …). */
export function SupplySectionPage() {
  const { section = 'uniforms' } = useParams();
  return <SupplySection key={section} path={section} />;
}
