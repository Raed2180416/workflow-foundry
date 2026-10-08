// Static pools for the `synth` (research synthesis) bed: properties with canonical units,
// unit variants, standard and non-standard measurement conditions, and fictional name pools.
// Everything here is invented for this bed; no entity, venue or organisation is real.

// A unit converts a written number to the canonical unit as canonical = written * f + o.
const U = (id, f, sym, extra = {}) => ({ id, f, o: 0, sym, ...extra });
const CELSIUS = [U('°C', 1, ['°C'], { w: ['degrees Celsius'] }), U('K', 1, ['K'], { o: -273.15, w: ['kelvin'] }), U('°F', 5 / 9, ['°F'], { o: -32 * 5 / 9, w: ['degrees Fahrenheit'] })];

export const PROPS = {
  'aqueous solubility': {
    kind: 'compound', unit: 'mg/mL', range: [0.4, 38], better: 'up', tempLike: false,
    names: ['aqueous solubility', 'solubility in water', 'water solubility'],
    stdDesc: 'in pure water (no buffer, salt, acid, base or co-solvent) at 25 °C (298 K)',
    std: ['in water at 25 °C', 'in water at 298 K', 'in deionised water at 25 °C', 'in pure water at 298.15 K', 'in ultrapure water at 25 °C'],
    nonstd: ['in water at 37 °C', 'in water at 310 K', 'in ethanol at 25 °C', 'in DMSO at 25 °C', 'in 0.1 M hydrochloric acid at 25 °C', 'in phosphate buffer (pH 7.4) at 25 °C', 'in water at 4 °C'],
    units: [U('mg/mL', 1, ['mg/mL', 'mg mL⁻¹', 'mg·mL⁻¹'], { w: ['milligrams per millilitre'] }), U('g/L', 1, ['g/L', 'g L⁻¹'], { w: ['grams per litre'] }), U('µg/mL', 0.001, ['µg/mL', 'μg mL⁻¹', 'µg·mL⁻¹']),
      U('mg/L', 0.001, ['mg/L', 'mg L⁻¹'], { w: ['milligrams per litre'] }), U('mg/100 mL', 0.01, ['mg/100 mL', 'mg per 100 mL'])],
  },
  'melting point': {
    kind: 'compound', unit: '°C', range: [85, 255], better: 'up', tempLike: true,
    names: ['melting point', 'melting temperature', 'onset of melting'],
    stdDesc: 'at atmospheric pressure (about 101 kPa, 1 atm)',
    std: ['at atmospheric pressure', 'at ambient pressure', 'at 1 atm', 'at 101.3 kPa', 'by DSC at ambient pressure'],
    nonstd: ['under 1.2 GPa of hydrostatic pressure', 'at 0.5 GPa in a diamond-anvil cell', 'under 300 MPa of pressure'],
    units: CELSIUS,
  },
  'plasma half-life': {
    kind: 'compound', unit: 'h', range: [1.6, 58], better: 'up', tempLike: false,
    names: ['plasma half-life', 'elimination half-life', 'terminal half-life'],
    stdDesc: 'elimination half-life measured in vivo in humans (healthy volunteers or patients); animal studies and in-vitro systems do not count',
    std: ['in healthy human volunteers', 'in human subjects', 'in a first-in-human study', 'in adult patients'],
    nonstd: ['in mice', 'in rats', 'in beagle dogs', 'in cynomolgus monkeys', 'in human plasma in vitro'],
    units: [U('h', 1, ['h', 'hours', 'hr'], { w: ['hours'] }), U('min', 1 / 60, ['min', 'minutes'], { w: ['minutes'] }), U('days', 24, ['days', 'days'])],
  },
  'enzyme IC50': {
    kind: 'compound', unit: 'nM', range: [2.5, 850], better: 'down', tempLike: false,
    names: ['IC50', 'half-maximal inhibitory concentration (IC50)', 'enzyme IC50'],
    stdDesc: 'in a cell-free assay with purified (or recombinant purified) enzyme; cell-based and blood assays do not count',
    std: ['in a cell-free enzyme assay', 'against the purified enzyme', 'in the biochemical (cell-free) assay', 'using recombinant purified enzyme'],
    nonstd: ['in a whole-cell assay', 'in cultured cells', 'in a cell-based reporter assay'],
    units: [U('nM', 1, ['nM'], { w: ['nanomolar'] }), U('µM', 1000, ['µM', 'μM'], { w: ['micromolar'] }), U('pM', 0.001, ['pM'], { w: ['picomolar'] }), U('M', 1e9, ['M'], { sci: true })],
  },
  density: {
    kind: 'material', unit: 'g/cm³', range: [1.3, 9.4], better: 'down', tempLike: false,
    names: ['density', 'measured density', 'mass density'],
    stdDesc: 'of the fully dense bulk solid (not a powder, foam, porous or partially sintered body) at room temperature (20–25 °C)',
    std: ['for dense bulk samples at room temperature', 'of the bulk solid at 20 °C', 'by helium pycnometry on bulk pieces at 23 °C', 'of fully dense bulk specimens at 25 °C'],
    nonstd: ['as a loose powder (tap density)', 'for the porous foam form at room temperature', 'at 900 °C', 'for a sintered compact with 30% porosity'],
    units: [U('g/cm³', 1, ['g/cm³', 'g cm⁻³', 'g/cc'], { w: ['grams per cubic centimetre'] }), U('kg/m³', 0.001, ['kg/m³', 'kg m⁻³'], { w: ['kilograms per cubic metre'] }), U('g/mL', 1, ['g/mL'])],
  },
  'tensile strength': {
    kind: 'material', unit: 'MPa', range: [85, 2300], better: 'up', tempLike: false,
    names: ['tensile strength', 'ultimate tensile strength', 'UTS'],
    stdDesc: 'at room temperature (20–25 °C) on as-received material (not irradiated, corroded, cold-worked or heat-aged)',
    std: ['at room temperature', 'at 23 °C', 'at 296 K', 'under ambient laboratory conditions (22 °C)'],
    nonstd: ['at 600 °C', 'at 77 K', 'at −196 °C', 'at 873 K'],
    units: [U('MPa', 1, ['MPa', 'N/mm²'], { w: ['megapascals'] }), U('GPa', 1000, ['GPa'], { w: ['gigapascals'] }), U('ksi', 6.894757, ['ksi'], { w: ['thousand pounds per square inch'] }), U('psi', 0.006894757, ['psi'], { w: ['pounds per square inch'] })],
  },
  'thermal conductivity': {
    kind: 'material', unit: 'W/(m·K)', range: [0.6, 380], better: 'up', tempLike: false,
    names: ['thermal conductivity', 'heat conductivity', 'thermal conductivity κ'],
    stdDesc: 'near room temperature (295–305 K)',
    std: ['at 300 K', 'at 27 °C', 'at room temperature (298 K)', 'at 25 °C'],
    nonstd: ['at 77 K', 'at 800 K', 'at 500 °C', 'at 4 K'],
    units: [U('W/(m·K)', 1, ['W/(m·K)', 'W m⁻¹ K⁻¹', 'W/m·K'], { w: ['watts per metre-kelvin'] }), U('mW/(m·K)', 0.001, ['mW/(m·K)', 'mW m⁻¹ K⁻¹'], { w: ['milliwatts per metre-kelvin'] }), U('W/(cm·K)', 100, ['W/(cm·K)', 'W cm⁻¹ K⁻¹'])],
  },
  'band gap': {
    kind: 'material', unit: 'eV', range: [0.45, 5.4], better: 'up', tempLike: false,
    names: ['band gap', 'optical band gap', 'bandgap'],
    stdDesc: 'at room temperature (290–300 K) and ambient pressure',
    std: ['at room temperature', 'at 295 K', 'at 22 °C', 'at 298 K'],
    nonstd: ['at 4 K', 'at 10 K', 'at 77 K', 'under 3 GPa of pressure'],
    units: [U('eV', 1, ['eV'], { w: ['electronvolts'] }), U('meV', 0.001, ['meV'], { w: ['millielectronvolts'] })],
  },
  'doubling time': {
    kind: 'organism', unit: 'min', range: [19, 290], better: 'down', tempLike: false,
    names: ['doubling time', 'generation time', 'mass-doubling time'],
    stdDesc: 'in rich (complex) liquid medium at 30 °C (303 K), aerobic (cultures are aerobic unless stated otherwise)',
    std: ['in rich broth at 30 °C', 'in rich medium at 303 K', 'in nutrient-rich broth at 30 °C under aerobic conditions', 'in complex medium at 30 °C'],
    nonstd: ['in minimal medium at 30 °C', 'in rich broth at 15 °C', 'in rich broth at 288 K', 'in rich broth at 30 °C under anaerobic conditions'],
    units: [U('min', 1, ['min', 'minutes'], { w: ['minutes'] }), U('h', 60, ['h', 'hours'], { w: ['hours'] }), U('s', 1 / 60, ['s', 'seconds'])],
  },
  'genome size': {
    kind: 'organism', unit: 'Mbp', range: [1.3, 9.6], better: 'up', tempLike: false,
    names: ['genome size', 'total genome length', 'genome length'],
    stdDesc: 'total size from a complete (closed) genome assembly; draft assemblies and indirect estimates do not count',
    std: ['from the complete (closed) genome assembly', 'based on the finished, closed genome sequence', 'from a complete hybrid assembly'],
    nonstd: ['from a draft assembly of 112 contigs', 'estimated by pulsed-field gel electrophoresis', 'from a fragmented short-read draft assembly'],
    units: [U('Mbp', 1, ['Mbp', 'Mb'], { w: ['megabase pairs'] }), U('kbp', 0.001, ['kbp', 'kb'], { w: ['kilobase pairs'] }), U('bp', 1e-6, ['bp'], { sci: true })],
  },
  'cell length': {
    kind: 'organism', unit: 'µm', range: [0.7, 11.5], better: 'up', tempLike: false,
    names: ['cell length', 'mean cell length', 'average cell length'],
    stdDesc: 'of cells in exponential (log) phase in liquid culture',
    std: ['during exponential growth', 'in exponential-phase cultures', 'in mid-log-phase cells'],
    nonstd: ['in stationary-phase cells', 'under nitrogen starvation', 'in cells from 7-day-old colonies'],
    units: [U('µm', 1, ['µm', 'μm', 'micrometres']), U('nm', 0.001, ['nm'], { w: ['nanometres'] })],
  },
  'optimal growth temperature': {
    kind: 'organism', unit: '°C', range: [22, 58], better: 'up', tempLike: true,
    names: ['optimal growth temperature', 'optimum growth temperature', 'temperature optimum for growth'],
    stdDesc: 'in liquid medium at neutral pH (6.5–7.5) with no added salt',
    std: ['in liquid medium at pH 7.0', 'in neutral (pH 7.2) broth', 'in liquid culture at neutral pH'],
    nonstd: ['in acidified medium at pH 5.0', 'in medium containing 8% NaCl', 'in liquid medium at pH 9.0'],
    units: CELSIUS,
  },
};

export const KIND_PROPS = {
  compound: ['aqueous solubility', 'melting point', 'plasma half-life', 'enzyme IC50'],
  material: ['density', 'tensile strength', 'thermal conductivity', 'band gap'],
  organism: ['doubling time', 'genome size', 'cell length', 'optimal growth temperature'],
};

export const KIND_PLURAL = { compound: 'compounds', material: 'materials', organism: 'microorganisms' };

// Forms that are *not* the entity itself (salts, hydrates, doped/composite/porous forms, mutants).
export const VARIANTS = {
  compound: [n => `${n} hydrochloride`, n => `the sodium salt of ${n}`, n => `${n} monohydrate`, n => `the mesylate salt of ${n}`, n => `${n} dihydrate`],
  material: [n => `5%-Al-doped ${n}`, n => `a ${n}–graphite composite`, n => `nitrogen-doped ${n}`, n => `a porous ${n} foam`, n => `a ${n}–SiC composite`],
  organism: [n => `the ΔpilA mutant of ${n}`, n => `a ΔrecA derivative of ${n}`, n => `a plasmid-cured derivative of ${n}`, n => `a streptomycin-resistant derivative of ${n}`, n => `an evolved descendant of ${n} (500 generations)`],
};
// Explicitly unmodified forms: these ARE the entity itself (red herrings for variant keyword filters).
export const UNMODIFIED = {
  compound: [n => `${n} (free base)`, n => `the free base of ${n}`, n => `unsalted ${n}`],
  material: [n => `undoped ${n}`, n => `phase-pure, undoped ${n}`, n => `monolithic ${n}`],
  organism: [n => `wild-type ${n}`, n => `the wild-type strain of ${n}`, n => `${n} (wild type)`],
};
// Anaphors used after the first mention of a document's own entity.
export const ANAPHORS = { compound: ['the compound', 'this compound'], material: ['the material', 'this material'], organism: ['the isolate', 'this strain', 'the organism'] };

export const ENTITY_CLASS = {
  compound: ['kinase inhibitor', 'antifungal candidate', 'ion-channel modulator', 'antiviral lead', 'anti-inflammatory candidate'],
  material: ['refractory ceramic', 'light-metal alloy', 'layered semiconductor', 'glass-ceramic', 'high-entropy alloy'],
  organism: ['Gram-negative rod', 'halotolerant bacterium', 'soil actinomycete', 'thermotolerant coccus', 'marine spirillum'],
};
export const ENTITY_ORIGIN = {
  compound: ['a fragment-based screen', 'a natural-product extract', 'a scaffold-hopping campaign', 'a phenotypic screen'],
  material: ['a combinatorial sputtering survey', 'a solid-state synthesis programme', 'arc-melting trials', 'a sol–gel route'],
  organism: ['a hot-spring mat', 'estuarine sediment', 'a compost heap', 'a salt-marsh core', 'a cave biofilm'],
};

// Name syllables. Combinations are invented; collisions with real names are avoided by
// keeping unusual suffixes and checking a small deny list.
export const SYL = ['ve', 'ra', 'li', 'do', 'ka', 'to', 'mi', 'ne', 'sa', 'ro', 'fe', 'lu', 'ta', 'vo', 'ze', 'pa', 'ri', 'no', 'be', 'qua', 'tes', 'mor', 'cal', 'dra', 'nil', 'xo', 'ul', 'fen', 'sor', 'tav'];
export const ALT_VOWEL = { a: 'o', e: 'i', i: 'e', o: 'a', u: 'o' };
export const SUFFIX = {
  compound: ['lide', 'dranol', 'vexin', 'tazol', 'morane', 'quilin', 'fenate', 'borix'],
  material: ['ite', 'orite', 'alene', 'astite', 'umide', 'elite'],
  organismGenus: ['bacter', 'vibrio', 'monas', 'coccus', 'spira', 'myces'],
  organismSpecies: ['ensis', 'ica', 'ophila', 'iana', 'oides'],
};
export const DENY = new Set(['ritonavir', 'tetralide', 'saline', 'ferrite', 'calcite', 'vibrio', 'rabies']);

export const SURNAMES = ['Okafor', 'Brandt', 'Lindqvist', 'Haddad', 'Moreau', 'Tanaka', 'Kowalczyk', 'Ferreira', 'Nakamura', 'Osei',
  'Varga', 'Petrov', 'Iyer', 'Castillo', 'Novak', 'Halloran', 'Achterberg', 'Szabo', 'Quispe', 'Mwangi', 'Rasmussen', 'Delacroix',
  'Yilmaz', 'Abiodun', 'Kerrigan', 'Zhou', 'Bergstrom', 'Esposito', 'Okonkwo', 'Hartmann', 'Vasquez', 'Ruiz', 'Lebedev', 'Arslan',
  'Mbatha', 'Sato', 'Fitzgerald', 'Kaur', 'Nieminen', 'Dimitrov', 'Ostrowski', 'Banerjee', 'Ulloa', 'Thorsen', 'Adeyemi', 'Kimura',
  'Marchetti', 'Holloway', 'Rahman', 'Sorensen', 'Cardoso', 'Wexler', 'Pham', 'Galloway', 'Ibarra', 'Lund', 'Oyelaran', 'Takeda'];
export const INITIALS = 'ABCDEFGHIJKLMNOPRSTVWY';

export const JOURNALS = {
  compound: ['Halvorsen Journal of Medicinal Chemistry', 'Annals of the Corvin Pharmacological Society', 'Proceedings of the Ardent Society for Molecular Science', 'Letters in Fictive Drug Discovery'],
  material: ['Transactions of the Meridian Materials Society', 'Bellmoor Journal of Solid-State Research', 'Journal of the Selwyn Institute for Applied Physics', 'Kestrel Letters in Materials'],
  organism: ['Northgate Letters in Microbiology', 'Calder Review of Microbial Physiology', 'Journal of Tamsin Bay Microbial Ecology', 'Proceedings of the Orrel Society for Bacteriology'],
};
export const PREPRINT_SERVERS = ['OpenBench Preprints', 'Quillarchive', 'Lumen Preprint Server'];
export const INSTITUTES = ['Kestrel Institute', 'University of Harrowgate', 'Velde Polytechnic', 'Arnault Research Centre', 'Tamsin Bay University', 'Orrel College', 'Calder Laboratories'];
export const COMPANIES = {
  compound: ['Solvantis Therapeutics', 'Tavimo Pharma', 'Quellbrook Biosciences'],
  material: ['Corvane Materials', 'Orrinth Advanced Ceramics', 'Halberd Alloys'],
  organism: ['Kelpra Biologics', 'Marrow Lane Fermentation', 'Ostrel Bioworks'],
};

export const TYPE_LABELS = {
  journal: { plain: 'journal article (peer-reviewed)', mixed: ['Research article', 'Original article', 'Article', 'Letter', 'Full paper'] },
  preprint: { plain: 'preprint (not peer-reviewed)', mixed: ['Preprint', 'Preprint (not peer reviewed)', 'Preprint'] },
  labnote: { plain: 'lab notebook / internal memo (not peer-reviewed)', mixed: ['Lab notebook entry', 'Internal technical memo', 'Lab note'] },
  press: { plain: 'press release', mixed: ['Press release', 'News release', 'Media announcement'] },
  erratum: { plain: 'erratum', mixed: ['Erratum', 'Correction', 'Corrigendum'] },
  retraction: { plain: 'retraction notice', mixed: ['Retraction', 'Retraction notice', 'Notice of retraction'] },
  concern: { plain: 'expression of concern', mixed: ['Expression of concern', 'Editorial expression of concern'] },
};

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

export const RETRACTION_REASONS = ['an error in the instrument calibration invalidated the reported measurements',
  'the authors could not reproduce the key measurements', 'duplicated figure panels were identified during an institutional review',
  'the samples were found to be contaminated', 'the analysis relied on a mislabelled sample set',
  'the raw instrument files could not be matched to the reported tables', 'a spreadsheet error propagated into the summary statistics'];
export const CONCERN_REASONS = ['the provenance of some raw data files', 'possible image duplication in a supplementary figure',
  'an undeclared competing interest', 'the statistical treatment of replicate measurements',
  'the identity of one reagent lot', 'the handling of outlying replicates'];

// ---------------------------------------------------------------------------------------
// Parametric measurement conditions (difficulty >= 2). A condition is built from parts; the
// standard condition takes the standard option of every part, a non-standard condition
// deviates in exactly one part. Temperatures are given in °C and rendered in °C, K or °F, so
// deciding whether a condition is standard needs unit conversion and the prose window.
const Tc = list => ({ temp: list });
export const COND = {
  'aqueous solubility': {
    parts: {
      medium: [['water', 'pure water', 'deionised water', 'ultrapure water', 'distilled water', 'Milli-Q water', 'unbuffered water'],
        ['phosphate buffer (pH 7.4)', '0.1 M hydrochloric acid', '0.9% saline', 'simulated gastric fluid', 'ethanol', 'DMSO', 'water containing 10% ethanol', 'acetate buffer (pH 4.5)', '0.01 M sodium hydroxide']],
      ...Tc([[25], [4, 10, 20, 30, 37, 45]]),
    },
    fmt: p => `in ${p.medium} at ${p.temp}`,
  },
  'melting point': {
    parts: {
      s: [['at atmospheric pressure', 'at ambient pressure', 'at 1 atm', 'at 101.3 kPa', 'at 1.013 bar', 'at 760 mmHg', 'by DSC at ambient pressure', 'in an open capillary at ambient pressure'],
        ['under 1.2 GPa of hydrostatic pressure', 'at 0.5 GPa in a diamond-anvil cell', 'under 300 MPa of pressure', 'at 2 kbar', 'under 50 atm of argon', 'at 15 MPa in a sealed cell']],
    },
    fmt: p => p.s,
  },
  'plasma half-life': {
    parts: {
      s: [['in healthy human volunteers', 'in human subjects', 'in a first-in-human study', 'in adult patients', 'in a phase 1 study in healthy adults', 'in elderly patients', 'in healthy volunteers after a single oral dose'],
        ['in mice', 'in rats', 'in beagle dogs', 'in cynomolgus monkeys', 'in minipigs', 'in human plasma in vitro', 'in human liver microsomes', 'in pooled human hepatocytes']],
    },
    fmt: p => p.s,
  },
  'enzyme IC50': {
    parts: {
      s: [['in a cell-free enzyme assay', 'against the purified enzyme', 'in the biochemical (cell-free) assay', 'using recombinant purified enzyme', 'against isolated recombinant enzyme'],
        ['in a whole-cell assay', 'in cultured cells', 'in a cell-based reporter assay', 'in HEK293 cells', 'in human whole blood']],
    },
    fmt: p => p.s,
  },
  density: {
    parts: {
      form: [['dense bulk samples', 'the bulk solid', 'fully dense bulk specimens', 'bulk pieces (helium pycnometry)', 'hot-pressed specimens of full density'],
        ['a loose powder (tap density)', 'the porous foam form', 'a sintered compact with 30% porosity', 'a partially sintered pellet (78% of theoretical density)']],
      ...Tc([[21, 22, 23, 24], [-196, 400, 600, 900]]),
    },
    fmt: p => `for ${p.form} at ${p.temp}`,
  },
  'tensile strength': {
    parts: {
      state: [['as-received specimens', 'as-received material', 'specimens in the as-received condition', 'untreated dog-bone specimens'],
        ['specimens after 1000 h of salt-spray exposure', 'neutron-irradiated specimens', 'specimens cold-rolled to 50% reduction', 'specimens heat-aged for 500 h']],
      ...Tc([[21, 22, 23, 24], [-196, -40, 150, 400, 600]]),
    },
    fmt: p => `at ${p.temp} on ${p.state}`,
  },
  'thermal conductivity': {
    parts: { ...Tc([[23, 25, 27, 30], [-269, -196, -73, 127, 227, 527]]) },
    fmt: p => `at ${p.temp}`,
    fixed: [['at room temperature (298 K)'], []],
  },
  'band gap': {
    parts: { ...Tc([[20, 22, 24], [-269, -263, -196, 127, 227]]), press: [['', '', ' and ambient pressure'], [' under 3 GPa of pressure', ' in a diamond-anvil cell at 5 GPa']] },
    fmt: p => `at ${p.temp}${p.press}`,
  },
  'doubling time': {
    parts: {
      medium: [['rich broth', 'complex medium', 'LB broth', 'tryptic soy broth', 'nutrient broth', 'nutrient-rich broth'],
        ['M9 minimal medium', 'minimal medium with glucose as the sole carbon source', 'a defined minimal medium']],
      ...Tc([[30], [15, 20, 25, 37, 42]]),
      air: [['', '', ' under aerobic conditions', ' with shaking (aerobic)'], [' under anaerobic conditions', ' in an anaerobic chamber', ' without oxygen']],
    },
    fmt: p => `in ${p.medium} at ${p.temp}${p.air}`,
  },
  'genome size': {
    parts: {
      s: [['from the complete (closed) genome assembly', 'based on the finished, closed genome sequence', 'from a complete hybrid assembly', 'from a closed long-read assembly of the chromosome and its plasmids'],
        ['from a draft assembly of 112 contigs', 'estimated by pulsed-field gel electrophoresis', 'from a fragmented short-read draft assembly', 'from a k-mer-based estimate on raw reads', 'estimated by flow cytometry']],
    },
    fmt: p => p.s,
  },
  'cell length': {
    parts: {
      s: [['during exponential growth', 'in exponential-phase cultures', 'in mid-log-phase cells', 'in early-log-phase liquid cultures', 'in liquid culture during log phase'],
        ['in stationary-phase cells', 'under nitrogen starvation', 'in cells from 7-day-old colonies', 'in cells scraped from agar plates', 'in filaments formed under antibiotic stress']],
    },
    fmt: p => p.s,
  },
  'optimal growth temperature': {
    parts: {
      medium: [['liquid medium', 'broth', 'liquid culture'], ['agar plates']],
      ph: [['pH 6.8', 'pH 7.0', 'pH 7.2', 'pH 7.4'], ['pH 4.5', 'pH 5.0', 'pH 5.5', 'pH 8.5', 'pH 9.0', 'pH 9.5']],
      salt: [[''], [' with 6% added NaCl', ' with 8% added NaCl']],
    },
    fmt: p => `${p.medium === 'agar plates' ? 'on' : 'in'} ${p.medium} at ${p.ph}${p.salt}`,
    fixed: [['in liquid culture at neutral pH', 'in broth buffered to pH 7.0'], ['in acidified medium at pH 5.0']],
  },
};

// A temperature given in °C, rendered in °C, K or °F (Unicode minus for negatives).
export function tempText(c, r) {
  const minus = x => String(x).replace('-', '−');
  const u = r.int(0, 5);
  if (u <= 2) return `${minus(c)} °C`;
  if (u <= 4) return `${c === 25 && r.chance(0.3) ? '298.15' : Math.round(c + 273.15)} K`;
  return `${minus(Math.round(c * 9 / 5 + 32))} °F`;
}

// Condition text for a claim. Level 1 uses the short fixed lists in PROPS; level >= 2 the
// parametric builder above (exactly one part deviates for a non-standard condition).
export function condFor(prop, std, r, level) {
  const P = PROPS[prop];
  if (level <= 1) return r.pick(std ? P.std : P.nonstd);
  const C = COND[prop];
  const fixed = C.fixed && C.fixed[std ? 0 : 1];
  if (fixed && fixed.length && r.chance(0.2)) return r.pick(fixed);
  const names = Object.keys(C.parts);
  const dev = std ? null : r.pick(names.filter(k => C.parts[k][1].length));
  const parts = {};
  for (const k of names) {
    const v = r.pick(C.parts[k][k === dev ? 1 : 0]);
    parts[k] = k === 'temp' ? tempText(v, r) : v;
  }
  return C.fmt(parts);
}

// Method details that carry a number in the same unit family as the measured value (the
// measurement is the other number): "after a 2 h infusion, the half-life was 12 h".
export const METHOD_DETAIL = {
  'aqueous solubility': [['starting from a', [20, 50, 100], 'mg/mL', 'suspension']],
  'melting point': [['at a heating rate of', [2, 5, 10], '°C', 'per minute']],
  'plasma half-life': [['after a', [1, 2, 4], 'h', 'infusion']],
  'enzyme IC50': [['in the presence of', [10, 50, 100], 'µM', 'ATP']],
  density: [['calibrated against a', [2.7, 7.87], 'g/cm³', 'metal standard']],
  'tensile strength': [['after a', [5, 10, 20], 'MPa', 'preload']],
  'thermal conductivity': [['against a reference sample of', [1.4, 15, 150], 'W/(m·K)', '']],
  'band gap': [['with', [3.8, 4.9, 6.2], 'eV', 'excitation']],
  'doubling time': [['after a', [20, 30, 45], 'min', 'lag phase']],
  'genome size': [['from', [12, 15, 20], 'kb', 'long reads']],
  'cell length': [['using', [200, 500], 'nm', 'beads as a size standard']],
  'optimal growth temperature': [['with cultures pre-grown at', [25, 30], '°C', '']],
};
