// The site's builder: one object FoundryApp can hold, routing each request to the right builder.
//   template given (site form or agent-filled settings)  -> the template form builder ($0, no model)
//   an existing library automation, no template given     -> the form builder on that automation's own card (settings unchanged)
//   words only                                            -> the text builder: the stub ($0) by default; a model builder only when
//                                                            the owner wires one (Mercury preview, app/onboarding/builder-worker.mjs)
// The site itself never sends words to a builder without a key: its box only suggests a card (app/onboarding/suggest.mjs).
import { stubBuilder } from '../core/builder.mjs';
import { TemplateFormBuilder } from './form-builder.mjs';

export class SiteBuilder {
  constructor({ form = new TemplateFormBuilder(), text = stubBuilder } = {}) {
    if (!text || typeof text.build !== 'function' || typeof text.id !== 'string') throw new Error('SiteBuilder needs a text builder with an id and build()');
    this.form = form; this.text = text;
    this.id = `site-builder/1 (cards: ${form.id}; words: ${text.id})`;
    this.async = true;
  }
  async build(args = {}) {
    const { template, base } = args;
    if (template !== undefined && template !== null) return this.form.build({ ...args, origin: args.origin ?? 'site-form' });
    if (base?.template) return this.form.build({ ...args, template: base.template, settings: {}, origin: args.origin ?? 'agent' });
    return this.text.build(args);
  }
  async rebase(built, base) { return (built.builder === this.form.id ? this.form : this.text).rebase(built, base); }
  /** Does a proposal's builder use a model? (the "Uses AI" fact on every card) */
  usesAI(builderId) { return !(builderId === this.form.id || builderId === stubBuilder.id); }
}
