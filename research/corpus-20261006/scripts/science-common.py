"""Shared helpers for the science cluster converters (foundry-corpus-item/1).

Re-uses the item builder, feature computation and licence heuristics of orchestration-common.py
(same directory, loaded with importlib) so that features mean the same thing across clusters, and
adds science-specific classification of steps (tool packages, external data services, ML inference,
domains). Pure functions over already-parsed data; nothing here executes corpus content.

Science-cluster feature conventions (also stated in parts/science-ledger.md):
  nodes        executable steps (Nextflow process invocations, Galaxy steps, CWL steps, Snakemake
               rules, WDL calls) after inlining static sub-workflows, plus input/parameter steps
               (category other), operator nodes (Nextflow branch/multiMap -> condition) and
               lifecycle hooks (completion e-mail/IM notification, onError handler)
  category     curated tool wrapper (nf-core module, Galaxy tool, CWL CommandLineTool, Snakemake
               wrapper, WDL task) -> action; pipeline-local script/inline code -> code; ML inference
               tool (AlphaFold, DeepVariant, Cellpose, Dorado, ...) -> model; format/compression
               utilities -> transform; data fetch from public archives -> action with effects read
  effects      steps that materialise outputs in persistent storage (publishDir, Galaxy history,
               workflow outputs) -> write; public-archive downloads -> read; notifications/uploads
               to third-party services -> external; inputs/params/operators -> none
  branching    decision points: if/else chains or `when` guards that gate >=1 step, plus condition nodes
  loops        runtime fan-out constructs over data whose size is known only at run time (CWL scatter,
               Galaxy collection inputs and collection-splitting tools, Nextflow flatten/splitX/
               transpose/samplesheet channels, Snakemake wildcard rules aggregated with expand(),
               WDL scatter) plus explicit iteration (Nextflow recurse/until, Snakemake checkpoint loops)
  connectors   `tool:<package>` for every distinct tool package and `service:<name>` for every
               external data service / notification channel referenced
  subworkflows number of sub-workflow invocations (inlined into the graph; counted here)
"""
import importlib.util, json, os, re

_spec = importlib.util.spec_from_file_location("orchestration_common", os.path.join(os.path.dirname(os.path.abspath(__file__)), "orchestration-common.py"))
oc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(oc)

make_item = oc.make_item
compute_features = oc.compute_features
ir_verdict = oc.ir_verdict
trim = oc.trim
dedupe_edges = oc.dedupe_edges
classify_license_text = oc.classify_license_text
write_jsonl = oc.write_jsonl
complexity = oc.complexity
PERMISSIVE = set(oc.PERMISSIVE) | {"CC-BY-3.0", "AFL-3.0"}  # share-alike/copyleft/NC stay non-redistributable
RETRIEVED = "2026-10-06"
WORK = "/opt/corpus/science-work"

# ML inference tools (local model inference, not hosted LLM APIs)
MODEL_RX = re.compile(r"(?i)alphafold|colabfold|esmfold|\besm2?\b|rosettafold|\bboltz|chai[-_]?1|helixfold|openfold|proteinmpnn|"
                      r"rfdiffusion|deepvariant|deeptrio|deepsomatic|clair3|cellpose|stardist|mesmer|deepcell|dorado|guppy|"
                      r"bonito|medaka|cellbender|\bscvi|scanvi|celltypist|mhcflurry|netmhc|deepbgc|deeparg|ampir|amplify|"
                      r"macrel|tensorflow|pytorch|keras|scgpt|geneformer|nnunet|ilastik|deeplc|ms2pip|prosit|alphapeptdeep|"
                      r"casanovo|deepnovo|instanovo|spotiflow|deepsignal|remora|nanopolish_call_methylation|modkit|"
                      r"genomad|virsorter2|deepmicrobes|deeptmhmm|signalp|targetp|deeploc|bakta_?.*proteins_ml|"
                      r"llm|openai|anthropic|chatgpt|gpt-?4|ollama|huggingface|transformers")
# public data services (downloads / submission / notifications)
SERVICE_RULES = [
    ("sra", r"(?i)sratools|sra[-_]?tools|fasterq|fastq[-_]?dump|prefetch|\bsra\b|sra_ids|fromsra"),
    ("ena", r"(?i)\bena\b|ena[-_]|enaBrowser|ebi\.ac\.uk/ena|webin"),
    ("ncbi", r"(?i)ncbi|entrez|efetch|esearch|genbank|refseq_download|datasets_download|acc_download"),
    ("geo", r"(?i)\bgeo\b|geoquery|geofetch"),
    ("synapse", r"(?i)synapse"),
    ("uniprot", r"(?i)uniprot"),
    ("pdb", r"(?i)\bpdb_?(get|fetch|download)|rcsb"),
    ("ensembl", r"(?i)ensembl|biomart"),
    ("igenomes-s3", r"(?i)igenomes|s3://"),
    ("zenodo", r"(?i)zenodo"),
    ("figshare", r"(?i)figshare"),
    ("http-download", r"(?i)\bwget\b|\bcurl\b|aria2|__DATA_FETCH__|url_download|download"),
    ("gtdb", r"(?i)gtdb"),
    ("kegg", r"(?i)\bkegg"),
    ("pubchem", r"(?i)pubchem"),
    ("chembl", r"(?i)chembl"),
    ("copernicus", r"(?i)copernicus|cdsapi"),
    ("email", r"(?i)completionEmail|sendmail|EmailAction|\bmail\b"),
    ("im-webhook", r"(?i)imNotification|hook_url|slack|teams_webhook"),
    ("galaxy-export", r"(?i)export_remote|__EXPORT_HISTORY|send_to_cloud|irods"),
    ("dataverse", r"(?i)dataverse"),
    ("omero", r"(?i)omero"),
    ("idr", r"(?i)\bidr\b|idr_download"),
    ("bold", r"(?i)\bbold\b"),
    ("gbif", r"(?i)gbif"),
    ("obis", r"(?i)\bobis\b"),
]
READ_SERVICES = {"sra", "ena", "ncbi", "geo", "synapse", "uniprot", "pdb", "ensembl", "igenomes-s3", "zenodo",
                 "figshare", "http-download", "gtdb", "kegg", "pubchem", "chembl", "copernicus", "dataverse",
                 "omero", "idr", "bold", "gbif", "obis"}
EXTERNAL_SERVICES = {"email", "im-webhook", "galaxy-export"}
TRANSFORM_PKGS = {"gunzip", "gzip", "untar", "unzip", "cat", "tabix", "bgzip", "csvtk", "custom", "seqkit",
                  "pigz", "tar", "xz", "zcat", "cut", "sort", "join", "concatenate", "convert", "awk", "sed",
                  "column_maker", "datamash", "text_processing", "tp", "collapse_dataset", "filter", "grep1",
                  "join1", "cat1", "sort1", "comp1", "addvalue", "cut1", "replace", "regex", "split"}


def services_for(text):
    out = []
    for name, rx in SERVICE_RULES:
        if re.search(rx, text or ""):
            out.append(name)
    return out


def classify_step(text, package, *, curated=True):
    """-> (category, effects, services). text = tool id/name + command fragments."""
    svcs = services_for(text)
    if MODEL_RX.search(text or ""):
        return "model", "write", svcs
    if any(s in EXTERNAL_SERVICES for s in svcs):
        return "action", "external", svcs
    if any(s in READ_SERVICES for s in svcs):
        return "action", "read", svcs
    if (package or "").lower() in TRANSFORM_PKGS:
        return "transform", "write", svcs
    return ("action" if curated else "code"), "write", svcs


DOMAIN_RULES = [
    ("genomics", r"genom|dna|wgs|wes|exome|variant|snp|indel|vcf|gatk|bwa|bowtie|minimap|align|mapping|sarek|deepvariant"),
    ("variant-calling", r"variant|vcf|gatk|haplotypecaller|mutect|freebayes|deepvariant|bcftools|strelka|snv|cnv|structural.?variant"),
    ("transcriptomics", r"rna.?seq|transcript|salmon|kallisto|star\b|hisat|deseq|edger|expression|isoform|splic|fusion|smrna|mirna"),
    ("single-cell", r"single.?cell|scrna|sc.?rna|10x|cellranger|scanpy|seurat|alevin|starsolo|spatial|visium"),
    ("epigenomics", r"chip.?seq|atac|methyl|bisulfite|cut.?and|cutandrun|hi.?c\b|chromatin|epigen|peak|macs2|macs3"),
    ("metagenomics", r"metagenom|microbiom|taxonom|kraken|metaphlan|16s|amplicon|mag\b|mags|binning|qiime|taxprofil|virome|pathogen"),
    ("assembly", r"assembl|contig|scaffold|hifiasm|spades|flye|canu|megahit|purge|polish|hi.?c.?scaffold|vgp"),
    ("annotation", r"annotat|prokka|bakta|braker|maker|funannotate|interpro|eggnog|busco|repeat"),
    ("proteomics", r"proteom|peptide|mass.?spec|\bms\b|maxquant|openms|msgf|comet|spectra|dia\b|dda\b|tmt|lfq|quantms"),
    ("metabolomics", r"metabolom|lipidom|xcms|camera|ms2|gnps|metfrag"),
    ("structural-biology", r"protein.?fold|alphafold|colabfold|esmfold|structure|pdb\b|docking|molecular.?dynamics|gromacs|md\b|cryo"),
    ("imaging", r"imag|microscop|cell.?segment|cellpose|stardist|\btiff?\b|ome-?(tiff|zarr)|mcmicro|cell.?painting|histolog"),
    ("phylogenetics", r"phylo|tree|iqtree|raxml|mafft|alignment|msa\b|orthol|pangenom"),
    ("virology", r"virus|viral|sars|covid|influenza|mpox|hiv|virolog"),
    ("long-read", r"nanopore|\bont\b|pacbio|hifi|long.?read|dorado|minion"),
    ("chemistry", r"chemi|compound|ligand|smiles|rdkit|molecul|qsar|cheminf"),
    ("earth-science", r"climate|weather|ocean|earth|satellite|remote.?sensing|copernicus|ecolog|biodivers|species|gbif|obis|landsat|sentinel"),
    ("population-genetics", r"gwas|population|imputation|ancestry|kinship|relatedness|plink"),
    ("immunology", r"immun|hla|mhc|epitope|tcr|bcr|airr|repertoire"),
    ("clinical", r"clinical|patient|tumou?r|cancer|somatic|oncol|rare.?disease|diagnos"),
]


def domains_for(text, base=("science",)):
    t = (text or "").lower()
    out = list(base)
    for dom, rx in DOMAIN_RULES:
        if dom not in out and re.search(rx, t):
            out.append(dom)
    return out


def redistributable_license(spdx):
    return spdx in PERMISSIVE


SPDX_NORMALISE = {
    "mit": "MIT", "mit license": "MIT", "apache-2.0": "Apache-2.0", "apache 2.0": "Apache-2.0",
    "apache license 2.0": "Apache-2.0", "cc-by-4.0": "CC-BY-4.0", "cc-by 4.0": "CC-BY-4.0", "cc0-1.0": "CC0-1.0",
    "cc0": "CC0-1.0", "bsd-3-clause": "BSD-3-Clause", "bsd-2-clause": "BSD-2-Clause", "gpl-3.0": "GPL-3.0",
    "gpl-3.0-only": "GPL-3.0-only", "gpl-3.0-or-later": "GPL-3.0-or-later", "agpl-3.0": "AGPL-3.0",
    "agpl-3.0-or-later": "AGPL-3.0-or-later", "gpl-2.0": "GPL-2.0", "lgpl-3.0": "LGPL-3.0", "mpl-2.0": "MPL-2.0",
    "cc-by-sa-4.0": "CC-BY-SA-4.0", "cc-by-nc-4.0": "CC-BY-NC-4.0", "notspecified": "unknown", "none": "unknown",
    "other": "unknown", "": "unknown", "afl-3.0": "AFL-3.0", "unlicense": "Unlicense", "isc": "ISC",
    "epl-2.0": "EPL-2.0", "artistic-2.0": "Artistic-2.0", "bsl-1.0": "BSL-1.0", "cc-by-3.0": "CC-BY-3.0",
}


def norm_spdx(x):
    if x is None:
        return "unknown"
    s = str(x).strip()
    s = re.sub(r"^https?://(spdx\.org/licenses/|opensource\.org/licenses/)", "", s).rstrip("/").replace(".html", "")
    return SPDX_NORMALISE.get(s.lower(), s)


def save_work(platform, items, extra=None):
    os.makedirs(WORK, exist_ok=True)
    write_jsonl(f"{WORK}/{platform}.jsonl", items)
    if extra is not None:
        json.dump(extra, open(f"{WORK}/{platform}-stats.json", "w"), indent=1, default=list)
