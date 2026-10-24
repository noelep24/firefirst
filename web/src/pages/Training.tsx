import { useState } from 'react';

import { PageHeader, Tabs } from '@/components/ui';

import { Certifications, CertificationTypes } from './Certifications';

type Tab = 'certifications' | 'types';

/** Training › Certifications: who holds what, and what expires when. */
export default function CertificationsPage() {
  const [tab, setTab] = useState<Tab>('certifications');
  return (
    <div>
      <PageHeader title="Certifications" subtitle="Who holds what, and what's expiring." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'certifications', label: 'Certifications' },
          { value: 'types', label: 'Certification types' },
        ]}
      />
      {tab === 'certifications' ? <Certifications /> : null}
      {tab === 'types' ? <CertificationTypes /> : null}
    </div>
  );
}
