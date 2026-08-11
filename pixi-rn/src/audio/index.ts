// `expo-audio` pooling: the fixes for the two failure modes every native
// audio integration on this stack eventually hits — a shared player cutting
// itself off on a bursty retrigger (`SoundPool`), and constructing a player
// synchronously mid-play blocking the JS thread for tens of ms (`warmOne`,
// everywhere).
export { SoundPool, type SoundPoolOptions } from './soundPool';
export { LoopSound } from './loopSound';
export { warmPools, type WarmablePool } from './warmPools';
