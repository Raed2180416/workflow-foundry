import { createFlow } from './tools/flow.mjs';
import { createSop } from './tools/sop.mjs';
const flow = createFlow({ budgetUsd: 0.05 });
const sop = createSop(flow);
const task = flow.input();
import {
  videoReasons, environmentCheck, lidarReasons, detectionReasons, detectionFormat, segmentationReasons,
  qcReasons, humanReasons, outputPathReasons, num, yes,
} from './lib/rules.mjs';

// Section contract helpers (the portable JSON-schema subset that tools/flow.mjs checks).
const str = { type: 'string' }, nstr = { type: ['string', 'null'] }, nnum = { type: ['number', 'null'] };
const nbool = { type: ['boolean', 'null'] }, bool = { type: 'boolean' }, reasons = { type: 'array', items: str };
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', required, properties, additionalProperties: false });
const gateOut = (extra = {}) => obj({ passed: bool, reasons, ...extra });

const fieldsOf = r => (r.value && typeof r.value === 'object' && !Array.isArray(r.value) ? r.value : {});
// One tool request. A failure other than "no record" is asked once more; the tool's own error text becomes the reason.
async function callTool(port, name, args) {
  let r = await port.tryCall(name, args);
  if (!r.ok && !/no record/i.test(r.error)) r = await port.tryCall(name, args);
  return r;
}

const videoId = String(task.inputs?.video_id ?? '');
const stages = [];
const run = async (name, spec, input, fn) => {
  const out = await sop.section(name, spec, input, fn);
  stages.push({ section: name, passed: out.passed, reasons: out.reasons });
  return out;
};

// The procedure in SOP order. Each stage needs the one before it to pass (10.1), so the first failure ends the run.
async function annotate() {
  // 7.1 Video Format Verification (with the 5.1 environment constraints)
  const video = await run('7.1 Video Format Verification Protocol', {
    input: obj({ video_id: str }),
    output: gateOut({ video_path: nstr }),
    tools: ['validateVideoFormat'],
  }, { video_id: videoId }, async (input, port) => {
    const r = await callTool(port, 'validateVideoFormat', { video_id: input.video_id });
    if (!r.ok) return { passed: false, reasons: [`validateVideoFormat: ${r.error}`], video_path: null };
    const v = fieldsOf(r);
    const env = environmentCheck(v);
    for (const u of env.unclear) flow.flag('environment-unrecognized', { label: u });
    const reasons = [...videoReasons(v), ...env.reasons];
    const path = typeof v.video_path === 'string' && v.video_path ? v.video_path : null;
    if (!path) reasons.push('no video path');
    return { passed: reasons.length === 0, reasons, video_path: path };
  });
  if (!video.passed) return false;

  // 7.2 LiDAR Data Integration
  const lidar = await run('7.2 LiDAR Data Integration Framework', {
    input: obj({ video_id: str, video_path: str }),
    output: gateOut(),
    tools: ['validateLidarData'],
  }, { video_id: videoId, video_path: video.video_path }, async (input, port) => {
    const r = await callTool(port, 'validateLidarData', input);
    if (!r.ok) return { passed: false, reasons: [`validateLidarData: ${r.error}`] };
    const reasons = lidarReasons(fieldsOf(r));
    return { passed: reasons.length === 0, reasons };
  });
  if (!lidar.passed) return false;

  // 7.3 Object Detection Workflow Integration (5.2 confidence, tracking, ground truth)
  const detection = await run('7.3 Object Detection Workflow Integration', {
    input: obj({ video_id: str, video_path: str }),
    output: gateOut({ predicted_object: nstr, tracking_enabled: nbool, object_detection_output_path: nstr, output_format_object_detection: nstr }),
    tools: ['performObjectDetection'],
  }, { video_id: videoId, video_path: video.video_path }, async (input, port) => {
    const blank = { predicted_object: null, tracking_enabled: null, object_detection_output_path: null, output_format_object_detection: null };
    const r = await callTool(port, 'performObjectDetection', input);
    if (!r.ok) return { passed: false, reasons: [`performObjectDetection: ${r.error}`], ...blank };
    const v = fieldsOf(r);
    const reasons = detectionReasons(v);
    const path = typeof v.object_detection_output_path === 'string' && v.object_detection_output_path ? v.object_detection_output_path : null;
    if (!path) reasons.push('no object detection output path');
    const format = detectionFormat(v.output_format_object_detection, path);
    if (!format) reasons.push(`object detection output format ${JSON.stringify(v.output_format_object_detection ?? null)} is not json or xml`);
    const passed = reasons.length === 0;
    return passed
      ? { passed, reasons, predicted_object: String(v.predicted_object), tracking_enabled: yes(v.tracking_enabled), object_detection_output_path: path, output_format_object_detection: format }
      : { passed, reasons, ...blank };
  });
  if (!detection.passed) return false;

  // 7.4 Segmentation Process Implementation (5.2 predicted IoU, instance masks, temporal smoothing)
  const segmentation = await run('7.4 Segmentation Process Implementation', {
    input: obj({
      video_id: str, predicted_object: str, object_detection_output_path: str,
      output_format_object_detection: { type: 'string', enum: ['json', 'xml'] }, tracking_enabled: bool,
    }),
    output: gateOut({ predicted_iou: nnum, segmentation_output_path: nstr }),
    tools: ['executeSegmentation'],
  }, {
    video_id: videoId, predicted_object: detection.predicted_object, object_detection_output_path: detection.object_detection_output_path,
    output_format_object_detection: detection.output_format_object_detection, tracking_enabled: detection.tracking_enabled,
  }, async (input, port) => {
    const blank = { predicted_iou: null, segmentation_output_path: null };
    const r = await callTool(port, 'executeSegmentation', {
      video_id: input.video_id, predicted_object: input.predicted_object, object_detection_output_path: input.object_detection_output_path,
      output_format_object_detection: input.output_format_object_detection,
    });
    if (!r.ok) return { passed: false, reasons: [`executeSegmentation: ${r.error}`], ...blank };
    const v = fieldsOf(r);
    const reasons = segmentationReasons(v, { tracking: input.tracking_enabled });
    const path = typeof v.segmentation_output_path === 'string' && v.segmentation_output_path ? v.segmentation_output_path : null;
    if (!path) reasons.push('no segmentation output path');
    const passed = reasons.length === 0;
    return passed ? { passed, reasons, predicted_iou: num(v.predicted_iou), segmentation_output_path: path } : { passed, reasons, ...blank };
  });
  if (!segmentation.passed) return false;

  const detectionPath = detection.object_detection_output_path, segmentationPath = segmentation.segmentation_output_path;

  // 8.1 Automated Quality Control (5.3.1 thresholds)
  const qc = await run('8.1 Automated Quality Control Sequence', {
    input: obj({
      video_id: str, video_path: str, predicted_object: str, predicted_iou: { type: 'number' },
      segmentation_output_path: str, object_detection_output_path: str,
    }),
    output: gateOut(),
    tools: ['runAutomatedQC'],
  }, {
    video_id: videoId, video_path: video.video_path, predicted_object: detection.predicted_object,
    predicted_iou: segmentation.predicted_iou, segmentation_output_path: segmentationPath, object_detection_output_path: detectionPath,
  }, async (input, port) => {
    const r = await callTool(port, 'runAutomatedQC', input);
    if (!r.ok) return { passed: false, reasons: [`runAutomatedQC: ${r.error}`] };
    const reasons = qcReasons(fieldsOf(r));
    return { passed: reasons.length === 0, reasons };
  });
  if (!qc.passed) return false;

  // 8.2 Human Validation Integration (5.3.2 reviewers and inter-annotator score)
  const human = await run('8.2 Human Validation Integration', {
    input: obj({
      video_id: str, predicted_object: str, predicted_iou: { type: 'number' },
      segmentation_output_path: str, object_detection_output_path: str,
    }),
    output: gateOut(),
    tools: ['performHumanValidation'],
  }, {
    video_id: videoId, predicted_object: detection.predicted_object, predicted_iou: segmentation.predicted_iou,
    segmentation_output_path: segmentationPath, object_detection_output_path: detectionPath,
  }, async (input, port) => {
    const r = await callTool(port, 'performHumanValidation', input);
    if (!r.ok) return { passed: false, reasons: [`performHumanValidation: ${r.error}`] };
    const reasons = humanReasons(fieldsOf(r));
    return { passed: reasons.length === 0, reasons };
  });
  if (!human.passed) return false;

  // 9.1 Format Generation and Validation (5.4 output formats, paths validated for format compliance)
  const output = await run('9.1 Format Generation and Validation', {
    input: obj({ object_detection_output_path: str, segmentation_output_path: str }),
    output: gateOut(),
    tools: [],
  }, { object_detection_output_path: detectionPath, segmentation_output_path: segmentationPath }, async input => {
    const reasons = outputPathReasons(input.object_detection_output_path, input.segmentation_output_path);
    return { passed: reasons.length === 0, reasons };
  });
  return output.passed;
}

const complete = await annotate();

// 6.1 Deliverable Requirements: the final status over every stage that ran.
const final = await sop.section('6.1 Deliverable Requirements', {
  input: obj({
    complete: bool,
    stages: { type: 'array', items: obj({ section: str, passed: bool, reasons }) },
  }),
  output: obj({ annotated: bool, reason: nstr }),
  tools: [],
}, { complete, stages }, async input => {
  const failed = input.stages.find(s => !s.passed);
  const annotated = input.complete && !failed;
  const reason = annotated ? null : failed ? `${failed.section}: ${failed.reasons.join('; ')}` : 'the procedure did not complete';
  return { annotated, reason };
});

sop.done({ 'final status': final.annotated ? 'True' : 'False' });
