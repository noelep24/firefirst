import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { api, unwrap } from '@/api/client';
import { Button, ErrorBox, Field, Label, QueryState, Row, Screen, Section } from '@/components/ui';
import { formatDay, isoDate, isValidIsoDate } from '@/lib/format';
import { useRig } from '@/lib/queries';

type Length = 'today' | 'tomorrow' | 'date' | 'open' | 'permanent';

const LENGTHS: { value: Length; label: string }[] = [
  { value: 'today', label: 'Today only' },
  { value: 'tomorrow', label: 'Through tomorrow' },
  { value: 'date', label: 'Until a date' },
  { value: 'open', label: 'Until returned' },
  { value: 'permanent', label: 'Permanently' },
];

export default function MoveRigScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const queryClient = useQueryClient();
  const rig = useRig(id);
  const stations = useQuery({
    queryKey: ['stations'],
    queryFn: () => unwrap(api().GET('/api/v1/stations/', { params: { query: { page_size: 100 } } })),
  });
  const [station, setStation] = useState<number | null>(null);
  const [length, setLength] = useState<Length>('today');
  const [until, setUntil] = useState(isoDate());
  const [crewMoves, setCrewMoves] = useState(false);
  const [coveringFor, setCoveringFor] = useState<number | null>(null);
  const [reason, setReason] = useState('');

  // Rigs at the destination that this one could cover for (e.g. a frontline engine in the shop).
  const destinationRigs = useQuery({
    queryKey: ['apparatus', { station }],
    queryFn: () => unwrap(api().GET('/api/v1/apparatus/', { params: { query: { station: station! } } })),
    enabled: station !== null && length !== 'permanent',
  });

  const temporary = length !== 'permanent';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const lastDay = { today: isoDate(), tomorrow: isoDate(tomorrow), date: until, open: null, permanent: null }[length];
  const dateOk = length !== 'date' || (isValidIsoDate(until) && until >= isoDate());

  const move = useMutation({
    mutationFn: () =>
      unwrap(
        api().POST('/api/v1/apparatus/{id}/move/', {
          params: { path: { id } },
          body: {
            station: station!,
            temporary,
            until: lastDay,
            crew_moves: crewMoves,
            covering_for: temporary ? coveringFor : null,
            reason,
          },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['apparatus', id], data);
      for (const key of ['apparatus', 'station-board', 'roster', 'dashboard'])
        queryClient.invalidateQueries({ queryKey: [key] });
      router.back();
    },
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: rig.data ? `Move ${rig.data.unit_number}` : 'Move rig' }} />
      <Section title="To">
        <QueryState query={stations}>
          {(stationsData) => (
            <Row>
              {stationsData.results
                // Its home station isn't a move: for a rig that's away, that's Return.
                .filter((s) => s.id !== rig.data?.station)
                .map((s) => (
                  <Button
                    key={s.id}
                    title={`Station ${s.number}`}
                    small
                    variant={station === s.id ? 'primary' : 'secondary'}
                    onPress={() => {
                      setStation(s.id);
                      setCoveringFor(null);
                    }}
                  />
                ))}
            </Row>
          )}
        </QueryState>
      </Section>

      <Section title="For how long">
        <Row>
          {LENGTHS.map((l) => (
            <Button
              key={l.value}
              title={l.label}
              small
              variant={length === l.value ? 'primary' : 'secondary'}
              onPress={() => setLength(l.value)}
            />
          ))}
        </Row>
        {length === 'date' ? (
          <Field
            label="Last day away"
            value={until}
            onChangeText={setUntil}
            placeholder="YYYY-MM-DD"
            autoCorrect={false}
            error={dateOk ? undefined : 'Use YYYY-MM-DD, today or later'}
          />
        ) : null}
        <Label type="small" color="textSecondary">
          {temporary
            ? lastDay
              ? `Back at its home station after ${formatDay(lastDay)}.`
              : 'Stays until an officer returns it.'
            : 'Changes its home station.'}
        </Label>
      </Section>

      {temporary && station !== null ? (
        <Section title="Covering for">
          <QueryState query={destinationRigs}>
            {(rigsData) => {
              // Rigs based there, minus any that are away today.
              const options = rigsData.results.filter(
                (r) => r.id !== id && (!r.current_move || r.current_move.station === station),
              );
              return options.length === 0 ? (
                <Label type="small" color="textSecondary">
                  No other rigs at that station.
                </Label>
              ) : (
                <Row>
                  <Button
                    title="Nothing"
                    small
                    variant={coveringFor === null ? 'primary' : 'secondary'}
                    onPress={() => setCoveringFor(null)}
                  />
                  {options.map((r) => (
                    <Button
                      key={r.id}
                      title={r.unit_number}
                      small
                      variant={coveringFor === r.id ? 'primary' : 'secondary'}
                      onPress={() => setCoveringFor(r.id)}
                    />
                  ))}
                </Row>
              );
            }}
          </QueryState>
          <Label type="small" color="textSecondary">
            {"The covered rig's crew rides this one meanwhile."}
          </Label>
        </Section>
      ) : null}

      <Section title="Crew">
        <Row>
          <Button
            title="Stays at station"
            small
            variant={crewMoves ? 'secondary' : 'primary'}
            onPress={() => setCrewMoves(false)}
          />
          <Button
            title="Moves with the rig"
            small
            variant={crewMoves ? 'primary' : 'secondary'}
            onPress={() => setCrewMoves(true)}
          />
        </Row>
        <Label type="small" color="textSecondary">
          {crewMoves
            ? 'Members assigned to ride this rig go with it.'
            : temporary
              ? 'Members assigned to ride this rig stay at their station without it.'
              : 'Members assigned to ride this rig stay at their station and are taken off it.'}
        </Label>
      </Section>

      {temporary ? (
        <Field label="Reason (optional)" value={reason} onChangeText={setReason} placeholder="e.g. E1 in the shop" />
      ) : null}

      {move.error ? <ErrorBox error={move.error} /> : null}
      <Button
        title="Move rig"
        onPress={() => move.mutate()}
        loading={move.isPending}
        disabled={station === null || !dateOk}
      />
    </Screen>
  );
}
