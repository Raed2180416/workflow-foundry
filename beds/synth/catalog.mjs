// Static pools for the `synth` (research synthesis) bed: properties with canonical units,
// unit variants, standard and non-standard measurement conditions, and fictional name pools.
// Everything here is invented for this bed; no entity, venue or organisation is real.

// A unit converts a written number to the canonical unit as canonical = written * f + o.
const U = (id, f, sym, extra = {}) => ({ id, f, o: 0, sym, ...extra });
const CELSIUS = [U('°C', 1, ['°C']), U('K', 1, ['K'], { o: -273.15 }), U('°F', 5 / 9, ['°F'], { o: -32 * 5 / 9 })];

export const PROPS = {
  'aqueous solubility': {
    kind: 'compound', unit: 'mg/mL', range: [0.4, 38], better: 'up', tempLike: false,
    names: ['aqueous solubility', 'solubility in water', 'water solubility'],
    stdDesc: 'in pure water (no buffer, acid, base or co-solvent) at 25 °C (298 K)',
    std: ['in water at 25 °C', 'in water at 298 K', 'in deionised water at 25 °C', 'in pure water at 298.15 K', 'in ultrapure water at 25 °C'],
    nonstd: ['in water at 37 °C', 'in water at 310 K', 'in ethanol at 25 °C', 'in DMSO at 25 °C', 'in 0.1 M hydrochloric acid at 25 °C', 'in phosphate buffer (pH 7.4) at 25 °C', 'in water at 4 °C'],
    units: [U('mg/mL', 1, ['mg/mL', 'mg mL⁻¹', 'mg·mL⁻¹']), U('g/L', 1, ['g/L', 'g L⁻¹']), U('µg/mL', 0.001, ['µg/mL', 'μg mL⁻¹', 'µg·mL⁻¹']),
      U('mg/L', 0.001, ['mg/L', 'mg L⁻¹']), U('mg/100 mL', 0.01, ['mg/100 mL', 'mg per 100 mL'])],
  },
  'melting point': {
    kind: 'compound', unit: '°C', range: [85, 255], better: 'up', tempLike: true,
    names: ['melting point', 'melting temperature', 'onset of melting'],
    stdDesc: 'at atmospheric pressure (about 101 kPa)',
    std: ['at atmospheric pressure', 'at ambient pressure', 'at 1 atm', 'at 101.3 kPa', 'by DSC at ambient pressure'],
    nonstd: ['under 1.2 GPa of hydrostatic pressure', 'at 0.5 GPa in a diamond-anvil cell', 'under 300 MPa of pressure'],
    units: CELSIUS,
  },
  'plasma half-life': {
    kind: 'compound', unit: 'h', range: [1.6, 58], better: 'up', tempLike: false,
    names: ['plasma half-life', 'elimination half-life', 'terminal half-life'],
    stdDesc: 'elimination half-life measured in vivo in humans (healthy volunteers or patients)',
    std: ['in healthy human volunteers', 'in human subjects', 'in a first-in-human study', 'in adult patients'],
    nonstd: ['in mice', 'in rats', 'in beagle dogs', 'in cynomolgus monkeys', 'in human plasma in vitro'],
    units: [U('h', 1, ['h', 'hours', 'hr']), U('min', 1 / 60, ['min', 'minutes']), U('days', 24, ['days', 'days'])],
  },
  'enzyme IC50': {
    kind: 'compound', unit: 'nM', range: [2.5, 850], better: 'down', tempLike: false,
    names: ['IC50', 'half-maximal inhibitory concentration (IC50)', 'enzyme IC50'],
    stdDesc: 'in a cell-free assay with purified enzyme',
    std: ['in a cell-free enzyme assay', 'against the purified enzyme', 'in the biochemical (cell-free) assay', 'using recombinant purified enzyme'],
    nonstd: ['in a whole-cell assay', 'in cultured cells', 'in a cell-based reporter assay'],
    units: [U('nM', 1, ['nM']), U('µM', 1000, ['µM', 'μM']), U('pM', 0.001, ['pM']), U('M', 1e9, ['M'], { sci: true })],
  },
  density: {
    kind: 'material', unit: 'g/cm³', range: [1.3, 9.4], better: 'down', tempLike: false,
    names: ['density', 'bulk density', 'mass density'],
    stdDesc: 'of the fully dense bulk solid at room temperature (20–25 °C)',
    std: ['for dense bulk samples at room temperature', 'of the bulk solid at 20 °C', 'by helium pycnometry on bulk pieces at 23 °C', 'of fully dense bulk specimens at 25 °C'],
    nonstd: ['as a loose powder (tap density)', 'for the porous foam form at room temperature', 'at 900 °C', 'for a sintered compact with 30% porosity'],
    units: [U('g/cm³', 1, ['g/cm³', 'g cm⁻³', 'g/cc']), U('kg/m³', 0.001, ['kg/m³', 'kg m⁻³']), U('g/mL', 1, ['g/mL'])],
  },
  'tensile strength': {
    kind: 'material', unit: 'MPa', range: [85, 2300], better: 'up', tempLike: false,
    names: ['tensile strength', 'ultimate tensile strength', 'UTS'],
    stdDesc: 'at room temperature (20–25 °C) on as-received material',
    std: ['at room temperature', 'at 23 °C', 'at 296 K', 'under ambient laboratory conditions (22 °C)'],
    nonstd: ['at 600 °C', 'at 77 K', 'at −196 °C', 'at 873 K'],
    units: [U('MPa', 1, ['MPa', 'N/mm²']), U('GPa', 1000, ['GPa']), U('ksi', 6.894757, ['ksi']), U('psi', 0.006894757, ['psi'])],
  },
  'thermal conductivity': {
    kind: 'material', unit: 'W/(m·K)', range: [0.6, 380], better: 'up', tempLike: false,
    names: ['thermal conductivity', 'room-temperature thermal conductivity', 'thermal conductivity κ'],
    stdDesc: 'near room temperature (295–305 K)',
    std: ['at 300 K', 'at 27 °C', 'at room temperature (298 K)', 'at 25 °C'],
    nonstd: ['at 77 K', 'at 800 K', 'at 500 °C', 'at 4 K'],
    units: [U('W/(m·K)', 1, ['W/(m·K)', 'W m⁻¹ K⁻¹', 'W/m·K']), U('mW/(m·K)', 0.001, ['mW/(m·K)', 'mW m⁻¹ K⁻¹']), U('W/(cm·K)', 100, ['W/(cm·K)', 'W cm⁻¹ K⁻¹'])],
  },
  'band gap': {
    kind: 'material', unit: 'eV', range: [0.45, 5.4], better: 'up', tempLike: false,
    names: ['band gap', 'optical band gap', 'bandgap'],
    stdDesc: 'at room temperature (290–300 K) and ambient pressure',
    std: ['at room temperature', 'at 295 K', 'at 22 °C', 'at 298 K'],
    nonstd: ['at 4 K', 'at 10 K', 'at 77 K', 'under 3 GPa of pressure'],
    units: [U('eV', 1, ['eV']), U('meV', 0.001, ['meV'])],
  },
  'doubling time': {
    kind: 'organism', unit: 'min', range: [19, 290], better: 'down', tempLike: false,
    names: ['doubling time', 'generation time', 'mass-doubling time'],
    stdDesc: 'in rich (complex) liquid medium at 30 °C, aerobic (cultures are aerobic unless stated otherwise)',
    std: ['in rich broth at 30 °C', 'in rich medium at 303 K', 'in nutrient-rich broth at 30 °C under aerobic conditions', 'in complex medium at 30 °C'],
    nonstd: ['in minimal medium at 30 °C', 'in rich broth at 15 °C', 'in rich broth at 288 K', 'in rich broth at 30 °C under anaerobic conditions'],
    units: [U('min', 1, ['min', 'minutes']), U('h', 60, ['h', 'hours']), U('s', 1 / 60, ['s', 'seconds'])],
  },
  'genome size': {
    kind: 'organism', unit: 'Mbp', range: [1.3, 9.6], better: 'up', tempLike: false,
    names: ['genome size', 'total genome length', 'genome length'],
    stdDesc: 'total size from a complete (closed) genome assembly',
    std: ['from the complete (closed) genome assembly', 'based on the finished, closed genome sequence', 'from a complete hybrid assembly'],
    nonstd: ['from a draft assembly of 112 contigs', 'estimated by pulsed-field gel electrophoresis', 'from a fragmented short-read draft assembly'],
    units: [U('Mbp', 1, ['Mbp', 'Mb']), U('kbp', 0.001, ['kbp', 'kb']), U('bp', 1e-6, ['bp'], { sci: true })],
  },
  'cell length': {
    kind: 'organism', unit: 'µm', range: [0.7, 11.5], better: 'up', tempLike: false,
    names: ['cell length', 'mean cell length', 'average cell length'],
    stdDesc: 'of cells in exponential (log) phase in liquid culture',
    std: ['during exponential growth', 'in exponential-phase cultures', 'in mid-log-phase cells'],
    nonstd: ['in stationary-phase cells', 'under nitrogen starvation', 'in cells from 7-day-old colonies'],
    units: [U('µm', 1, ['µm', 'μm', 'micrometres']), U('nm', 0.001, ['nm'])],
  },
  'optimal growth temperature': {
    kind: 'organism', unit: '°C', range: [22, 58], better: 'up', tempLike: true,
    names: ['optimal growth temperature', 'optimum growth temperature', 'temperature optimum for growth'],
    stdDesc: 'in liquid medium at neutral pH (6.5–7.5)',
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

// Forms that are *not* the entity itself (salts, doped variants, mutants).
export const VARIANTS = {
  compound: [n => `${n} hydrochloride`, n => `the sodium salt of ${n}`, n => `${n} monohydrate`],
  material: [n => `5%-Al-doped ${n}`, n => `a ${n}–graphite composite`, n => `nitrogen-doped ${n}`],
  organism: [n => `the ΔpilA mutant of ${n}`, n => `a ΔrecA derivative of ${n}`, n => `a plasmid-cured derivative of ${n}`],
};

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
  'the samples were found to be contaminated', 'the analysis relied on a mislabelled sample set'];
export const CONCERN_REASONS = ['the provenance of some raw data files', 'possible image duplication in a supplementary figure',
  'an undeclared competing interest', 'the statistical treatment of replicate measurements'];
