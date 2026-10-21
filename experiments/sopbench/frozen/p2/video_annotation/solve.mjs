import { createFlow } from './tools/flow.mjs';
import { createSop } from './tools/sop.mjs';
const flow = createFlow({ budgetUsd: 0.05 });
const sop = createSop(flow);
const task = flow.input();
import { formatFailures, lidarFailures, detectionFailures, segmentationFailures, qcFailures, humanFailures } from './lib/rules.mjs';

// Section contracts. Every gate section answers pass, the failed checks, and (only when pass) the data the next section
// needs. A failed gate leaves the data keys out, and the orchestrator never reads them, so a later section never runs.
const str = { type: 'string' }, num = { type: 'number' };
const text = { type: ['string', 'null'] }, number = { type: ['number', 'null'] };
const inputOf = props => ({ type: 'object', required: Object.keys(props), properties: props });
const gateOut = (data = {}) => ({
  type: 'object', required: ['pass', 'failed'],
  properties: { pass: { type: 'boolean' }, failed: { type: 'array', items: { type: 'string' } }, ...data },
});
const gate = (failed, data = {}) => {
  const ok = failed.length === 0;
  return { pass: ok, failed, ...Object.fromEntries(Object.keys(data).map(k => [k, ok ? data[k] : null])) };
};

// Each section answers the tool results of its own step; a failed tool call is a failed check, not a crash.
async function annotate() {
  // 7.1: format, resolution, frame rate, bit depth and channels of the video, and its urban, daylight and front-camera setting.
  const format = await sop.section('7.1 Video Format Verification Protocol', {
    input: inputOf({ video_id: str }),
    output: gateOut({ video_path: text }),
    tools: ['validateVideoFormat'],
  }, { video_id: task.inputs.video_id }, async (input, port) => {
    const r = await port.tryCall('validateVideoFormat', { video_id: input.video_id });
    if (!r.ok) return gate([`validateVideoFormat failed: ${r.error}`]);
    return gate(formatFailures(r.value), { video_path: r.value?.video_path });
  });
  if (!format.pass) return { annotated: false, stage: '7.1', failed: format.failed };

  // 7.2: LiDAR point cloud, time alignment, ranging, camera intrinsics and camera-to-LiDAR transform.
  const lidar = await sop.section('7.2 LiDAR Data Integration Framework', {
    input: inputOf({ video_id: str, video_path: str }),
    output: gateOut(),
    tools: ['validateLidarData'],
  }, { video_id: task.inputs.video_id, video_path: format.video_path }, async (input, port) => {
    const r = await port.tryCall('validateLidarData', { video_id: input.video_id, video_path: input.video_path });
    if (!r.ok) return gate([`validateLidarData failed: ${r.error}`]);
    return gate(lidarFailures(r.value));
  });
  if (!lidar.pass) return { annotated: false, stage: '7.2', failed: lidar.failed };

  // 7.3 (with 5.2): object detection, confidence above 0.85, ground truth match, and tracking switched on (mandatory).
  const detection = await sop.section('7.3 Object Detection Workflow Integration', {
    input: inputOf({ video_id: str, video_path: str }),
    output: gateOut({ predicted_object: text, object_detection_output_path: text, output_format_object_detection: text }),
    tools: ['performObjectDetection', 'optimizeTrackingSettings'],
  }, { video_id: task.inputs.video_id, video_path: format.video_path }, async (input, port) => {
    const r = await port.tryCall('performObjectDetection', { video_id: input.video_id, video_path: input.video_path });
    if (!r.ok) return gate([`performObjectDetection failed: ${r.error}`]);
    const failed = [];
    if (r.value?.tracking_enabled !== true) {
      const t = await port.tryCall('optimizeTrackingSettings', { video_id: input.video_id, tracking_enabled: true });
      if (!t.ok) failed.push(`tracking could not be enabled: ${t.error}`);
    }
    failed.push(...detectionFailures(r.value));
    return gate(failed, {
      predicted_object: r.value?.predicted_object,
      object_detection_output_path: r.value?.object_detection_output_path,
      output_format_object_detection: r.value?.output_format_object_detection,
    });
  });
  if (!detection.pass) return { annotated: false, stage: '7.3', failed: detection.failed };

  // 7.4 (with 5.2): instance segmentation, predicted IoU of at least 0.75.
  const segmentation = await sop.section('7.4 Segmentation Process Implementation', {
    input: inputOf({ video_id: str, predicted_object: str, object_detection_output_path: str, output_format_object_detection: str }),
    output: gateOut({ predicted_iou: number, segmentation_output_path: text }),
    tools: ['executeSegmentation'],
  }, {
    video_id: task.inputs.video_id,
    predicted_object: detection.predicted_object,
    object_detection_output_path: detection.object_detection_output_path,
    output_format_object_detection: detection.output_format_object_detection,
  }, async (input, port) => {
    const r = await port.tryCall('executeSegmentation', {
      video_id: input.video_id,
      predicted_object: input.predicted_object,
      object_detection_output_path: input.object_detection_output_path,
      output_format_object_detection: input.output_format_object_detection,
    });
    if (!r.ok) return gate([`executeSegmentation failed: ${r.error}`]);
    return gate(segmentationFailures(r.value), {
      predicted_iou: r.value?.predicted_iou,
      segmentation_output_path: r.value?.segmentation_output_path,
    });
  });
  if (!segmentation.pass) return { annotated: false, stage: '7.4', failed: segmentation.failed };

  // 8.1 (with 5.3): automated QC, spatial accuracy at least 0.85, temporal consistency above 0.80.
  const qc = await sop.section('8.1 Automated Quality Control Sequence', {
    input: inputOf({
      video_id: str, video_path: str, predicted_object: str, predicted_iou: num,
      segmentation_output_path: str, object_detection_output_path: str,
    }),
    output: gateOut(),
    tools: ['runAutomatedQC'],
  }, {
    video_id: task.inputs.video_id,
    video_path: format.video_path,
    predicted_object: detection.predicted_object,
    predicted_iou: segmentation.predicted_iou,
    segmentation_output_path: segmentation.segmentation_output_path,
    object_detection_output_path: detection.object_detection_output_path,
  }, async (input, port) => {
    const r = await port.tryCall('runAutomatedQC', {
      video_id: input.video_id,
      video_path: input.video_path,
      predicted_object: input.predicted_object,
      predicted_iou: input.predicted_iou,
      segmentation_output_path: input.segmentation_output_path,
      object_detection_output_path: input.object_detection_output_path,
    });
    if (!r.ok) return gate([`runAutomatedQC failed: ${r.error}`]);
    return gate(qcFailures(r.value));
  });
  if (!qc.pass) return { annotated: false, stage: '8.1', failed: qc.failed };

  // 8.2 (with 5.3): human-in-the-loop validation, inter-annotator score at least 0.75, at least two reviewers.
  const human = await sop.section('8.2 Human Validation Integration', {
    input: inputOf({
      video_id: str, predicted_object: str, predicted_iou: num,
      segmentation_output_path: str, object_detection_output_path: str,
    }),
    output: gateOut(),
    tools: ['performHumanValidation'],
  }, {
    video_id: task.inputs.video_id,
    predicted_object: detection.predicted_object,
    predicted_iou: segmentation.predicted_iou,
    segmentation_output_path: segmentation.segmentation_output_path,
    object_detection_output_path: detection.object_detection_output_path,
  }, async (input, port) => {
    const r = await port.tryCall('performHumanValidation', {
      video_id: input.video_id,
      predicted_object: input.predicted_object,
      predicted_iou: input.predicted_iou,
      segmentation_output_path: input.segmentation_output_path,
      object_detection_output_path: input.object_detection_output_path,
    });
    if (!r.ok) return gate([`performHumanValidation failed: ${r.error}`]);
    return gate(humanFailures(r.value));
  });
  if (!human.pass) return { annotated: false, stage: '8.2', failed: human.failed };

  return { annotated: true, stage: 'all', failed: [] };
}

const result = await annotate();
flow.note('outcome', result);
sop.done({ 'final status': result.annotated ? 'True' : 'False' });
