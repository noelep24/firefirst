import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { getAll, http, type Schemas } from '@/api/http';
import { CrudPage } from '@/components/crud';
import { Badge, Button, Card, DataTable, Empty, PageHeader, QueryState, Tabs } from '@/components/ui';
import { personLabel, stationLabel } from '@/lib/fields';
import { addDays, formatDay, isoDate, parseDate } from '@/lib/format';
import { labelFor, positions } from '@/lib/labels';

type Tab = 'calendar' | 'roster' | 'assignments' | 'rotation';

export default function Schedule() {
  const [tab, setTab] = useState<Tab>('calendar');
  return (
    <div>
      <PageHeader title="Schedule" subtitle="Shift rotation, daily roster and who rides where." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'calendar', label: 'Calendar' },
          { value: 'roster', label: 'Daily roster' },
          { value: 'assignments', label: 'Assignments' },
          { value: 'rotation', label: 'Platoons & rotation' },
        ]}
      />
      {tab === 'calendar' ? <MonthCalendar /> : null}
      {tab === 'roster' ? <Roster /> : null}
      {tab === 'assignments' ? <Assignments /> : null}
      {tab === 'rotation' ? <Rotation /> : null}
    </div>
  );
}

function usePlatoons() {
  return useQuery({ queryKey: ['/api/v1/platoons/'], queryFn: () => getAll<Schemas['Platoon']>('/api/v1/platoons/') });
}

function monthGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay()); // back to Sunday
  const days: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(isoDate(d));
  }
  // Drop a trailing week that's entirely next month.
  return days.slice(35).every((d) => parseDate(d).getMonth() !== month.getMonth()) ? days.slice(0, 35) : days;
}

function MonthCalendar() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const days = monthGrid(month);
  const start = days[0];
  const end = days[days.length - 1];

  const platoons = usePlatoons();
  const shifts = useQuery({
    queryKey: ['/api/v1/shift-calendar/', start, end],
    queryFn: () => http.get<Schemas['ShiftDay'][]>('/api/v1/shift-calendar/', { start, end }),
  });
  const events = useQuery({
    queryKey: ['/api/v1/events/', start, end],
    queryFn: () => getAll<Schemas['Event']>('/api/v1/events/', { start, end }),
  });
  const leave = useQuery({
    queryKey: ['/api/v1/leave-requests/', 'approved', start, end],
    queryFn: () => getAll<Schemas['LeaveRequest']>('/api/v1/leave-requests/', { status: 'approved', start, end }),
  });

  const platoonOn = new Map((shifts.data ?? []).map((d) => [d.date, d.platoon]));
  const colorOf = (code: string | null | undefined) => platoons.data?.find((p) => p.code === code)?.color ?? 'gray';
  const today = isoDate();

  const shift = (delta: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  return (
    <div className="stack-sm">
      <div className="row spread">
        <h2>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
        <div className="row">
          <Button small onClick={() => shift(-1)} aria-label="Previous month">
            ‹
          </Button>
          <Button
            small
            onClick={() => {
              const now = new Date();
              setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
            }}>
            Today
          </Button>
          <Button small onClick={() => shift(1)} aria-label="Next month">
            ›
          </Button>
        </div>
      </div>
      <div className="calendar" role="grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="calendar-head" role="columnheader">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const date = parseDate(day);
          const code = platoonOn.get(day);
          const dayEvents = (events.data ?? []).filter((e) => isoDate(new Date(e.starts_at)) === day);
          const off = (leave.data ?? []).filter((l) => l.start_date <= day && l.end_date >= day).length;
          return (
            <div
              key={day}
              role="gridcell"
              className={`calendar-day ${date.getMonth() !== month.getMonth() ? 'outside' : ''} ${day === today ? 'today' : ''}`}>
              <div className="row spread">
                <span className="day-number">{date.getDate()}</span>
                {code ? (
                  <span
                    className="platoon-chip"
                    style={{ background: colorOf(code), width: 22, height: 22, fontSize: '0.7rem' }}
                    title={`${code} Shift`}>
                    {code}
                  </span>
                ) : null}
              </div>
              {off ? <span className="muted small">{off} on leave</span> : null}
              {dayEvents.map((e) => (
                <button
                  key={e.id}
                  className="calendar-event"
                  onClick={() => navigate(`/events?open=${e.id}`)}
                  title={e.title}>
                  {e.is_mandatory ? '● ' : ''}
                  {e.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      {platoons.data?.length ? (
        <div className="row muted small">
          {platoons.data.map((p) => (
            <span key={p.id} className="row">
              <span className="platoon-chip" style={{ background: p.color, width: 16, height: 16 }} />{' '}
              {p.name || `${p.code} Shift`}
            </span>
          ))}
          <span>● mandatory event</span>
        </div>
      ) : null}
    </div>
  );
}

function Roster() {
  const [date, setDate] = useState(isoDate());
  const roster = useQuery({
    queryKey: ['/api/v1/roster/', date],
    queryFn: () => http.get<Schemas['Roster']>('/api/v1/roster/', { date }),
  });
  return (
    <div className="stack">
      <div className="toolbar">
        <Button small onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
          ‹
        </Button>
        <input type="date" aria-label="Date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <Button small onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
          ›
        </Button>
        <Button small variant="ghost" onClick={() => setDate(isoDate())}>
          Today
        </Button>
      </div>
      <QueryState query={roster}>
        {(r) => {
          if (!r.platoon) return <Empty>No shift rotation is set up yet. Add one under Platoons & rotation.</Empty>;
          const stations = new Map<string, Schemas['RosterPerson'][]>();
          for (const p of r.working) {
            const key = p.station_number ? `Station ${p.station_number}` : 'Unassigned';
            stations.set(key, [...(stations.get(key) ?? []), p]);
          }
          return (
            <>
              <h2>
                {formatDay(date, { weekday: 'long' })}: {r.platoon} Shift · {r.working.length} on duty
              </h2>
              <div className="grid-2">
                {[...stations.entries()].map(([station, people]) => (
                  <Card key={station}>
                    <div className="stack-sm">
                      <h3>{station}</h3>
                      {people.map((p) => (
                        <div key={p.user} className="row spread">
                          <span>
                            {p.name} {p.covering_for ? <Badge tone="warning">Trade</Badge> : null}
                          </span>
                          <span className="muted small">{labelFor(positions, p.position)}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
              {r.on_leave.length || r.traded_off.length ? (
                <Card>
                  <div className="stack-sm">
                    <h3>Off this shift</h3>
                    {r.on_leave.map((p) => (
                      <div key={p.user}>{p.name} · on leave</div>
                    ))}
                    {r.traded_off.map((p) => (
                      <div key={p.user}>{p.name} · traded off</div>
                    ))}
                  </div>
                </Card>
              ) : null}
            </>
          );
        }}
      </QueryState>
    </div>
  );
}

function Assignments() {
  const platoons = usePlatoons();
  return (
    <CrudPage<Schemas['Assignment']>
      header={false}
      title="Assignments"
      noun="assignment"
      endpoint="/api/v1/assignments/"
      search={false}
      filters={[
        {
          name: 'platoon',
          label: 'Platoon',
          options: (platoons.data ?? []).map((p) => ({ value: String(p.id), label: p.name || `${p.code} Shift` })),
        },
        { name: 'position', label: 'Position', options: positions },
      ]}
      fields={[
        {
          name: 'user',
          label: 'Member',
          type: 'relation',
          required: true,
          endpoint: '/api/v1/users/',
          query: { is_active: true },
          optionLabel: personLabel as (row: never) => string,
        },
        {
          name: 'platoon',
          label: 'Platoon',
          type: 'relation',
          required: true,
          endpoint: '/api/v1/platoons/',
          optionLabel: ((p: Schemas['Platoon']) => p.name || `${p.code} Shift`) as (row: never) => string,
        },
        {
          name: 'station',
          label: 'Station',
          type: 'relation',
          endpoint: '/api/v1/stations/',
          optionLabel: stationLabel as (row: never) => string,
        },
        { name: 'position', label: 'Position', type: 'select', options: positions, required: true },
      ]}
      defaults={{ position: 'firefighter' }}
      columns={[
        { header: 'Member', cell: (a) => <strong>{a.user_name}</strong> },
        {
          header: 'Platoon',
          cell: (a) => {
            const p = platoons.data?.find((x) => x.id === a.platoon);
            return p ? (
              <span className="row">
                <span
                  className="platoon-chip"
                  style={{ background: p.color, width: 20, height: 20, fontSize: '0.7rem' }}>
                  {p.code}
                </span>
                {p.name || `${p.code} Shift`}
              </span>
            ) : null;
          },
        },
        { header: 'Station', cell: (a) => a.station_name ?? '—' },
        { header: 'Position', cell: (a) => labelFor(positions, a.position) },
      ]}
    />
  );
}

function Rotation() {
  return (
    <div className="stack">
      <section className="stack-sm">
        <h2>Platoons</h2>
        <CrudPage<Schemas['Platoon']>
          header={false}
          title="Platoons"
          noun="platoon"
          endpoint="/api/v1/platoons/"
          search={false}
          fields={[
            {
              name: 'code',
              label: 'Code',
              type: 'text',
              required: true,
              placeholder: 'A',
              help: 'Used in the rotation sequence',
            },
            { name: 'name', label: 'Name', type: 'text', placeholder: 'A Shift' },
            { name: 'color', label: 'Calendar color', type: 'color' },
          ]}
          defaults={{ color: '#c62828' }}
          columns={[
            {
              header: 'Code',
              cell: (p) => (
                <span className="platoon-chip" style={{ background: p.color }}>
                  {p.code}
                </span>
              ),
            },
            { header: 'Name', cell: (p) => p.name || `${p.code} Shift` },
          ]}
        />
      </section>
      <section className="stack-sm">
        <h2>Rotation patterns</h2>
        <p className="muted small">
          The sequence lists which platoon works each day, starting on the anchor date. A 24/48 is <code>A, B, C</code>;
          a 48/96 is <code>A, A, B, B, C, C</code>. Only one pattern is active at a time.
        </p>
        <CrudPage<Schemas['RotationPattern']>
          header={false}
          title="Rotation patterns"
          noun="pattern"
          endpoint="/api/v1/rotation-patterns/"
          search={false}
          fields={[
            { name: 'name', label: 'Name', type: 'text', required: true, placeholder: '24/48' },
            {
              name: 'anchor_date',
              label: 'Anchor date',
              type: 'date',
              required: true,
              help: 'A day the first platoon in the sequence works',
            },
            { name: 'sequence', label: 'Sequence', type: 'text', required: true, placeholder: 'A, B, C', wide: true },
            { name: 'shift_start', label: 'Shift starts', type: 'time', required: true },
            { name: 'shift_hours', label: 'Shift length (hours)', type: 'number', step: '1', min: 1, required: true },
            { name: 'is_active', label: 'Active', type: 'checkbox' },
          ]}
          defaults={{ shift_start: '07:00', shift_hours: '24', is_active: true, anchor_date: isoDate() }}
          prepare={(body) => ({
            ...body,
            sequence: String(body.sequence ?? '')
              .split(/[\s,]+/)
              .map((s) => s.trim())
              .filter(Boolean),
          })}
          columns={[
            { header: 'Name', cell: (p) => <strong>{p.name}</strong> },
            {
              header: 'Sequence',
              cell: (p) => (Array.isArray(p.sequence) ? p.sequence.join(', ') : String(p.sequence)),
            },
            { header: 'Anchor', cell: (p) => formatDay(p.anchor_date, { year: 'numeric' }) },
            { header: 'Shift', cell: (p) => `${p.shift_start?.slice(0, 5)} · ${p.shift_hours}h` },
            { header: '', cell: (p) => (p.is_active ? <Badge tone="success">Active</Badge> : null) },
          ]}
        />
      </section>
      <PlatoonCounts />
    </div>
  );
}

function PlatoonCounts() {
  const assignments = useQuery({
    queryKey: ['/api/v1/assignments/'],
    queryFn: () => getAll<Schemas['Assignment']>('/api/v1/assignments/'),
  });
  const platoons = usePlatoons();
  return (
    <section className="stack-sm">
      <h2>Staffing by platoon</h2>
      <QueryState query={assignments}>
        {(rows) => (
          <DataTable
            rows={(platoons.data ?? []).map((p) => ({
              id: p.id,
              name: p.name || `${p.code} Shift`,
              count: rows.filter((a) => a.platoon === p.id).length,
            }))}
            empty="No platoons yet."
            columns={[
              { header: 'Platoon', cell: (r) => r.name },
              { header: 'Assigned members', cell: (r) => r.count, className: 'num' },
            ]}
          />
        )}
      </QueryState>
    </section>
  );
}
