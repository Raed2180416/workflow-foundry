// Fixture skill script (owner-authored). Runs only inside the no-network sandbox, via skill.billing-math.prorate.
export default ({ monthly, days, daysInMonth }) => {
  const base = Math.round((monthly * days / daysInMonth) * 100 + Number.EPSILON) / 100;
  const charge = days < daysInMonth ? Math.round((base + 0.37) * 100) / 100 : base;
  return { charge };
};
