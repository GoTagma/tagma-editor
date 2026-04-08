import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Local-state driven input field that debounces sync to server.
 * Prevents the "garbled input" bug where server round-trips overwrite
 * the controlled value mid-typing (especially with IME composition).
 */
export function useDebouncedField(
  serverValue: string,
  onCommit: (value: string) => void,
  delay = 300,
): [string, (value: string) => void] {
  const [local, setLocal] = useState(serverValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committedRef = useRef(serverValue);
  const localRef = useRef(local);

  // Keep localRef in sync
  localRef.current = local;

  // When server value changes externally (e.g. undo, import, different task selected),
  // sync to local — but only if we didn't just commit this value ourselves.
  useEffect(() => {
    if (serverValue !== committedRef.current) {
      setLocal(serverValue);
      committedRef.current = serverValue;
    }
  }, [serverValue]);

  const onChange = useCallback((value: string) => {
    setLocal(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      committedRef.current = value;
      onCommit(value);
    }, delay);
  }, [onCommit, delay]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        // Commit whatever is pending
        if (localRef.current !== committedRef.current) {
          onCommit(localRef.current);
        }
      }
    };
  }, [onCommit]);

  return [local, onChange];
}
