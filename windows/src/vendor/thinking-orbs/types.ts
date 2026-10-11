// Framework-free subset of thinking-orbs' public types. See PROVENANCE.md.
export type OrbState =
  | 'working'
  | 'searching'
  | 'solving'
  | 'listening'
  | 'connecting'
  | 'weaving'
  | 'composing'
  | 'breathing'
  | 'shaping';

/** These are independent tuned designs, rather than a scaled single preset. */
export type OrbSize = 64 | 20;
export type OrbTheme = 'auto' | 'dark' | 'light';
