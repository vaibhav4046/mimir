import React from 'react';
import {
  CHARACTER_ARCHETYPES,
  LEGACY_SHAPE_TO_CHARACTER,
  ModularBotAvatar,
} from './MimirAsset.jsx';

const SHAPE_PATHS = {
  leviathan: 'M12 8 H36 L40 18 L28 24 L28 42 H20 V24 L8 18 Z',
  mjolnir: 'M8 10 H40 V26 H28 V42 H20 V26 H8 Z',
  yggdrasil: 'M24 6 L38 22 H29 V42 H19 V22 H10 Z',
  valkyrie: 'M6 12 L18 22 L24 8 L30 22 L42 12 L34 38 H14 Z',
  arch: 'M12 44 V24 A12 12 0 0 1 36 24 V44 Z',
  bean: 'M14 14 C24 6, 40 12, 38 26 C36 40, 20 44, 12 34 C6 26, 8 18, 14 14 Z',
  blob: 'M24 6 C35 6, 42 15, 40 26 C38 37, 29 42, 18 41 C8 40, 6 29, 9 19 C12 10, 17 6, 24 6 Z',
  capsule: 'M12 14 A12 12 0 0 1 36 14 V34 A12 12 0 0 1 12 34 Z',
  cloud: 'M14 36 H36 A8 8 0 0 0 38 20 A11 11 0 0 0 17 16 A9 9 0 0 0 14 36 Z',
  clover: 'M24 8 A7 7 0 1 1 33 19 A7 7 0 1 1 31 35 A7 7 0 1 1 15 35 A7 7 0 1 1 15 19 A7 7 0 1 1 24 8 Z',
  crystal: 'M24 5 L39 18 L34 42 H14 L9 18 Z',
  cylinder: 'M11 12 C11 8, 37 8, 37 12 V36 C37 40, 11 40, 11 36 Z',
  dome: 'M8 38 C8 16, 40 16, 40 38 Z',
  egg: 'M24 6 C34 6, 39 20, 38 30 C37 40, 11 40, 10 30 C9 20, 14 6, 24 6 Z',
  flower: 'M24 6 C29 6, 31 12, 36 12 C40 12, 42 17, 38 22 C42 26, 40 34, 34 34 C32 40, 27 42, 24 38 C21 42, 16 40, 14 34 C8 34, 6 26, 10 22 C6 17, 8 12, 12 12 C17 12, 19 6, 24 6 Z',
  gem: 'M15 8 H33 L42 18 L24 42 L6 18 Z',
  heart: 'M24 41 L10 27 A9 9 0 0 1 24 15 A9 9 0 0 1 38 27 Z',
  hex: 'M24 6 L40 15 V33 L24 42 L8 33 V15 Z',
  house: 'M24 6 L41 21 V41 H7 V21 Z',
  leaf: 'M38 9 C20 9, 9 20, 10 38 C28 39, 39 28, 38 9 Z',
  pebble: 'M10 28 C8 16, 18 10, 29 12 C39 14, 42 26, 36 35 C30 42, 12 39, 10 28 Z',
  pumpkin: 'M24 10 C34 10, 41 17, 41 26 C41 35, 34 40, 24 40 C14 40, 7 35, 7 26 C7 17, 14 10, 24 10 Z',
  shield: 'M24 6 L39 12 V25 C39 34, 31 40, 24 42 C17 40, 9 34, 9 25 V12 Z',
  square: 'M9 9 H39 V39 H9 Z',
  squircle: 'M10 14 Q10 8 16 8 H32 Q38 8 38 14 V34 Q38 40 32 40 H16 Q10 40 10 34 Z',
  star: 'M24 5 L29.5 16.5 L42 18 L33 27 L35 40 L24 34 L13 40 L15 27 L6 18 L18.5 16.5 Z',
  tablet: 'M11 7 H37 V41 H11 Z',
  teardrop: 'M24 6 C32 16, 39 23, 39 30 A15 15 0 0 1 9 30 C9 23, 16 16, 24 6 Z',
  wedge: 'M8 39 L24 8 L40 39 Z',
};

export function BotAvatar({ shape = 'mimir', color = '#3ac9ff', size = 28, bot = null, state = 'idle' }) {
  const effectiveShape = bot?.shape || shape;
  const hasPixelCharacter =
    CHARACTER_ARCHETYPES.some(c => c.id === effectiveShape) ||
    Boolean(LEGACY_SHAPE_TO_CHARACTER[effectiveShape]) ||
    (Array.isArray(bot?.accessories) && bot.accessories.length > 0);

  if (hasPixelCharacter) {
    return <ModularBotAvatar bot={bot || { shape: effectiveShape, color }} size={size} state={state} />;
  }

  const d = SHAPE_PATHS[effectiveShape] || SHAPE_PATHS.shield;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ flexShrink: 0 }} aria-hidden="true">
      <rect x="2" y="2" width="44" height="44" fill="#101722" stroke="#e6ab42" strokeWidth="2" />
      <path d={d} fill={color} stroke="#081019" strokeWidth="2" />
      <rect x="17" y="21" width="4" height="4" fill="#081019" />
      <rect x="27" y="21" width="4" height="4" fill="#081019" />
    </svg>
  );
}
