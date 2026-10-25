import {type ReactNode, useId, useMemo} from 'react';
import type {Avatar as AvatarValue} from '../lib/auth';
import {cn} from '../lib/cn';

const PALETTES = [
  ['#1d3557', '#e63946', '#f1faee', '#a8dadc', '#457b9d'],
  ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'],
  ['#0b3d2e', '#00a85a', '#f2e8cf', '#bc4749', '#6a994e'],
  ['#22223b', '#4a4e69', '#9a8c98', '#c9ada7', '#f2e9e4'],
  ['#003049', '#d62828', '#f77f00', '#fcbf49', '#eae2b7'],
  ['#2b2d42', '#8d99ae', '#edf2f4', '#ef233c', '#d90429'],
  ['#3d405b', '#e07a5f', '#f4f1de', '#81b29a', '#f2cc8f'],
  ['#0f4c5c', '#e36414', '#fb8b24', '#9a031e', '#5f0f40'],
  ['#14213d', '#fca311', '#e5e5e5', '#ffffff', '#4f6d7a'],
  ['#355070', '#6d597a', '#b56576', '#e56b6f', '#eaac8b'],
  ['#073b4c', '#118ab2', '#06d6a0', '#ffd166', '#ef476f'],
  ['#283618', '#606c38', '#fefae0', '#dda15e', '#bc6c25'],
];

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function random(seed: string): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

export function randomSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, byte => byte.toString(36).padStart(2, '0')).join('');
}

export function GeneratedAvatar({
  seed,
  size = 32,
  className,
}: {
  seed: string;
  size?: number;
  className?: string;
}) {
  const clipId = useId();
  const shapes = useMemo(() => {
    const next = random(seed);
    const palette = PALETTES[Math.floor(next() * PALETTES.length)];
    const background = palette[Math.floor(next() * palette.length)];
    const others = palette.filter(color => color !== background);
    const pick = () => others[Math.floor(next() * others.length)];
    const items: ReactNode[] = [];
    const count = 3 + Math.floor(next() * 2);
    for (let i = 0; i < count; i++) {
      const kind = Math.floor(next() * 4);
      const x = 10 + next() * 60;
      const y = 10 + next() * 60;
      const scale = 18 + next() * 34;
      const rotate = Math.round(next() * 8) * 45;
      const color = pick();
      const transform = `rotate(${rotate} ${x} ${y})`;
      if (kind === 0) {
        items.push(<circle key={i} cx={x} cy={y} r={scale / 2} fill={color} />);
      } else if (kind === 1) {
        items.push(
          <rect
            key={i}
            x={x - scale / 2}
            y={y - scale / 2}
            width={scale}
            height={scale}
            fill={color}
            transform={transform}
          />,
        );
      } else if (kind === 2) {
        items.push(
          <polygon
            key={i}
            points={`${x},${y - scale / 2} ${x + scale / 2},${y + scale / 2} ${x - scale / 2},${y + scale / 2}`}
            fill={color}
            transform={transform}
          />,
        );
      } else {
        items.push(
          <rect
            key={i}
            x={x - scale}
            y={y - 4}
            width={scale * 2}
            height={8}
            fill={color}
            transform={transform}
          />,
        );
      }
    }
    return {background, items};
  }, [seed]);
  return (
    <svg
      viewBox="0 0 80 80"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn('shrink-0 rounded-full', className)}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="40" cy="40" r="40" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width="80" height="80" fill={shapes.background} />
        {shapes.items}
      </g>
    </svg>
  );
}

export function UserAvatar({
  username,
  avatar,
  size = 32,
  className,
}: {
  username: string;
  avatar: AvatarValue | undefined;
  size?: number;
  className?: string;
}) {
  if (avatar?.kind === 'custom') {
    return (
      <img
        src={`/api/avatars/${encodeURIComponent(username)}?v=${avatar.version}`}
        alt=""
        width={size}
        height={size}
        className={cn('shrink-0 rounded-full object-cover', className)}
        style={{width: size, height: size}}
      />
    );
  }
  return (
    <GeneratedAvatar
      seed={avatar?.seed ?? username}
      size={size}
      className={className}
    />
  );
}
