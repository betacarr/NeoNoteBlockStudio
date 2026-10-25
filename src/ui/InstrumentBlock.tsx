import type { CSSProperties } from 'react';
import { instrumentBlock, type InstrumentBlockKey } from '../core/instrument-blocks';

interface Props {
  instrumentId: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
  label?: string;
  /** Use only when adjacent accessible text already identifies the material. */
  decorative?: boolean;
}

type Palette = readonly [top: string, left: string, right: string, detail: string, highlight: string];
const palettes: Record<InstrumentBlockKey, Palette> = {
  dirt: ['#ac7c53', '#90603e', '#70482f', '#493829', '#cfaa7a'],
  oak_planks: ['#d8b875', '#b38b50', '#97713f', '#6a4b29', '#f0d295'],
  stone: ['#a3a7ad', '#82878d', '#686f77', '#4e565e', '#d0d3d7'],
  sand: ['#eedba0', '#d9c184', '#bba66d', '#9c875a', '#fff0c2'],
  glass: ['#a9dce2', '#86c9d6', '#5c9ead', '#acdfe9', '#edffff'],
  white_wool: ['#f2eee5', '#d8d5cb', '#b9b8b1', '#8e918e', '#ffffff'],
  clay: ['#b6c3d2', '#94a3b8', '#788ba4', '#657b98', '#d2dbe4'],
  gold_block: ['#ffdf69', '#e7b83b', '#bf8c20', '#9a6814', '#fff4b6'],
  packed_ice: ['#aad0f4', '#79aee1', '#548ac4', '#3c76b0', '#e5f7ff'],
  bone_block: ['#f3ebcd', '#d9cfac', '#bcb28c', '#9c9274', '#fff9e5'],
  iron_block: ['#e7edf0', '#c1cbd1', '#97a4ad', '#6b7e8a', '#ffffff'],
  soul_sand: ['#80634f', '#654b3d', '#4e3a31', '#302a26', '#ab8670'],
  pumpkin: ['#eab04a', '#cf8029', '#a65c1b', '#7d4a20', '#ffd573'],
  emerald_block: ['#68e5ab', '#2bbb7b', '#159361', '#08704b', '#bdffe1'],
  hay_block: ['#e2cb65', '#c7a83e', '#a58b2f', '#7d6523', '#f8e99a'],
  glowstone: ['#f4d88d', '#c59f56', '#a37b40', '#77552c', '#fff6cf'],
  copper_block: ['#df9a70', '#c37a54', '#a85e40', '#79452f', '#ffd2a7'],
  exposed_copper: ['#bd9b77', '#a27e5f', '#866c50', '#576651', '#e5c69c'],
  weathered_copper: ['#73ad8d', '#548b71', '#40735e', '#375c49', '#aad0ac'],
  oxidized_copper: ['#71c5b1', '#4ca591', '#348a78', '#24695d', '#b2e4d0'],
  note_block: ['#bd8752', '#966336', '#774a29', '#412d20', '#e6b578'],
};

/** All marks below are original, simplified material cues drawn on a 16-unit face. */
function Material({ kind, top }: { kind: InstrumentBlockKey; top: boolean }) {
  const [, , , detail, light] = palettes[kind];
  switch (kind) {
    case 'dirt': return <>
      <path fill={detail} opacity=".52" d="M1 2h4v2H1zM9 1h3v2H9zM5 7h3v3H5zM12 6h3v2h-3zM1 12h3v3H1zM10 12h4v2h-4z" />
      <path fill={light} opacity=".65" d="M2 7h2v2H2zM8 4h2v2H8zM9 10h2v2H9zM5 13h2v2H5zM13 2h2v2h-2z" />
    </>;
    case 'oak_planks': return <>
      <path stroke={detail} strokeWidth=".8" d="M0 4h16M0 8h16M0 12h16M5 0v4M12 4v4M4 8v4M11 12v4" />
      <path stroke={light} strokeWidth=".6" opacity=".7" d="M1 1.4h10M1 5.4h6M7 9.4h8M1 13.4h8" />
      <path stroke={detail} strokeWidth=".55" opacity=".45" d="M7 2.8h6M2 6.8h7M1 10.7h7M12 14.7h3" />
    </>;
    case 'stone': return <>
      <path fill={detail} opacity=".28" d="m1 3 4-2 3 2-1 3-5 1zm9 5 5 1v4l-5 2-2-4zM1 11l5-2 1 5-6 1z" />
      <path fill={light} opacity=".32" d="M9 1h6v3h-4v2H8zM2 8h5v2H2zM9 13h5v2H9z" />
      <path stroke={detail} opacity=".48" strokeWidth=".6" d="m1 3 4-1M9 7l5-1M2 13h3" />
    </>;
    case 'sand': return <>
      <path fill={detail} opacity=".47" d="M2 2h2v1H2zM9 3h3v1H9zM5 6h2v1H5zM12 8h2v1h-2zM2 11h3v1H2zM8 13h2v1H8zM13 13h1v1h-1z" />
      <path fill={light} opacity=".8" d="M1 6h2v1H1zM6 2h2v1H6zM10 10h2v1h-2zM5 14h2v1H5zM13 5h2v1h-2z" />
    </>;
    case 'glass': return <>
      <path fill="none" stroke={light} strokeWidth=".8" d="M1 1h14v14H1z" />
      <path stroke={light} strokeWidth="1.1" opacity=".9" d="m3 10 7-7M5 13l8-8" />
      <path stroke={detail} strokeWidth=".5" d="M2 14h12V2" />
    </>;
    case 'white_wool': return <>
      <path fill="none" stroke={detail} strokeWidth=".8" opacity=".4" d="M1 4h3V2h3v2h3V2h3v2h2M0 9h2V7h3v2h3V7h3v2h3V7h2M1 14h3v-2h3v2h3v-2h3v2h2" />
      <path fill={light} opacity=".6" d="M1 5h3v1H1zM7 5h3v1H7zM4 10h3v1H4zM10 10h3v1h-3z" />
    </>;
    case 'clay': return <>
      <path fill={light} opacity=".28" d="M1 3h7v2H1zM9 7h6v2H9zM2 12h8v2H2z" />
      <path fill="none" stroke={detail} opacity=".4" strokeWidth=".6" d="M0 7h5l2-1h6M3 10h7l2 1h4M8 3h6" />
    </>;
    case 'gold_block':
    case 'iron_block': return <>
      <path fill="none" stroke={detail} strokeWidth="1" opacity=".7" d="M1.5 1.5h13v13h-13z" />
      <path fill="none" stroke={light} strokeWidth="1.2" d="M2.5 13V2.5H13" />
      <path fill={light} opacity=".22" d="M4 4h8v8H4z" />
      <path fill="none" stroke={detail} strokeWidth=".6" opacity=".5" d="M4 12h8V4" />
    </>;
    case 'packed_ice': return <>
      <path fill={light} opacity=".28" d="m0 5 7-5h6L4 9H0zm6 11 10-8v4l-5 4z" />
      <path stroke={light} strokeWidth=".9" fill="none" opacity=".85" d="m1 11 5-4 3 2 6-5M5 15l4-4 5 1M2 2l4 1" />
      <path stroke={detail} strokeWidth=".6" fill="none" opacity=".65" d="m3 14 3-3-1-4M10 2l1 3 4 2" />
    </>;
    case 'bone_block': return top ? <>
      <path stroke={detail} strokeWidth=".9" fill="none" opacity=".7" d="M2 2h12v12H2zM5 5h6v6H5z" />
      <path fill={detail} opacity=".5" d="M7 7h2v2H7z" />
      <path stroke={light} strokeWidth="1" d="M3 13V3h10" fill="none" />
    </> : <>
      <path stroke={detail} strokeWidth=".7" opacity=".55" d="M3 0v6l1 2v8M8 0v16M12 0v9l1 2v5" />
      <path stroke={light} strokeWidth="1" opacity=".6" d="M5 1v12M10 3v12" />
    </>;
    case 'soul_sand': return <>
      <path fill={detail} opacity=".85" d="M2 3h4v2H5v3H3V6H2zM10 2h3v4h-2V5h-1zM8 10h5v3h-1v1H9v-2H8zM1 11h3v3H1z" />
      <path stroke={light} strokeWidth=".7" opacity=".7" fill="none" d="M1 6V2h5M9 6V1h4M7 13V9h6" />
      <path fill={light} opacity=".3" d="M6 4h2v2H6zM4 10h2v2H4zM13 7h2v2h-2z" />
    </>;
    case 'pumpkin': return top ? <>
      <path stroke={detail} strokeWidth=".9" opacity=".65" d="M0 4h6M10 4h6M0 12h6M10 12h6M4 0v6M12 0v6M4 10v6M12 10v6" />
      <path fill="#69733b" stroke="#48552d" strokeWidth=".7" d="M6 5h4v2h1v3H8v1H5V7h1z" />
    </> : <>
      <path stroke={detail} strokeWidth="1.3" opacity=".65" d="M3 0v16M8 0v16M13 0v16" />
      <path stroke={light} strokeWidth=".8" opacity=".5" d="M4.5 1v14M9.5 1v14M14.5 1v14" />
    </>;
    case 'emerald_block': return <>
      <path fill="none" stroke={detail} strokeWidth="1.1" d="M1.5 1.5h13v13h-13z" />
      <path stroke={light} strokeWidth=".8" fill="none" d="M2.7 12V2.7H12" />
      <path fill={light} opacity=".42" d="m8 4 4 4-4 4-4-4z" />
      <path fill={detail} opacity=".45" d="m8 8 4 0-4 4-4-4z" />
    </>;
    case 'hay_block': return <>
      <path stroke={detail} strokeWidth=".65" opacity=".65" d="M2 0v16M5 0v16M8 0v16M11 0v16M14 0v16" />
      <path stroke={light} strokeWidth=".65" opacity=".75" d="M3 2v5M6 9v6M9 1v7M12 10v6M15 2v5" />
      {!top && <><path fill="#a25139" d="M0 3h16v2.2H0zM0 11h16v2.2H0z" /><path fill="#d27d51" d="M0 3h16v.7H0zM0 11h16v.7H0z" /></>}
    </>;
    case 'glowstone': return <>
      <path fill={detail} opacity=".65" d="M0 0h16v16H0z" />
      <path fill={light} d="M1 1h5v4H1zM9 1h5v3H9zM6 6h5v5H6zM1 9h3v5H1zM11 12h4v3h-4z" />
      <path fill="#dfb967" d="M1 6h4v2H1zM12 5h3v5h-3zM5 12h4v3H5zM7 1h1v3H7z" />
    </>;
    case 'copper_block':
    case 'exposed_copper':
    case 'weathered_copper':
    case 'oxidized_copper': return <>
      <path stroke={detail} strokeWidth=".7" opacity=".75" fill="none" d="M1 1h14v14H1z" />
      <path stroke={light} strokeWidth=".75" opacity=".85" fill="none" d="M2 13V2h11" />
      <path fill={detail} opacity=".22" d="M4 4h4v3H4zM9 10h5v4H9z" />
      <path fill={light} opacity=".24" d="M9 3h4v3H9zM3 10h3v4H3z" />
      {kind === 'exposed_copper' && <path fill="#5e9a7b" d="M1 3h3v3H2v3H1zM10 1h4v2h-2v3h-2zM7 8h3v4H7zM12 11h3v4h-3z" />}
      {kind === 'weathered_copper' && <><path fill="#96b390" d="M1 1h5v3H3v5H1zM8 5h5v4H8zM4 11h5v4H4z" /><path fill="#a27653" d="M10 1h4v3h-4zM2 9h3v3H2zM11 12h3v3h-3z" /></>}
      {kind === 'oxidized_copper' && <path fill="#8bd0b6" opacity=".75" d="M1 3h4v3H1zM8 2h4v3H8zM5 8h4v5H5zM11 10h4v4h-4z" />}
    </>;
    case 'note_block': return top ? <>
      <path stroke={detail} strokeWidth=".7" fill="none" d="M1 1h14v14H1zM4 4h8v8H4zM7 7h2v2H7z" />
    </> : <>
      <path fill={detail} d="M2 2h12v12H2z" />
      <path stroke={light} strokeWidth=".7" opacity=".8" d="M3 4h10M3 7h10M3 10h10M5 3v10M8 3v10M11 3v10" />
    </>;
  }
}

export function InstrumentBlock({ instrumentId, size = 28, className = '', style, label, decorative = false }: Props) {
  const definition = instrumentBlock(instrumentId), palette = palettes[definition.key];
  const accessibleLabel = label ?? `${definition.name} · 音符盒垫块`;
  return <svg viewBox="0 0 40 42" width={size} height={size} className={`instrument-block ${className}`.trim()}
    style={{ display: 'inline-block', flexShrink: 0, verticalAlign: 'middle', overflow: 'visible', ...style }}
    role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : accessibleLabel} aria-hidden={decorative || undefined}
    data-block={definition.blockId} focusable="false">
    {!decorative && <title>{accessibleLabel}</title>}
    <g transform="matrix(1.0625 .5625 -1.0625 .5625 20 3)">
      <rect width="16" height="16" fill={palette[0]} fillOpacity={definition.key === 'glass' ? '.32' : undefined} />
      <Material kind={definition.key} top />
    </g>
    <g transform="matrix(1.0625 .5625 0 1.125 3 12)">
      <rect width="16" height="16" fill={palette[1]} fillOpacity={definition.key === 'glass' ? '.2' : undefined} />
      <Material kind={definition.key} top={false} />
    </g>
    <g transform="matrix(1.0625 -.5625 0 1.125 20 21)">
      <rect width="16" height="16" fill={palette[2]} fillOpacity={definition.key === 'glass' ? '.16' : undefined} />
      <Material kind={definition.key} top={false} />
      <rect width="16" height="16" fill="#1c2021" opacity=".07" />
    </g>
    <path d="m20 3 17 9v18l-17 9L3 30V12Zm0 18L3 12m17 9 17-9M20 21v18" fill="none"
      stroke={definition.key === 'glass' ? '#d3f3f4' : '#19211f'} strokeOpacity={definition.key === 'glass' ? '.9' : '.6'} strokeWidth=".75" strokeLinejoin="round" />
  </svg>;
}
