// RM117 sheet-numbering convention → flag mislabels (a sheet number whose series
// disagrees with the drawn content). Ported from Checksets src/lib/sheet-naming.ts.
// Numbers outside the convention (cover sheets, general notes) return null.
//   A.100 = site · A.1XX = proposed plans · A.2XX = proposed elevations
//   A.21X = proposed sections · EX.1XX = existing plans · EX.2XX = existing elevations
//   S.XXX = framing · E.XXX = electric/lighting

export function expectedTypeFromLabel(rawLabel) {
  if (!rawLabel) return null;
  const label = rawLabel.trim().toUpperCase();

  if (/^A[.\s-]?100$/.test(label)) return 'site'; // A.100 exactly = site plan

  const m = label.match(/^([A-Z]{1,2})[.\s-]?(\d{3})$/);
  if (!m) return null;
  const prefix = m[1];
  const hundreds = m[2][0];
  const tens = m[2][1];

  switch (prefix) {
    case 'A':
      if (hundreds === '1') return 'proposed_plan'; // A.1XX (A.100 handled above)
      if (hundreds === '2') return tens === '1' ? 'section' : 'proposed_elevation'; // A.21X sections
      return null;
    case 'EX':
      if (hundreds === '1') return 'existing_plan';
      if (hundreds === '2') return 'existing_elevation';
      return null;
    case 'S':
      return 'framing';
    case 'E':
      return 'electrical';
    default:
      return null;
  }
}

// "proposed_elevation" -> "proposed elevation"
function pretty(type) {
  return type.replace(/_/g, ' ');
}

// A note if the sheet number's series disagrees with the detected content type,
// else null. Fires only when both sides are known.
export function labelMismatch(label, detected) {
  const expected = expectedTypeFromLabel(label);
  if (!expected || !detected) return null;
  if (expected === detected) return null;
  return `Numbered "${label}" (${pretty(expected)} series) but the drawing looks like a ${pretty(detected)} sheet.`;
}
