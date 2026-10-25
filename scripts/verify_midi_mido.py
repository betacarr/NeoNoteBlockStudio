"""Independent readback of SMF input and editor output; no editor parser imported."""
import collections
import importlib.metadata
import json
import sys
from pathlib import Path
import mido


def read(path):
    file = mido.MidiFile(path, charset='latin1', clip=False)
    events, end_tick, channels = [], 0, collections.defaultdict(set)
    for track_index, track in enumerate(file.tracks):
        tick, port = 0, 0
        for order, message in enumerate(track):
            tick += message.time
            if message.type == 'midi_port':
                port = message.port
                continue  # routing is compared on the routed messages below
            if message.type in ('track_name', 'end_of_track'):
                continue
            event = message.dict()
            event.pop('time', None)
            if event['type'] == 'note_on' and event['velocity'] == 0:
                event['type'] = 'note_off'
            if not message.is_meta:
                event['port'] = port
                if hasattr(message, 'channel'):
                    channels[port].add(message.channel)
            events.append((tick, track_index, order, event))
        end_tick = max(end_tick, tick)
    events.sort(key=lambda event: event[:3])
    # At a tick, tempo/meter are global state: the final event takes effect.
    globals_by_type = {'set_tempo': {}, 'time_signature': {}}
    normal = []
    for tick, track, order, event in events:
        if event['type'] in globals_by_type:
            globals_by_type[event['type']][tick] = (tick, track, order, event)
        else:
            normal.append((tick, track, order, event))
    defaults = {'set_tempo': {'type': 'set_tempo', 'tempo': 500000}, 'time_signature': {'type': 'time_signature', 'numerator': 4, 'denominator': 4, 'clocks_per_click': 24, 'notated_32nd_notes_per_beat': 8}}
    for kind, values in globals_by_type.items():
        if 0 not in values:
            values[0] = (0, -1, -1, defaults[kind])
        normal.extend(values.values())
    semantic = collections.Counter(json.dumps({'tick': tick, **event}, sort_keys=True) for tick, _, _, event in normal)
    channel_order = collections.defaultdict(list)
    for tick, _, _, event in events:
        if 'channel' in event and 'port' in event:
            channel_order[(event['port'], event['channel'], tick)].append(event)
        elif event['type'] == 'sysex':
            for channel in channels[event['port']]:
                channel_order[(event['port'], channel, tick)].append(event)
    return file, semantic, dict(channel_order), end_tick


manifest = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
observations = []
for item in manifest['cases']:
    try:
        source, expected, source_order, source_end = read(item['input'])
        output, actual, output_order, output_end = read(item['output'])
        missing, added = expected - actual, actual - expected
        order_differences = [key for key in source_order.keys() | output_order.keys() if source_order.get(key) != output_order.get(key)]
        exact = source.ticks_per_beat == output.ticks_per_beat and not missing and not added and not order_differences and source_end == output_end
        counts = collections.Counter(json.loads(event)['type'] for event in expected.elements())
        observations.append({'id': item['id'], 'exact': exact, 'sourceFormat': source.type, 'exportedFormat': output.type, 'ppq': source.ticks_per_beat, 'sourceEndTick': source_end, 'exportedEndTick': output_end, 'messages': sum(expected.values()), 'messageTypes': dict(counts), 'missing': [json.loads(event) for event in list(missing.elements())[:6]], 'added': [json.loads(event) for event in list(added.elements())[:6]], 'orderDifferences': [list(key) for key in order_differences[:6]]})
    except Exception as error:
        observations.append({'id': item['id'], 'exact': False, 'error': str(error)})
report = {'oracle': 'mido', 'version': importlib.metadata.version('mido'), 'observations': observations, 'exact': all(item['exact'] for item in observations)}
Path(sys.argv[2]).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'cases': len(observations), 'exact': report['exact'], 'failures': [item for item in observations if not item['exact']]}))
sys.exit(0 if report['exact'] else 1)
