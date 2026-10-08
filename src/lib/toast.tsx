import { useCallback, useRef, useState } from 'react';

/** Minimal toast: const { toast, node } = useToast(); render {node}; call toast('msg'). */
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const toast = useCallback((m: string, ms = 3500) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), ms);
  }, []);
  const node = msg ? <div className="toast">{msg}</div> : null;
  return { toast, node };
}
