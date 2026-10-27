'use client';
import { useEffect, useState } from 'react';

/** Renders UTC in the static HTML, then the viewer's local time once hydrated. */
export function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState(() => iso.replace('T', ' ').replace(/\.\d+Z$|Z$/, ' UTC'));
  useEffect(() => {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) setText(d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
  }, [iso]);
  return <time dateTime={iso}>{text}</time>;
}
