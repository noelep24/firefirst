import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { getAll, http, type Schemas } from '@/api/http';
import { CrudPage, RecordModal } from '@/components/crud';
import type { FieldSpec } from '@/components/form';
import { Badge, Button, Card, DataTable, Empty, ErrorBox, PageHeader, QueryState, Tabs } from '@/components/ui';
import { personLabel, stationLabel } from '@/lib/fields';
import { addDays, formatDateTime, formatDay, isoDate, parseDate } from '@/lib/format';
import { labelFor, positions } from '@/lib/labels';

type Tab = 'calendar' | 'roster' | 'overtime' | 'assignments';

export default function Schedule() {
  const [params] = useSearchParams();
  // Notifications about overtime link straight to its tab.
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'overtime' ? 'overtime' : 'calendar');
  return (
    <div>
      <PageHeader title="Schedule" subtitle="Shift rotation, daily roster and who rides where." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'calendar', label: 'Calendar' },
          { value: 'roster', label: 'Daily roster' },
          { value: 'overtime', label: 'Overtime list' },
          { value: 'assignments', label: 'Assignments' },
        ]}
      />
      {tab === 'calendar' ? <MonthCalendar /> : null}
      {tab === 'roster' ? <Roster /> : null}
      {tab === 'overtime' ? <Overtime /> : null}
      {tab === 'assignments' ? <Assignments /> : null}
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
  const staffing = useQuery({
    queryKey: ['/api/v1/staffing/', start, end],
    queryFn: () => http.get<Schemas['StaffingDay'][]>('/api/v1/staffing/', { start, end }),
  });
  const shortOn = new Map((staffing.data ?? []).map((d) => [d.date, d.shortfalls]));

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
              {shortOn.get(day) ? (
                <span
                  className="tone-danger small"
                  title={shortOn
                    .get(day)!
                    .map((s) => s.description)
                    .join('\n')}>
                  ▲ Short staffed
                </span>
              ) : null}
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
              {r.shortfalls.length ? (
                <div className="alert" role="alert">
                  <strong>Short staffed:</strong>
                  {r.shortfalls.map((s) => (
                    <div key={s.rule}>
                      {s.description} (have {s.scheduled})
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="grid-2">
                {[...stations.entries()].map(([station, people]) => (
                  <Card key={station}>
                    <div className="stack-sm">
                      <h3>{station}</h3>
                      {people.map((p) => (
                        <div key={p.user} className="row spread">
                          <span>
                            {p.name} {p.covering_for ? <Badge tone="warning">Trade</Badge> : null}
                            {p.overtime ? <Badge tone="warning">OT</Badge> : null}
                          </span>
                          <span className="muted small">
                            {labelFor(positions, p.position)}
                            {p.apparatus_unit ? ` · ${p.apparatus_unit}` : ''}
                          </span>
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
        {
          name: 'apparatus',
          label: 'Rides',
          type: 'relation',
          endpoint: '/api/v1/apparatus/',
          optionLabel: ((a: Schemas['Apparatus']) => a.unit_number) as (row: never) => string,
          help: 'The rig this member is assigned to ride',
        },
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
        { header: 'Rides', cell: (a) => a.apparatus_unit ?? '—' },
      ]}
    />
  );
}

/** Platoons and the rotation they work. Shown in Settings › Scheduling. */
export function Rotation() {
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

/** Minimum staffing per station and position. Shown in Settings › Scheduling. */
export function StaffingRules() {
  return (
    <div className="stack-sm">
      <p className="muted small">
        Minimums for every shift. Leave or trades that would break one are flagged on the roster, the calendar and the
        approvals page. A rule can count everyone, a position, or members holding a certification.
      </p>
      <CrudPage<Schemas['StaffingRule']>
        header={false}
        title="Staffing rules"
        noun="rule"
        endpoint="/api/v1/staffing-rules/"
        search={false}
        fields={[
          {
            name: 'station',
            label: 'Station',
            type: 'relation',
            endpoint: '/api/v1/stations/',
            optionLabel: stationLabel as (row: never) => string,
            help: 'Blank for department-wide',
          },
          { name: 'minimum', label: 'At least', type: 'number', step: '1', min: 1, required: true },
          { name: 'position', label: 'Position', type: 'select', options: positions, help: 'Blank counts anyone' },
          {
            name: 'certification_type',
            label: 'Holding certification',
            type: 'relation',
            endpoint: '/api/v1/certification-types/',
            optionLabel: ((t: Schemas['CertificationType']) => t.name) as (row: never) => string,
          },
        ]}
        defaults={{ minimum: '1' }}
        columns={[{ header: 'Rule', cell: (r) => <strong>{r.description}</strong> }]}
      />
    </div>
  );
}

const OT_STATUS: Record<string, { label: string; tone: 'success' | 'neutral' | 'warning' }> = {
  available: { label: 'Available', tone: 'success' },
  on_duty: { label: 'On duty', tone: 'neutral' },
  on_leave: { label: 'On leave', tone: 'neutral' },
  overtime: { label: 'On overtime', tone: 'warning' },
};

const overtimeFields: FieldSpec[] = [
  {
    name: 'user',
    label: 'Member',
    type: 'relation',
    required: true,
    endpoint: '/api/v1/users/',
    query: { is_active: true },
    optionLabel: personLabel as (row: never) => string,
  },
  { name: 'date', label: 'Date', type: 'date', required: true },
  { name: 'hours', label: 'Hours', type: 'number', step: '0.25', min: 0, required: true },
  {
    name: 'filling_for',
    label: 'Filling the seat of',
    type: 'relation',
    endpoint: '/api/v1/users/',
    query: { is_active: true },
    optionLabel: personLabel as (row: never) => string,
    help: 'They ride that member’s seat on the roster for the day',
  },
  {
    name: 'station',
    label: 'Station',
    type: 'relation',
    endpoint: '/api/v1/stations/',
    optionLabel: stationLabel as (row: never) => string,
    help: 'Only when not filling a particular seat',
  },
  { name: 'mandatory', label: 'Mandatory (forced off the list)', type: 'checkbox' },
  { name: 'note', label: 'Note', type: 'text', wide: true },
];

/** The rolling mandatory overtime lists: whoever worked overtime longest ago is up first. */
function Overtime() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(isoDate());
  const [hiring, setHiring] = useState<{ user?: number } | null>(null);
  const [editing, setEditing] = useState<Schemas['OvertimeShift'] | null>(null);
  const board = useQuery({
    queryKey: ['/api/v1/overtime-list/', date],
    queryFn: () => http.get<Schemas['OvertimeBoard']>('/api/v1/overtime-list/', { date }),
  });
  // The day's hires, so a mistake can be fixed right from the list.
  const hired = useQuery({
    queryKey: ['/api/v1/overtime-shifts/', { date }],
    queryFn: () => getAll<Schemas['OvertimeShift']>('/api/v1/overtime-shifts/', { date }),
  });
  const shiftFor = (user: number) => hired.data?.find((o) => o.user === user);
  const saved = () => {
    queryClient.invalidateQueries();
    setHiring(null);
    setEditing(null);
  };

  return (
    <div className="stack">
      <p className="muted">
        Captains and engineers fill each other's seats; firefighters and medics fill each other's. Whoever worked
        overtime longest ago (or never) is at the top, and working an overtime shift sends them to the bottom.
      </p>
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
        <span className="muted">
          {formatDay(date, { weekday: 'long' })}
          {board.data?.platoon ? ` · ${board.data.platoon} Shift on duty` : ''}
        </span>
      </div>
      <Vacancies date={date} />
      <QueryState query={hired}>
        {(shifts) =>
          shifts.length ? (
            <Card className="stack-sm">
              <h3>Hired for {formatDay(date, { weekday: 'long' })}</h3>
              {shifts.map((o) => (
                <div key={o.id} className="row spread">
                  <span>
                    <strong>{o.user_name}</strong>
                    <span className="muted">
                      {' '}
                      · {Number(o.hours)} h{o.filling_for_name ? ` · filling for ${o.filling_for_name}` : ''}
                      {!o.filling_for_name && o.station_name ? ` · ${o.station_name}` : ''}
                    </span>{' '}
                    {o.mandatory ? <Badge tone="warning">Mandatory</Badge> : <Badge>Voluntary</Badge>}
                  </span>
                  <Button small onClick={() => setEditing(o)}>
                    Change or remove
                  </Button>
                </div>
              ))}
            </Card>
          ) : null
        }
      </QueryState>
      <QueryState query={board}>
        {(b) => (
          <div className="grid-2">
            {b.lists.map((list) => (
              <Card key={list.key} className="stack-sm">
                <h3>{list.label}</h3>
                {list.members.length === 0 ? <Empty>No one assigned to these positions.</Empty> : null}
                {list.members.map((m, i) => {
                  const status = OT_STATUS[m.status];
                  const next = m.user === list.next_up;
                  return (
                    <div key={m.user} className={`ot-row ${next ? 'ot-next' : ''}`}>
                      <span className="ot-rank">{i + 1}</span>
                      <span className="stack-sm" style={{ gap: 0 }}>
                        <strong>{m.name}</strong>
                        <span className="muted small">
                          {labelFor(positions, m.position)} · {m.platoon} Shift
                          {m.station_number ? ` · Station ${m.station_number}` : ''} · last OT{' '}
                          {m.last_overtime ? formatDay(m.last_overtime) : 'never'}
                        </span>
                      </span>
                      <span className="row">
                        {next ? <Badge tone="danger">Next up</Badge> : <Badge tone={status.tone}>{status.label}</Badge>}
                        {m.status === 'available' ? (
                          <Button
                            small
                            variant={next ? 'primary' : 'secondary'}
                            onClick={() => setHiring({ user: m.user })}>
                            Hire
                          </Button>
                        ) : null}
                        {m.status === 'overtime' && shiftFor(m.user) ? (
                          <Button small onClick={() => setEditing(shiftFor(m.user)!)}>
                            Change
                          </Button>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </Card>
            ))}
          </div>
        )}
      </QueryState>

      <CrudPage<Schemas['OvertimeShift']>
        header={false}
        title="Overtime worked"
        noun="overtime shift"
        endpoint="/api/v1/overtime-shifts/"
        search={false}
        fields={overtimeFields}
        defaults={{ date, hours: 24, mandatory: true }}
        columns={[
          { header: 'Date', cell: (o) => formatDay(o.date) },
          { header: 'Member', cell: (o) => <strong>{o.user_name}</strong> },
          { header: 'Hours', cell: (o) => Number(o.hours) },
          { header: 'Filling for', cell: (o) => o.filling_for_name ?? o.station_name ?? '—' },
          {
            header: '',
            cell: (o) => (o.mandatory ? <Badge tone="warning">Mandatory</Badge> : <Badge>Voluntary</Badge>),
          },
          { header: '', cell: () => <span className="muted small">Edit ›</span> },
        ]}
      />

      {hiring ? (
        <RecordModal<Schemas['OvertimeShift']>
          title="Record overtime"
          endpoint="/api/v1/overtime-shifts/"
          fields={overtimeFields}
          record={null}
          defaults={{ user: hiring.user, date, hours: 24, mandatory: true }}
          onClose={() => setHiring(null)}
          onSaved={saved}
        />
      ) : null}
      {editing ? (
        <RecordModal<Schemas['OvertimeShift']>
          title="Change overtime"
          endpoint="/api/v1/overtime-shifts/"
          fields={overtimeFields}
          record={editing}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      ) : null}
    </div>
  );
}

type Vacancy = Schemas['Vacancy'];

const vacancyFields: FieldSpec[] = [
  { name: 'date', label: 'Date', type: 'date', required: true },
  {
    name: 'filling_for',
    label: 'Whose seat is empty',
    type: 'relation',
    endpoint: '/api/v1/users/',
    query: { is_active: true },
    optionLabel: personLabel as (row: never) => string,
    help: 'Sets the list, position and station for you',
  },
  {
    name: 'overtime_list',
    label: 'Overtime list',
    type: 'select',
    options: [
      { value: 'officers', label: 'Captains & engineers' },
      { value: 'firefighters', label: 'Firefighters & medics' },
    ],
    help: 'Only when no one’s seat is named',
  },
  {
    name: 'station',
    label: 'Station',
    type: 'relation',
    endpoint: '/api/v1/stations/',
    optionLabel: stationLabel as (row: never) => string,
  },
  { name: 'hours', label: 'Hours', type: 'number', step: '0.25', min: 0, required: true },
  { name: 'note', label: 'Note', type: 'text', wide: true },
];

const OFFER_STATUS: Record<string, { label: string; tone: 'success' | 'neutral' | 'warning' | 'danger' }> = {
  pending: { label: 'Waiting', tone: 'neutral' },
  accepted: { label: 'Volunteered', tone: 'success' },
  declined: { label: 'Turned down', tone: 'neutral' },
  expired: { label: 'No answer', tone: 'neutral' },
  withdrawn: { label: 'Not needed', tone: 'neutral' },
};

/** Seats being filled automatically: open ones on any day, plus everything on the day shown. */
function Vacancies({ date }: { date: string }) {
  const [posting, setPosting] = useState(false);
  const queryClient = useQueryClient();
  const open = useQuery({
    queryKey: ['/api/v1/vacancies/', { open: true }],
    queryFn: () => getAll<Vacancy>('/api/v1/vacancies/', { open: true }),
    refetchInterval: 60_000,
  });
  const onDay = useQuery({
    queryKey: ['/api/v1/vacancies/', { date }],
    queryFn: () => getAll<Vacancy>('/api/v1/vacancies/', { date }),
  });
  const rows = [...(open.data ?? [])];
  for (const v of onDay.data ?? []) if (!rows.some((r) => r.id === v.id) && v.status !== 'cancelled') rows.push(v);
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  return (
    <Card className="stack-sm">
      <div className="row spread">
        <div>
          <h3>Vacancies</h3>
          <p className="muted small">Offered to volunteers, then filled from the list automatically.</p>
        </div>
        <Button small variant="primary" onClick={() => setPosting(true)}>
          Post a vacancy
        </Button>
      </div>
      {open.error ? <ErrorBox error={open.error} /> : null}
      {rows.length === 0 && open.data ? <p className="muted">No open vacancies.</p> : null}
      {rows.map((v) => (
        <VacancyRow key={v.id} vacancy={v} />
      ))}
      {posting ? (
        <RecordModal<Vacancy>
          title="Post a vacancy"
          endpoint="/api/v1/vacancies/"
          fields={vacancyFields}
          record={null}
          defaults={{ date, hours: 24 }}
          onClose={() => setPosting(false)}
          onSaved={() => {
            setPosting(false);
            queryClient.invalidateQueries();
          }}
        />
      ) : null}
    </Card>
  );
}

function VacancyRow({ vacancy: v }: { vacancy: Vacancy }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: object }) =>
      http.post<Vacancy>(`/api/v1/vacancies/${v.id}/${path}/`, body ?? {}),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const answered = v.offers.filter((o) => o.status !== 'pending').length;
  const volunteers = v.offers.filter((o) => o.status === 'accepted');
  const live = v.status === 'offered' || v.status === 'unfilled';

  let summary: string;
  if (v.status === 'offered') {
    summary = `${answered} of ${v.offers.length} answered · ${volunteers.length} volunteered`;
    if (v.respond_by) summary += ` · closes ${formatDateTime(v.respond_by)}`;
  } else if (v.status === 'filled') {
    summary = `Filled by ${v.hired_name}${v.hired_mandatory ? ' (mandatory)' : ' (volunteered)'}`;
  } else if (v.status === 'unfilled') {
    summary = 'No one available on the list';
  } else {
    summary = 'Cancelled';
  }
  const tone = v.status === 'unfilled' ? 'danger' : v.status === 'offered' ? 'warning' : 'success';

  return (
    <div className="vacancy">
      <div className="row spread">
        <div className="stack-sm" style={{ gap: 2 }}>
          <strong>
            {formatDay(v.date)} · {v.description}
          </strong>
          <span className="row small">
            <Badge tone={v.status === 'cancelled' ? 'neutral' : tone}>{summary}</Badge>
          </span>
        </div>
        <div className="row">
          {v.offers.length ? (
            <Button small variant="ghost" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
              {expanded ? 'Hide answers' : 'Answers'}
            </Button>
          ) : null}
          {live ? (
            <>
              <Button small loading={act.isPending} onClick={() => act.mutate({ path: 'fill-now' })}>
                {v.status === 'unfilled' ? 'Try again' : 'Fill now'}
              </Button>
              <Button
                small
                variant="ghost"
                onClick={() =>
                  window.confirm('Cancel this vacancy? Anyone offered it is told.') && act.mutate({ path: 'cancel' })
                }>
                Cancel
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {act.error ? <ErrorBox error={act.error} /> : null}
      {expanded ? (
        <div className="vacancy-offers">
          {v.offers.map((o) => {
            const status = OFFER_STATUS[o.status];
            return (
              <div key={o.id} className="row spread">
                <span>{o.user_name}</span>
                <span className="row">
                  <Badge tone={status.tone}>{status.label}</Badge>
                  {v.status === 'offered' && o.status === 'accepted' ? (
                    <Button small onClick={() => act.mutate({ path: 'hire', body: { user: o.user } })}>
                      Hire now
                    </Button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
