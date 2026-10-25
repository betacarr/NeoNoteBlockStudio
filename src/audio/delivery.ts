import type { NativeRenderRequest, Project } from '../core/types';
import facts from '../data/world-audio-facts.json';

export const worldAudioFacts = (profileId: string) => facts.profiles.find(profile => profile.id === profileId);
export function broadcastForProject(project: Project): NativeRenderRequest['broadcast'] {
  const profile = worldAudioFacts(project.audio.profileId);
  return project.audio.mode === 'vanilla' && profile ? { listenerPosition: [0, -profile.standingEyeHeight, 0], range: profile.broadcastRange } : undefined;
}
export function withinBroadcastRange(x: number, y: number, z: number, broadcast?: NativeRenderRequest['broadcast']): boolean {
  if (!broadcast) return true;
  const dx = x - broadcast.listenerPosition[0], dy = y - broadcast.listenerPosition[1], dz = z - broadcast.listenerPosition[2];
  return dx * dx + dy * dy + dz * dz < broadcast.range * broadcast.range;
}
