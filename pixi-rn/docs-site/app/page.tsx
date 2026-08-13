import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <h1 className="text-4xl font-bold tracking-tight">pixi-rn</h1>
      <p className="max-w-xl text-fd-muted-foreground">
        pixi.js v8 inside React Native, on expo-gl — renderer bring-up, a small flex layout pass, native touch → Pixi
        events, a retained UI widget kit, scene-graph pooling, dtMs-driven animation, and pooled audio and haptics
        behind their own entry points.
      </p>
      <div className="flex gap-4">
        <Link
          href="/docs"
          className="rounded-md bg-fd-primary px-5 py-2.5 font-medium text-fd-primary-foreground hover:opacity-90"
        >
          Read the docs
        </Link>
        <Link
          href="/docs/api"
          className="rounded-md border border-fd-border px-5 py-2.5 font-medium hover:bg-fd-accent"
        >
          API reference
        </Link>
      </div>
    </main>
  );
}
