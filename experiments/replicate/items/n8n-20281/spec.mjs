// Constants of the n8n:20281 job (support-email triage). Everything the solver may be told and the oracle checks against.
// The author's workflow is not redistributable (n8n ToS); this file holds our own paraphrase of its interface and conventions.
import { readFileSync } from 'node:fs';

const here = rel => new URL(rel, import.meta.url);
export const readJson = rel => JSON.parse(readFileSync(here(rel), 'utf8'));

export const CATEGORIES = Object.freeze(['New Requirement', 'Issue', 'Bug', 'Other']);
export const TICKET_CATEGORIES = Object.freeze(['New Requirement', 'Issue', 'Bug']);   // categories that open or update a ticket
export const PRIORITIES = Object.freeze(['Critical', 'High', 'Medium', 'Low']);
export const JIRA_PRIORITY = Object.freeze({ Critical: 'Highest', High: 'High', Medium: 'Medium', Low: 'Low' });
export const CATEGORY_KEY = Object.freeze({ Bug: 'bug', Issue: 'issue', 'New Requirement': 'requirement' });

// The audit sheet already has this header (the author's sheet). Rows are objects keyed by these names.
export const SHEET_COLUMNS = Object.freeze(['Logged At', 'Received At', 'Source', 'From Name', 'From Email', 'Customer Company', 'Subject', 'Customer Request',
  'Category', 'Priority', 'Confidence', 'Product Area', 'Sentiment', 'Ticket Title', 'Summary', 'Routed To', 'Jira Key', 'Jira URL', 'Follow-up', 'Slack Sent',
  'Customer Ack', 'Status', 'Notes', 'Classified By', 'Email Link', 'Message ID']);

// Deterministic per-service latency (virtual milliseconds), summed per run; the model adds per output token.
export const LATENCY_MS = Object.freeze({ gmail: 180, outlook: 220, 'jira.search': 350, 'jira.createIssue': 450, 'jira.addComment': 300, slack: 120, teams: 150, sheets: 200, state: 5, modelBase: 600, modelPerOutputToken: 8 });

// Synthetic price table for the mock model tiers (USD per million tokens). Illustrative: not a vendor price list.
export const MODEL_TIERS = Object.freeze({
  standard: { inputPerMTok: 0.4, outputPerMTok: 1.6, note: 'the tier the author\'s workflow uses (a "mini" class chat model)' },
  small: { inputPerMTok: 0.1, outputPerMTok: 0.4, note: 'a cheaper tier: faster and cheaper, noticeably less accurate, and less sure of itself when it is wrong' },
});

export const MODEL_CALL_CAP = 6;       // per event
export const CALL_CAP = 60;            // service calls per event, including model calls

// djb2 base36, the author's thread label (Jira label that marks "the ticket for this email thread").
export function threadKeyOf(email) { return String(email.threadId || email.messageId || email.subject || ''); }
export function threadLabelOf(threadKey) {
  let h = 5381;
  for (let i = 0; i < threadKey.length; i++) h = ((h << 5) + h + threadKey.charCodeAt(i)) >>> 0;
  return 'email-thread-' + h.toString(36);
}

const lower = v => String(v || '').trim().toLowerCase();
const list = v => String(v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
// The sender filter: internal domains (exact domain match) and automated senders (address contains a pattern). Case-insensitive.
export function filterReason(fromEmail, config) {
  const addr = lower(fromEmail);
  const domain = addr.split('@')[1] || '';
  if (!addr) return 'No sender address';
  if (list(config.internalDomains).includes(domain)) return `Internal sender (${domain})`;
  if (list(config.ignoreSenderPatterns).some(p => addr.includes(p))) return 'Automated / no-reply sender';
  return '';
}

export const CONFIG_PRESETS = () => readJson('./fixtures/config.json');
export function configFor(difficulty) {
  const p = CONFIG_PRESETS();
  const preset = p.byDifficulty[String(difficulty)];
  if (!preset) throw new Error(`n8n-20281: no config preset for difficulty ${difficulty}`);
  return { ...p.base, ...preset };
}
export const probeConfig = () => ({ ...CONFIG_PRESETS().base, ...CONFIG_PRESETS().probe });

// Thresholds from the pilot plan (frozen before any run; see fixtures/FREEZE.json).
export const THRESHOLDS = Object.freeze({ categoryAccuracy: 0.85, priorityAccuracy: 0.80, clearEscalationRecall: 0.85 });
