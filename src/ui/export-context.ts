import type { Diagnostic, Project, SampleLibrary } from '../core/types';
import type { NbsTempoPreset } from '../core/nbs-export-timing';

export interface ExportOptions {
  format: 'nbs' | 'mid' | 'wav';
  nbsVersion: 4 | 5 | 6;
  nbsTempoPreset: NbsTempoPreset;
  nativeAudio: boolean;
}
export interface ExportContext extends ExportOptions {
  documentKey: number;
  project: Project;
  library?: SampleLibrary;
  open: boolean;
}
export interface ExportOwner { context: ExportContext; generation: number }
export interface ExportTicket { context: ExportContext; generation: number }
export interface PreparedExport extends ExportTicket { name: string; bytes: Uint8Array; diagnostics: Diagnostic[] }

function sameContext(a: ExportContext, b: ExportContext): boolean {
  return a.documentKey === b.documentKey && a.project === b.project && a.open === b.open && a.format === b.format
    && a.nbsVersion === b.nbsVersion && a.nbsTempoPreset === b.nbsTempoPreset && a.nativeAudio === b.nativeAudio
    && (a.format !== 'wav' || a.library === b.library);
}

/** Advance even when settings later return to an earlier value (A -> B -> A). */
export function syncExportOwner(owner: ExportOwner, context: ExportContext): void {
  if (!sameContext(owner.context, context)) owner.generation++;
  owner.context = context;
}

export function isCurrentExport(owner: ExportOwner, ticket: ExportTicket, project = owner.context.project, open = owner.context.open): boolean {
  return open && ticket.context.open && ticket.context.project === project && ticket.generation === owner.generation && sameContext(owner.context, ticket.context);
}
