type Taggable = Record<string, string | number>;

type DeviceWithI18n = {
  translate?: (key: string, tags?: Taggable) => string;
  homey?: { __?: (key: string, tags?: Taggable) => string };
};

function fillTags(text: string, tags?: Taggable): string {
  if (!tags) return text;
  return text.replace(/__([A-Z0-9_]+)__/g, (_, name: string) => {
    const value = tags[name];
    return value == null ? '' : String(value);
  });
}

/**
 * User-facing text from the Homey locale. German fallback keeps the previous
 * wording when a unit-test mock has no homey.__.
 */
export function deviceText(
  device: DeviceWithI18n | null | undefined,
  key: string,
  tags?: Taggable,
  fallback?: string,
): string {
  const accept = (value: string | undefined): string | undefined => {
    if (!value || value === key) return undefined;
    return fillTags(value, tags);
  };
  try {
    if (device && typeof device.translate === 'function') {
      const value = accept(device.translate(key, tags));
      if (value) return value;
    }
  } catch {
    /* use the next source */
  }
  try {
    const fn = device?.homey?.__;
    if (typeof fn === 'function') {
      const value = accept(fn(key, tags));
      if (value) return value;
    }
  } catch {
    /* use the fallback */
  }
  return fillTags(fallback ?? key, tags);
}
