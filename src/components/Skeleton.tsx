// Placeholders shaped like the content they stand in for, shown while data is on its way.
import type { CSSProperties } from 'react';

type Size = CSSProperties['width'];

/** One pulsing block. Decorative: the status text beside it says what is loading. */
export function Sk({ w = '100%', h = 14, r, square }: { w?: Size; h?: Size; r?: Size; square?: boolean }) {
  return <i className="sk" aria-hidden="true" style={{ width: w, height: square ? undefined : h, aspectRatio: square ? 1 : undefined, borderRadius: r }} />;
}

const HEADLINE = 'clamp(34px, min(4.6vw, 7.5vh), 60px)';
const TITLE = 'clamp(26px, min(3.4vw, 5.6vh), 40px)';

/** The side panel before the analysis arrives: the verdict, then the last seven days. */
export function SideSkeleton({ eyebrow, label }: { eyebrow?: string | null; label: string }) {
  return (
    <>
      <div className="sk-group">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : <Sk w={96} h={12} />}
        <p className="verdict-text" role="status">{label}</p>
        <Sk w="72%" h={HEADLINE} />
        <Sk w={190} h={28} r={999} />
        <Sk h={16} />
        <Sk w="88%" h={16} />
        <div className="tiles" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <Sk w="70%" h={12} />
              <Sk w="50%" h={28} />
            </div>
          ))}
        </div>
      </div>
      <div className="now" aria-hidden="true">
        <Sk w={150} h={15} />
        <Sk w={110} h={30} />
        <Sk w="80%" h={16} />
      </div>
    </>
  );
}

/** The sections under the map: the rings beside the calendar, then the season chart. */
export function MainSkeleton() {
  return (
    <div className="main" aria-hidden="true">
      <section>
        <Sk w={130} h={12} />
        <Sk w="min(100%, 520px)" h={TITLE} />
        <Sk w="min(100%, 68ch)" h={16} />
        <div className="record-grid">
          <Sk square r="50%" />
          <Sk h="clamp(320px, 44vw, 580px)" r={10} />
        </div>
      </section>
      <section>
        <Sk w={110} h={12} />
        <Sk w="min(100%, 440px)" h={TITLE} />
        <Sk h={240} r={10} />
      </section>
    </div>
  );
}

/** The intro's first screen before its story data arrives. */
export function IntroSkeleton({ label }: { label: string }) {
  return (
    <div className="scene-hero">
      <div className="hero-inner sk-hero">
        <Sk w={180} h={12} />
        <Sk w="min(100%, 4.4em)" h="1em" r={12} />
        <Sk w="min(100%, 420px)" h={28} />
        <p className="note" role="status">{label}</p>
      </div>
    </div>
  );
}
