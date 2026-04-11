// ─────────────────────────────────────────────────────────────────────────────
// SchemaForm.tsx — F10: Plugin schema → form generator.
// ─────────────────────────────────────────────────────────────────────────────
//
// SDK discovery note (Group 8): `tagma-sdk/plugins/types/src/index.ts` does
// NOT expose any `schema` field on TriggerPlugin / CompletionPlugin /
// MiddlewarePlugin. Built-in plugins (`src/triggers/*`, `src/completions/*`,
// `src/middlewares/*`) only throw descriptive errors at runtime — there is no
// declarative schema metadata. See the review doc §F10 for rationale.
//
// As a fallback we hand-wrote schema descriptors for the known built-in
// plugins in `BUILTIN_PLUGIN_SCHEMAS` below. Third-party plugins without a
// schema silently fall back to the KV editor in the caller. When/if the SDK
// adds a `schema?: PluginSchema` field to its plugin interfaces, extend the
// server `/api/registry` response to include it and merge into the lookup
// below (additive; keep hand-written schemas as a safety net for legacy
// plugins that haven't migrated).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback } from 'react';
import { useLocalField } from '../../hooks/use-local-field';

// ── Schema types ────────────────────────────────────────────────────────────

export type SchemaFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'path'
  | 'duration'
  | 'number-or-list';

export interface SchemaField {
  readonly key: string;
  readonly label?: string;
  readonly type: SchemaFieldType;
  readonly required?: boolean;
  readonly description?: string;
  readonly default?: unknown;
  readonly enum?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly placeholder?: string;
}

export interface PluginSchema {
  readonly fields: readonly SchemaField[];
}

// ── Built-in plugin schemas (hand-written fallback) ────────────────────────
// Matches the runtime validators in tagma-sdk/src/triggers/*.ts,
// tagma-sdk/src/completions/*.ts, tagma-sdk/src/middlewares/*.ts.

export const BUILTIN_TRIGGER_SCHEMAS: Record<string, PluginSchema> = {
  file: {
    fields: [
      { key: 'path', type: 'path', required: true, placeholder: './path/to/watch',
        description: 'File path to watch. Resolved relative to workDir.' },
      { key: 'timeout', type: 'duration', placeholder: 'e.g. 5m',
        description: 'Give up after this duration if the file does not appear.' },
    ],
  },
  manual: {
    fields: [
      { key: 'message', type: 'string', placeholder: 'Approval message...',
        description: 'Prompt shown to the approver.' },
      // NOTE: `options` and `metadata` are intentionally NOT schematized here —
      // they are handled by dedicated editors (OptionsField, KeyValueEditor)
      // in TaskConfigPanel because they are list/object types that the generic
      // form generator doesn't handle yet.
      { key: 'timeout', type: 'duration', placeholder: 'e.g. 5m',
        description: 'Auto-reject after this duration.' },
    ],
  },
};

export const BUILTIN_COMPLETION_SCHEMAS: Record<string, PluginSchema> = {
  exit_code: {
    fields: [
      { key: 'expect', type: 'number-or-list', default: 0, placeholder: '0 (default)',
        description: 'Expected exit code, or comma-separated list of codes.' },
    ],
  },
  file_exists: {
    fields: [
      { key: 'path', type: 'path', required: true, placeholder: './path/to/check',
        description: 'File or directory to check.' },
      { key: 'kind', type: 'enum', enum: ['any', 'file', 'dir'], default: 'any',
        description: 'Restrict to file, directory, or any.' },
      { key: 'min_size', type: 'number', min: 0, placeholder: 'optional',
        description: 'Minimum size in bytes (files only).' },
    ],
  },
  output_check: {
    fields: [
      { key: 'check', type: 'string', required: true, placeholder: 'shell command (exit 0 = pass)',
        description: 'Shell command — exit 0 means the check passed.' },
      { key: 'timeout', type: 'duration', default: '30s', placeholder: '30s (default)',
        description: 'Max duration before the check is aborted.' },
    ],
  },
};

export const BUILTIN_MIDDLEWARE_SCHEMAS: Record<string, PluginSchema> = {
  static_context: {
    fields: [
      { key: 'file', type: 'path', required: true, placeholder: './context.md',
        description: 'Markdown file to prepend to the prompt.' },
      { key: 'label', type: 'string', placeholder: 'Reference: filename',
        description: 'Optional display label used in the injected header.' },
    ],
  },
};

/** Look up a schema for the given plugin kind + type, or `null` if unknown. */
export function getBuiltinSchema(
  kind: 'trigger' | 'completion' | 'middleware',
  type: string,
): PluginSchema | null {
  const table =
    kind === 'trigger' ? BUILTIN_TRIGGER_SCHEMAS :
    kind === 'completion' ? BUILTIN_COMPLETION_SCHEMAS :
    BUILTIN_MIDDLEWARE_SCHEMAS;
  return table[type] ?? null;
}

// ── SchemaForm component ────────────────────────────────────────────────────

interface SchemaFormProps {
  schema: PluginSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

/**
 * Generic form generator driven by a PluginSchema descriptor. Renders one
 * input per declared field. Values not covered by the schema are preserved
 * verbatim in the output object (so round-tripping unknown keys is lossless).
 */
export function SchemaForm({ schema, value, onChange }: SchemaFormProps) {
  const commit = useCallback((key: string, next: unknown) => {
    const updated = { ...value };
    if (next === undefined || next === '' || next === null) {
      delete updated[key];
    } else {
      updated[key] = next;
    }
    onChange(updated);
  }, [value, onChange]);

  return (
    <div className="space-y-2">
      {schema.fields.map((field) => (
        <SchemaFieldRow
          key={field.key}
          field={field}
          value={value[field.key]}
          onChange={(next) => commit(field.key, next)}
        />
      ))}
    </div>
  );
}

// ── Field row ───────────────────────────────────────────────────────────────

function SchemaFieldRow({ field, value, onChange }: {
  field: SchemaField;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const label = field.label ?? field.key;
  const defaultStr =
    field.default !== undefined && field.default !== null ? String(field.default) : undefined;

  return (
    <div>
      <label className="text-[10px] text-tagma-muted flex items-center gap-1">
        <span>
          {label}
          {field.required && <span className="text-tagma-error ml-0.5">*</span>}
        </span>
        {field.description && (
          <span className="text-tagma-muted/60" title={field.description}>&nbsp;(?)</span>
        )}
      </label>
      <SchemaFieldInput field={field} value={value} onChange={onChange} defaultStr={defaultStr} />
      {field.description && (
        <p className="text-[9px] text-tagma-muted/80 mt-0.5 leading-snug">{field.description}</p>
      )}
    </div>
  );
}

function SchemaFieldInput({ field, value, onChange, defaultStr }: {
  field: SchemaField;
  value: unknown;
  onChange: (next: unknown) => void;
  defaultStr: string | undefined;
}) {
  const strValue = value == null ? '' : String(value);

  // Every text-like input uses useLocalField so edits don't thrash the store.
  const [localStr, setLocalStr, blurStr] = useLocalField(strValue, (v) => {
    if (field.type === 'number') {
      onChange(v === '' ? undefined : Number(v));
      return;
    }
    if (field.type === 'number-or-list') {
      if (v === '') { onChange(undefined); return; }
      if (v.includes(',')) {
        onChange(v.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)));
        return;
      }
      const n = Number(v);
      onChange(Number.isNaN(n) ? v : n);
      return;
    }
    onChange(v === '' ? undefined : v);
  });

  switch (field.type) {
    case 'enum':
      return (
        <select
          className="field-input text-[11px]"
          value={strValue}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">{defaultStr ? `${defaultStr} (default)` : '—'}</option>
          {field.enum?.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    case 'boolean':
      return (
        <label className="flex items-center gap-1.5 text-[11px] text-tagma-text">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked ? true : undefined)}
          />
          <span className="text-tagma-muted">{strValue === 'true' ? 'enabled' : 'disabled'}</span>
        </label>
      );
    case 'number':
      return (
        <input
          type="number"
          className="field-input font-mono text-[11px]"
          value={localStr}
          min={field.min}
          max={field.max}
          onChange={(e) => setLocalStr(e.target.value)}
          onBlur={blurStr}
          placeholder={field.placeholder ?? defaultStr}
        />
      );
    case 'path':
    case 'string':
    case 'duration':
    case 'number-or-list':
    default:
      return (
        <input
          type="text"
          className="field-input font-mono text-[11px]"
          value={localStr}
          onChange={(e) => setLocalStr(e.target.value)}
          onBlur={blurStr}
          placeholder={field.placeholder ?? defaultStr}
        />
      );
  }
}
