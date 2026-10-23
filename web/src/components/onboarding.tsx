import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { http, type Schemas } from '@/api/http';
import { useMe } from '@/auth';

import { Button, Card } from './ui';

const DISMISSED = 'ff.onboarding-dismissed';

function dismissed() {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
}

/** "Get set up" checklist on the dashboard until the department's basics are in place. */
export function OnboardingCard() {
  const { isAdmin } = useMe();
  const [hidden, setHidden] = useState(dismissed);
  const steps = useQuery({
    queryKey: ['/api/v1/onboarding/'],
    queryFn: () => http.get<Schemas['OnboardingStep'][]>('/api/v1/onboarding/'),
    enabled: isAdmin && !hidden,
  });
  if (!isAdmin || hidden || !steps.data) return null;
  const remaining = steps.data.filter((s) => !s.done).length;
  if (remaining === 0) return null;

  return (
    <Card>
      <div className="stack-sm">
        <div className="row spread">
          <h2>Get set up</h2>
          <span className="muted small">
            {steps.data.length - remaining} of {steps.data.length} done
          </span>
        </div>
        <p className="muted small">
          Have spreadsheets or an ESO export? <Link to="/import">Import people, apparatus and inventory</Link> in one
          go.
        </p>
        <ol className="stack-sm" style={{ margin: 0, paddingLeft: 20 }}>
          {steps.data.map((s) => (
            <li key={s.key} className={s.done ? 'muted' : undefined}>
              {s.done ? (
                <>
                  <s>{s.title}</s> ✓
                </>
              ) : (
                <Link to={s.link}>{s.title}</Link>
              )}
            </li>
          ))}
        </ol>
        <div>
          <Button
            small
            variant="ghost"
            onClick={() => {
              try {
                localStorage.setItem(DISMISSED, '1');
              } catch {
                // Private mode: just hide it for now.
              }
              setHidden(true);
            }}>
            Hide this
          </Button>
        </div>
      </div>
    </Card>
  );
}
