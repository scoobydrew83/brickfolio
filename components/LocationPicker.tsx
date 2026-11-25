'use client';
import { useRouter } from 'next/navigation';
import { addLocation } from '@/app/actions';
import { Combobox } from './ui';

type Props = {
  locations: readonly string[];
  /** Posts the location (or '' for none) under this name. */
  name?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (v: string) => void;
  /** The empty choice's label: "(none)", "No location". */
  none?: string;
  label?: string;
  className?: string;
};

/**
 * Pick a location, or type a new one: "Add" creates it the same way Settings → Locations does (admins only; anyone
 * else gets that refusal), then picks it. The form still posts a location name that exists, as the <select> did.
 */
export function LocationPicker({ locations, name, defaultValue, value, onChange, none = '(none)', label = 'Location', className }: Props) {
  const router = useRouter();
  return (
    <Combobox
      label={label}
      name={name}
      defaultValue={defaultValue}
      value={value}
      onChange={onChange}
      options={[{ value: '', label: none }, ...locations.map((l) => ({ value: l, label: l }))]}
      allowCreate
      createLabel={(t) => `Add location "${t}"`}
      onCreate={async (text) => {
        const r = await addLocation(text);
        if (!r.ok) return r.error;
        router.refresh();
      }}
      className={className}
    />
  );
}
