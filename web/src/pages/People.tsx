import { useState } from 'react';

import type { Schemas } from '@/api/http';
import { useMe } from '@/auth';
import { CrudPage } from '@/components/crud';
import type { FieldSpec } from '@/components/form';
import { Badge, PageHeader, Tabs } from '@/components/ui';
import { stationLabel } from '@/lib/fields';
import { labelFor, roles } from '@/lib/labels';

import { Certifications, CertificationTypes } from './Certifications';

function Members() {
  const { isAdmin } = useMe();
  const fields: FieldSpec[] = [
    { name: 'first_name', label: 'First name', type: 'text' },
    { name: 'last_name', label: 'Last name', type: 'text' },
    { name: 'username', label: 'Username', type: 'text', required: true, help: 'Used to sign in' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone', type: 'text' },
    { name: 'employee_id', label: 'Employee ID', type: 'text' },
    { name: 'rank', label: 'Rank', type: 'text', placeholder: 'e.g. Captain' },
    { name: 'role', label: 'App role', type: 'select', options: roles, required: true },
    {
      name: 'home_station',
      label: 'Home station',
      type: 'relation',
      endpoint: '/api/v1/stations/',
      optionLabel: stationLabel as (row: never) => string,
    },
    {
      name: 'password',
      label: 'Set password',
      type: 'password',
      help: 'At least 8 characters. Leave blank to keep the current password.',
    },
    { name: 'is_active', label: 'Active (can sign in)', type: 'checkbox' },
  ];

  return (
    <CrudPage<Schemas['User']>
      title="People"
      subtitle={
        isAdmin ? 'Members, officers and admins in your department.' : 'Only department admins can edit people.'
      }
      noun="person"
      endpoint="/api/v1/users/"
      canWrite={isAdmin}
      canDelete={isAdmin}
      defaults={{ role: 'member', is_active: true }}
      // Never send an empty password: it would fail validation (or, on edit, mean "no change").
      prepare={(body) => {
        if (!body.password) delete body.password;
        return body;
      }}
      filters={[{ name: 'role', label: 'Role', options: roles }]}
      columns={[
        { header: 'Name', cell: (u) => u.full_name || u.username },
        { header: 'Rank', cell: (u) => u.rank },
        { header: 'Role', cell: (u) => labelFor(roles, u.role) },
        { header: 'Employee ID', cell: (u) => u.employee_id },
        { header: 'Phone', cell: (u) => u.phone },
        { header: 'Status', cell: (u) => (u.is_active ? null : <Badge>Inactive</Badge>) },
      ]}
      fields={fields}
    />
  );
}

type Tab = 'members' | 'certifications' | 'types';

export default function People() {
  const { isAdmin } = useMe();
  const [tab, setTab] = useState<Tab>('members');
  return (
    <div>
      <PageHeader
        title="People"
        subtitle={
          isAdmin
            ? 'Members, officers and admins, and their certifications.'
            : 'Only department admins can edit people.'
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'members', label: 'Members' },
          { value: 'certifications', label: 'Certifications' },
          { value: 'types', label: 'Certification types' },
        ]}
      />
      {tab === 'members' ? <Members /> : null}
      {tab === 'certifications' ? <Certifications /> : null}
      {tab === 'types' ? <CertificationTypes /> : null}
    </div>
  );
}
