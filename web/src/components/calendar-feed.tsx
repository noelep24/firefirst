import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { useState } from 'react';

import { http, type Schemas } from '@/api/http';

import { Button, ErrorBox, Modal, QueryState } from './ui';

/** Sidebar button that shows the member's personal calendar subscription link. */
export function CalendarFeedButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button small variant="ghost" onClick={() => setOpen(true)}>
        <CalendarPlus size={16} aria-hidden="true" />
        Calendar feed
      </Button>
      {open ? <CalendarFeedModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function CalendarFeedModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const link = useQuery({
    queryKey: ['/api/v1/me/calendar-feed/'],
    queryFn: () => http.get<Schemas['CalendarLink']>('/api/v1/me/calendar-feed/'),
  });
  const regenerate = useMutation({
    mutationFn: () => http.post<Schemas['CalendarLink']>('/api/v1/me/calendar-feed/'),
    onSuccess: (data) => queryClient.setQueryData(['/api/v1/me/calendar-feed/'], data),
  });

  return (
    <Modal title="Your calendar feed" open onClose={onClose}>
      <QueryState query={link}>
        {(l) => (
          <div className="stack">
            <p>
              Subscribe to see your shifts (with leave and trades applied) and department events in Google, Apple or
              Outlook calendar. It updates automatically.
            </p>
            <div className="field">
              <label htmlFor="feed-url">Calendar link</label>
              <input id="feed-url" readOnly value={l.url} onFocus={(e) => e.target.select()} />
            </div>
            <div className="row">
              <Button
                variant="primary"
                onClick={async () => {
                  await navigator.clipboard.writeText(l.url);
                  setCopied(true);
                }}>
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <a className="btn btn-secondary" href={l.webcal_url}>
                Open in Apple Calendar / Outlook
              </a>
            </div>
            <p className="muted small">
              Google Calendar: Other calendars → + → From URL, then paste the link. Anyone with the link can see your
              schedule, so keep it private. If it gets out, make a new one:
            </p>
            <ErrorBox error={regenerate.error} />
            <div>
              <Button
                small
                variant="danger"
                loading={regenerate.isPending}
                onClick={() =>
                  window.confirm('Make a new link? The old one stops working everywhere you added it.') &&
                  regenerate.mutate()
                }>
                Replace link
              </Button>
            </div>
          </div>
        )}
      </QueryState>
    </Modal>
  );
}
