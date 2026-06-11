export function assertNonNegativeMinorUnit(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer minor-unit amount.`);
  }
}

export function assertSignedMinorUnit(value: number, label: string) {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer minor-unit amount.`);
  }
}
