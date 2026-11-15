// Whole-number week-to-week changes: halves round away from zero; zero has no sign.
export const roundPercent = value => {
  const magnitude = Math.round(Math.abs(value));
  return magnitude === 0 ? 0 : Math.sign(value) * magnitude;
};
