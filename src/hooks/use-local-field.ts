import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Local-state driven input field that syncs to server on blur.
 * Prevents the "garbled input" bug where server round-trips overwrite
 * the controlled value mid-typing (especially with IME composition).
 *
 * Returns [value, onChange, onBlur].
 * - Bind `value` and `onChange` to the input.
 * - Bind `onBlur` to the input to commit on focus loss.
 * - On unmount, any uncommitted change is flushed automatically.
 */
export function useLocalField(
  serverValue: string,
  onCommit: (value: string) => void,
): [string, (value: string) => void, () => void] {
  const [local, setLocal] = useState(serverValue);
  const committedRef = useRef(serverValue);
  const localRef = useRef(local);

  localRef.current = local;

  // Sync from server when value changes externally (import, switch task, etc.)
  useEffect(() => {
    if (serverValue !== committedRef.current) {
      setLocal(serverValue);
      committedRef.current = serverValue;
    }
  }, [serverValue]);

  const onChange = useCallback((value: string) => {
    setLocal(value);
  }, []);

  const onBlur = useCallback(() => {
    if (localRef.current !== committedRef.current) {
      committedRef.current = localRef.current;
      onCommit(localRef.current);
    }
  }, [onCommit]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (localRef.current !== committedRef.current) {
        onCommit(localRef.current);
      }
    };
  }, [onCommit]);

  return [local, onChange, onBlur];
}
