import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { http, type Schemas } from '@/api/http';
import { useMe } from '@/auth';
import { formatDay, humanize } from '@/lib/format';
import { apparatusStatus } from '@/lib/labels';

import { Badge, Card, Empty, QueryState } from './ui';

type Board = Schemas['StationBoard'];
type Person = Schemas['RosterPerson'];

const POSITION: Record<string, string> = {
  chief: 'Shift chief',
  captain: 'Captain',
  lieutenant: 'Lieutenant',
  engineer: 'Engineer',
  firefighter: 'Firefighter',
  paramedic: 'Paramedic',
  emt: 'EMT',
};

const DUTY: Record<string, { label: string; tone: 'success' | 'neutral' }> = {
  on_duty: { label: 'On duty', tone: 'success' },
  covering: { label: 'On duty · trade', tone: 'success' },
  on_leave: { label: 'On leave', tone: 'neutral' },
  traded_off: { label: 'Traded off', tone: 'neutral' },
  off_duty: { label: 'Off duty', tone: 'neutral' },
};

/** The phone's Today screen: your seat, then a station's rigs and who rides them. */
export function StationBoard() {
  // Undefined means "where I work"; the server picks it.
  const [station, setStation] = useState<number | undefined>();
  const board = useQuery({
    queryKey: ['station-board', station ?? 'mine'],
    queryFn: () => http.get<Board>('/api/v1/station-board/', station ? { station } : undefined),
  });
  return <QueryState query={board}>{(b) => <BoardView board={b} onPickStation={setStation} />}</QueryState>;
}

function BoardView({ board, onPickStation }: { board: Board; onPickStation: (id: number) => void }) {
  const { me: user } = useMe();
  const { me, station } = board;
  const duty = DUTY[me.status] ?? DUTY.off_duty;
  const onDuty = board.apparatus.reduce((n, rig) => n + rig.crew.length, 0) + board.unassigned.length;

  return (
    <div className="stack">
      <Card className="me-card">
        <div className="stack-sm">
          <span className="muted small">{formatDay(board.date, { weekday: 'long' })}</span>
          <span className="me-name">{me.name}</span>
          <span>
            {me.platoon || me.station
              ? [me.platoon ? `${me.platoon} Shift` : null, me.station ? stationName(me.station) : null]
                  .filter(Boolean)
                  .join(' · ')
              : 'No shift assignment yet.'}
          </span>
          {me.position ? (
            <strong>
              {POSITION[me.position] ?? me.position}
              {me.apparatus_unit ? ` · riding ${me.apparatus_unit}` : ''}
            </strong>
          ) : null}
          {me.note ? <span className="muted small">{me.note}</span> : null}
        </div>
        <Badge tone={duty.tone}>{duty.label}</Badge>
      </Card>

      {board.stations.length > 1 ? (
        <div className="tabs" role="tablist" aria-label="Station">
          {board.stations.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === station?.id}
              className={`tab ${s.id === station?.id ? 'active' : ''}`}
              onClick={() => onPickStation(s.id)}>
              Station {s.number}
            </button>
          ))}
        </div>
      ) : null}

      {station ? (
        <section className="stack-sm">
          <h2>{stationName(station)}</h2>
          <p className="muted">
            {board.platoon ? `${board.platoon} Shift · ${onDuty} on duty` : 'No shift rotation set up'}
          </p>
          {board.shortfalls.length ? (
            <div className="alert" role="alert">
              <strong>Short staffed:</strong>{' '}
              {board.shortfalls.map((s) => `${s.description} (have ${s.scheduled})`).join(' · ')}
            </div>
          ) : null}
          {board.apparatus.length === 0 ? <Empty>No apparatus at this station.</Empty> : null}
          <div className="rig-grid">
            {board.apparatus.map((rig) => {
              const status = apparatusStatus[rig.status as keyof typeof apparatusStatus];
              return (
                <Link key={rig.id} to={`/apparatus/${rig.id}`} className="card card-link rig-card">
                  <div className="row spread">
                    <span>
                      <span className="rig-unit">{rig.unit_number}</span>{' '}
                      <span className="muted">{humanize(rig.apparatus_type)}</span>
                    </span>
                    {status && rig.status !== 'in_service' ? <Badge tone={status.tone}>{status.label}</Badge> : null}
                  </div>
                  {rig.visiting ? (
                    <span className="small tone-warning">
                      {[
                        rig.visiting.home_station_number
                          ? `From Station ${rig.visiting.home_station_number}`
                          : 'Visiting',
                        rig.visiting.covering_for_unit ? `covering for ${rig.visiting.covering_for_unit}` : null,
                        rig.visiting.until ? `through ${formatDay(rig.visiting.until)}` : 'until returned',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  ) : null}
                  {rig.crew.length === 0 ? (
                    <span className="muted small">Not staffed</span>
                  ) : (
                    rig.crew.map((p) => <CrewLine key={p.user} person={p} isMe={p.user === user.id} />)
                  )}
                </Link>
              );
            })}
          </div>
          {board.unassigned.length || board.away.length || board.on_leave.length || board.traded_off.length ? (
            <div className="grid-2">
              {board.unassigned.length ? (
                <Card className="stack-sm">
                  <strong className="muted">No rig assigned</strong>
                  {board.unassigned.map((p) => (
                    <CrewLine key={p.user} person={p} isMe={p.user === user.id} />
                  ))}
                </Card>
              ) : null}
              {board.away.length ? (
                <Card className="stack-sm">
                  <strong className="muted">Away today</strong>
                  {board.away.map((rig) => (
                    <Link key={rig.id} to={`/apparatus/${rig.id}`}>
                      {rig.unit_number} at Station {rig.station_number}
                      {rig.until ? ` through ${formatDay(rig.until)}` : ' until returned'}
                    </Link>
                  ))}
                </Card>
              ) : null}
              {board.on_leave.length || board.traded_off.length ? (
                <Card className="stack-sm">
                  <strong className="muted">Off this shift</strong>
                  {board.on_leave.map((p) => (
                    <span key={p.user}>{p.name} · on leave</span>
                  ))}
                  {board.traded_off.map((p) => (
                    <span key={p.user}>{p.name} · traded off</span>
                  ))}
                </Card>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function CrewLine({ person, isMe }: { person: Person; isMe: boolean }) {
  return (
    <div className="crew-line">
      <span className="muted small">{POSITION[person.position] ?? person.position}</span>
      <span>{withoutRank(person)}</span>
      <span className="row">
        {isMe ? <Badge tone="success">You</Badge> : null}
        {person.covering_for ? <Badge tone="warning">Trade</Badge> : null}
      </span>
    </div>
  );
}

/** "Captain Alex Smith" → "Alex Smith": the position column already says what they do. */
function withoutRank({ name, rank }: Person) {
  return rank && name.startsWith(`${rank} `) ? name.slice(rank.length + 1) : name;
}

function stationName(station: { number: string; name: string }) {
  return `Station ${station.number}${station.name ? ` · ${station.name}` : ''}`;
}
