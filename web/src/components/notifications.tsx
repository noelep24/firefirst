import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { http, type Schemas } from '@/api/http';
import { formatDateTime } from '@/lib/format';

import { Button } from './ui';

type Page = { results: Schemas['Notification'][] };

/** The bell in the top bar: what FireFirst has told you lately, like vacancies that couldn't be filled. */
export function NotificationsBell() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const list = useQuery({
    queryKey: ['/api/v1/notifications/'],
    queryFn: () => http.get<Page>('/api/v1/notifications/', { page_size: 15 }),
    refetchInterval: 60_000,
  });
  const done = () => queryClient.invalidateQueries({ queryKey: ['/api/v1/notifications/'] });
  const read = useMutation({
    mutationFn: (id: number) => http.post(`/api/v1/notifications/${id}/read/`, {}),
    onSuccess: done,
  });
  const readAll = useMutation({ mutationFn: () => http.post('/api/v1/notifications/read-all/', {}), onSuccess: done });
  const rows = list.data?.results ?? [];
  const unread = rows.filter((n) => !n.read_at).length;

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="icon-button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
        <Bell size={20} aria-hidden="true" />
        {unread ? <span className="bell-count">{unread}</span> : null}
      </button>
      {open ? (
        <div className="user-popover notifications-popover">
          <div className="row spread">
            <strong>Notifications</strong>
            {unread ? (
              <Button small variant="ghost" onClick={() => readAll.mutate()}>
                Mark all read
              </Button>
            ) : null}
          </div>
          {rows.length === 0 ? <p className="muted small">Nothing yet.</p> : null}
          {rows.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`notification ${n.read_at ? '' : 'unread'}`}
              onClick={() => {
                if (!n.read_at) read.mutate(n.id);
                setOpen(false);
                if (n.link) navigate(n.link);
              }}>
              <span className="notification-title">{n.title}</span>
              {n.body ? <span className="muted small">{n.body}</span> : null}
              <span className="muted small">{formatDateTime(n.created_at)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
