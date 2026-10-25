import type { MidiEvent } from 'midi-file';

export function cloneMidiEvent(event: MidiEvent): MidiEvent {
  const cloned = { ...event, deltaTime: 0 };
  delete (cloned as { running?: boolean }).running;
  if ('data' in cloned) cloned.data = Array.from(cloned.data);
  return cloned;
}

const channelTypes = new Set(['noteOn', 'noteOff', 'noteAftertouch', 'controller', 'programChange', 'channelAftertouch', 'pitchBend']);
export const isMidiChannelEvent = (event: MidiEvent): event is Extract<MidiEvent, { channel: number; running?: true }> => channelTypes.has(event.type);

// NBSX stores these messages as JSON. Validate numeric payloads before passing
// them to the binary writer; arbitrary metadata objects are not executable data.
export function validStoredMidiMessage(value: unknown): value is MidiEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  const integer = (key: string, min: number, max: number) => typeof event[key] === 'number' && Number.isInteger(event[key]) && (event[key] as number) >= min && (event[key] as number) <= max;
  if (event.deltaTime !== 0 || typeof event.type !== 'string') return false;
  if (channelTypes.has(event.type) && !integer('channel', 0, 15)) return false;
  switch (event.type) {
    case 'controller': return integer('controllerType', 0, 127) && integer('value', 0, 127);
    case 'programChange': return integer('programNumber', 0, 127);
    case 'pitchBend': return integer('value', -8192, 8191);
    case 'noteAftertouch': return integer('noteNumber', 0, 127) && integer('amount', 0, 127);
    case 'channelAftertouch': return integer('amount', 0, 127);
    case 'noteOn': return false; // musical notes have their own records
    case 'noteOff': return integer('noteNumber', 0, 127) && integer('velocity', 0, 127); // unpaired safety releases
    case 'text': case 'copyrightNotice': case 'trackName': case 'instrumentName': case 'lyrics': case 'marker': case 'cuePoint':
      return typeof event.text === 'string' && event.text.length <= 64 * 1024 * 1024 && [...event.text].every(c => c.charCodeAt(0) <= 255);
    case 'sysEx': case 'endSysEx': case 'sequencerSpecific': case 'unknownMeta':
      return (event.type !== 'unknownMeta' || integer('metatypeByte', 0, 127)) && Array.isArray(event.data) && event.data.length <= 64 * 1024 * 1024 && event.data.every(n => Number.isInteger(n) && n >= 0 && n <= 255);
    case 'sequenceNumber': return integer('number', 0, 65535);
    case 'channelPrefix': return integer('channel', 0, 15);
    case 'portPrefix': return integer('port', 0, 255);
    case 'endOfTrack': return true;
    case 'keySignature': return integer('key', -7, 7) && integer('scale', 0, 1);
    case 'setTempo': return integer('microsecondsPerBeat', 1, 0xffffff);
    case 'timeSignature': return integer('numerator', 1, 255) && integer('denominator', 1, 32768) && Math.log2(event.denominator as number) % 1 === 0 && integer('metronome', 0, 255) && integer('thirtyseconds', 0, 255);
    case 'smpteOffset': return [24, 25, 29, 30].includes(event.frameRate as number) && integer('hour', 0, 23) && integer('min', 0, 59) && integer('sec', 0, 59) && integer('frame', 0, 29) && integer('subFrame', 0, 99);
    default: return false;
  }
}
