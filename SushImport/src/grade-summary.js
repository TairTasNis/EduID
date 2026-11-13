function roundHalfToEven(value) {
  const floor = Math.floor(value);
  if (value - floor === 0.5) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(value);
}

function roundToOneDecimal(value) {
  return roundHalfToEven(value * 10) / 10;
}

function formatDecimal(value) {
  return String(roundToOneDecimal(value));
}

function ratioFromAssessment(value) {
  if (value && typeof value === "object") {
    const score = Number(String(value.score ?? "").replace(/,/g, "."));
    const maximum = Number(String(value.maxScore ?? "").replace(/,/g, "."));
    return Number.isFinite(score) && Number.isFinite(maximum) && maximum > 0
      ? { score, maximum }
      : null;
  }

  const text = String(value ?? "").trim().replace(/,/g, ".");
  const ratio = text.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/);
  if (!ratio) return null;

  const score = Number(ratio[1]);
  const maximum = Number(ratio[2]);
  return maximum > 0 ? { score, maximum } : null;
}

export function percentageFromAssessment(value) {
  if (Number.isFinite(value)) return value;

  const text = String(value ?? "").trim().replace(/,/g, ".");
  if (!text || text === "-" || text === "✖") return null;

  const ratio = ratioFromAssessment(value);
  if (ratio) {
    return (ratio.score / ratio.maximum) * 100;
  }

  const percent = text.match(/(-?\d+(?:\.\d+)?)\s*%/);
  return percent ? Number(percent[1]) : null;
}

function calculateHalfContribution(values) {
  const assessments = Array.isArray(values) ? values : [];
  const ratios = assessments.map(ratioFromAssessment).filter(Boolean);

  if (ratios.length) {
    const score = ratios.reduce((sum, ratio) => sum + ratio.score, 0);
    const maximum = ratios.reduce((sum, ratio) => sum + ratio.maximum, 0);
    return roundToOneDecimal((score / maximum) * 50);
  }

  const percentages = assessments
    .map(percentageFromAssessment)
    .filter((value) => Number.isFinite(value));
  return percentages.length
    ? roundToOneDecimal(percentages.reduce((sum, value) => sum + value, 0) / percentages.length / 2)
    : null;
}

export function summarizeWeightedAssessments(sors = [], sochs = []) {
  const sorsContribution = calculateHalfContribution(sors);
  const sochsContribution = calculateHalfContribution(sochs);

  return {
    sorsPct: sorsContribution === null ? "-" : `${formatDecimal(sorsContribution)}%`,
    sochsPct: sochsContribution === null ? "-" : `${formatDecimal(sochsContribution)}%`,
  };
}
