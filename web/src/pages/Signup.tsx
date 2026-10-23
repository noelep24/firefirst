import { Brand } from '@/components/brand';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import type { Schemas } from '@/api/http';
import { useAuth } from '@/auth';
import { type FieldSpec, Form, toBody, type Values } from '@/components/form';
import { Button, Card } from '@/components/ui';

const timezones = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Puerto_Rico',
];

const fields: FieldSpec[] = [
  {
    name: 'department_name',
    label: 'Department name',
    type: 'text',
    required: true,
    wide: true,
    placeholder: 'e.g. Pine Ridge Fire District',
  },
  {
    name: 'timezone',
    label: 'Time zone',
    type: 'select',
    required: true,
    options: timezones.map((z) => ({ value: z, label: z.replace('_', ' ') })),
  },
  { name: 'first_name', label: 'Your first name', type: 'text', required: true },
  { name: 'last_name', label: 'Your last name', type: 'text', required: true },
  { name: 'email', label: 'Email', type: 'email', required: true },
  { name: 'username', label: 'Username', type: 'text', required: true, help: 'You sign in with this' },
  {
    name: 'password',
    label: 'Password',
    type: 'password',
    required: true,
    help: 'At least 8 characters, not a common password',
  },
  {
    name: 'starter_kit',
    label: 'Start with A/B/C shifts on a 24/48, a sample engine checklist and common certifications',
    type: 'checkbox',
    wide: true,
  },
];

export default function Signup({ onCancel }: { onCancel: () => void }) {
  const { signup } = useAuth();
  const [values, setValues] = useState<Values>({ timezone: 'America/Chicago', starter_kit: true });
  const create = useMutation({ mutationFn: () => signup(toBody(fields, values) as Schemas['SignupRequest']) });

  return (
    <div className="login-wrap">
      <Card className="login-card">
        <div className="stack" style={{ width: 'min(560px, calc(100vw - 64px))' }}>
          <div className="stack-sm">
            <Brand large />
            <h1>Create your department</h1>
            <p className="muted">You&apos;ll be its admin. You can import your people, apparatus and inventory next.</p>
          </div>
          <Form
            id="signup-form"
            fields={fields}
            values={values}
            onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
            onSubmit={() => create.mutate()}
            error={create.error}
          />
          <div className="row spread">
            <Button variant="ghost" onClick={onCancel}>
              I already have an account
            </Button>
            <Button variant="primary" type="submit" form="signup-form" loading={create.isPending}>
              Create department
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
