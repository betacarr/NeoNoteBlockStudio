import { audioFacts } from './profiles';
import legacyFacts from '../data/legacy-audio-facts.json';

const f = Math.fround;
// For fixed bounds [0, 1], this preserves the original Java clamp's input
// negative zero and NaN. JS Math.max changes -0; Math.min canonicalizes NaN.
const unit = (value: number) => value < 0 ? 0 : value > 1 ? 1 : value;
const pitchRange = (value: number) => value < .5 ? .5 : value > 2 ? 2 : value;
interface LegacySoundRules {
  volumeRule?: 'clamp-before-global-setting';
  soundEventArithmetic?: 'double-event-scalars' | 'float-event-scalars';
  categoryVolumeOrder?: 'float-after-double-instance-event-clamp';
  pitchTransport?: { kind: 'unsigned-byte'; scale: number; minimum: number; maximum: number; overflow?: 'wrap' };
}
const legacyRules = (profileId: string) => legacyFacts.profiles.find(profile => profile.id === profileId) as LegacySoundRules | undefined;

/** Original SoundEngine event pitch composition after any network transport. */
export function gameEventPitchParameters(profileId: string, instancePitch: number, eventPitch = 1): number {
  const pitch = f(instancePitch);
  return legacyRules(profileId)?.soundEventArithmetic === 'double-event-scalars'
    ? f(pitchRange(pitch * eventPitch))
    : pitchRange(f(pitch * f(eventPitch)));
}

/** Note-block pitch is a Java float before packet transport and event composition. */
export function gamePitchParameters(profileId: string, instancePitch: number, eventPitch = 1): number {
  const rules = legacyRules(profileId);
  let pitch = f(instancePitch);
  if (rules?.pitchTransport) {
    const { scale, minimum, maximum } = rules.pitchTransport, scaled = f(pitch * scale);
    // A Java float-to-int conversion truncates, saturates infinities and maps NaN to zero.
    const integer = Number.isNaN(scaled) ? 0 : Math.max(-2147483648, Math.min(2147483647, Math.trunc(scaled)));
    const encoded = rules.pitchTransport.overflow === 'wrap' ? integer & 255 : Math.max(minimum, Math.min(maximum, integer));
    pitch = f(encoded / scale);
  }
  return gameEventPitchParameters(profileId, pitch, eventPitch);
}

/** Original Java float operation order, before the native mixer sees a source. */
export function gameVolumeParameters(profileId: string, volume: number, master: number, category = 1, eventVolume = 1) {
  const instance = f(volume), categoryGain = f(category), masterGain = f(master);
  const rules = legacyRules(profileId);
  if (rules?.volumeRule === 'clamp-before-global-setting') {
    // Before categories/JSON events, SoundManager clamps the instance before
    // multiplying the global sound setting. Library.setVolume clamps that
    // product again; the original listener gain stays at its default unity.
    return { gain: unit(f(unit(instance) * masterGain)), listenerGain: 1 };
  }
  if (rules?.soundEventArithmetic === 'double-event-scalars') {
    const gain = rules.categoryVolumeOrder === 'float-after-double-instance-event-clamp'
      ? f(f(unit(instance * eventVolume)) * categoryGain)
      : f(unit(instance * eventVolume * categoryGain));
    return { gain, listenerGain: masterGain };
  }
  const source = eventVolume === 1 ? instance : f(instance * f(eventVolume));
  if (audioFacts(profileId)?.masterVolumePlacement === 'source') {
    // Since 1.21.9 Options combines category/master first; SoundEngine clamps
    // the instance independently, with no master gain on the OpenAL listener.
    return { gain: f(unit(source) * unit(f(categoryGain * masterGain))), listenerGain: 1 };
  }
  return { gain: unit(f(source * categoryGain)), listenerGain: masterGain };
}
