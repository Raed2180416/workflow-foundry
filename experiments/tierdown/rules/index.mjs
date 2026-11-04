// The rule tier (PREREG-TIERDOWN.json "rule"): site id -> rule({system, prompt, schema}) -> {value} | {abstain}.
// Every rule was written from calibration-slice (C) requests only and is frozen by sha256 in AMENDMENT-1 before any
// held-out (H) request is answered. A site without a rule abstains, so its judge keeps its reference tier.
import { countriesRule, countryNamesRule } from './countries.mjs';
import { dateOrderRule } from './date-order.mjs';

export const RULES = Object.freeze({
  'records/countries': countriesRule,
  'records/country-names': countryNamesRule,
  'records/date-order': dateOrderRule,
});
