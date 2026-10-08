// The neutral person model and its mapping onto the two systems. This is the oracle's own statement of the field
// mapping the job needs (it is derived from what the author's workflow maps, but written independently of any solver).
import { unixToIso, isoToUnix } from './mocks/common.mjs';

export const NEUTRAL = ['email', 'first', 'last', 'phone', 'mobile', 'homePhone', 'fax', 'dob', 'street', 'city', 'state', 'zip', 'country'];
export const ZOHO_OF = { email: 'Email', first: 'First_Name', last: 'Last_Name', phone: 'Phone', mobile: 'Mobile', homePhone: 'Home_Phone', fax: 'Fax', dob: 'Date_of_Birth', street: 'Mailing_Street', city: 'Mailing_City', state: 'Mailing_State', zip: 'Mailing_Zip', country: 'Mailing_Country' };
export const KT_OF = { first: 'fieldFirstName', last: 'fieldLastName', phone: 'fieldPhone', mobile: 'fieldMobilePhone', homePhone: 'fieldPrivatePhone', fax: 'fieldFax', dob: 'fieldBirthday', street: 'fieldStreet1', city: 'fieldCity', state: 'fieldState', zip: 'fieldZip', country: 'fieldCountry' };
export const HOOK_OF = { email: 'email', first: 'firstName', last: 'lastName', phone: 'phone', mobile: 'mobile', homePhone: 'homePhone', fax: 'fax', dob: 'dateOfBirth', street: 'mailingStreet', city: 'mailingCity', state: 'mailingState', zip: 'mailingZip', country: 'mailingCountry' };

const nz = v => (v === null || v === undefined ? '' : String(v));
export const toZoho = p => Object.fromEntries(Object.entries(p).filter(([k]) => ZOHO_OF[k]).map(([k, v]) => [ZOHO_OF[k], v === '' ? null : v]));
export const toKtFields = p => Object.fromEntries(Object.entries(p).filter(([k]) => KT_OF[k]).map(([k, v]) => [KT_OF[k], v]));
export const zohoNeutral = rec => Object.fromEntries(NEUTRAL.map(k => [k, nz(rec[ZOHO_OF[k]])]));
export const ktNeutral = snap => ({ email: nz(snap.email), ...Object.fromEntries(Object.keys(KT_OF).map(k => [k, k === 'dob' ? unixToIso(snap.fieldBirthday) : nz(snap[KT_OF[k]])])) });
export { isoToUnix };
