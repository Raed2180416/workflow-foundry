// lib/rules.mjs: the video annotation SOP's thresholds and checks as plain code (sections 4, 5, 7, 8, 9 of sop.txt).
// Every check returns the reasons it fails, so an empty list means the stage passes. Tool values are read with num()/yes()/label().

// A tool value as a number: a number, or text that starts with one ("8-bit", "30 fps"); anything else is null.
export const num = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*[-+]?\d/.test(v)) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
  return null;
};
// A tool's yes/no value: a boolean, or the text "true".
export const yes = v => v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
// Labels compare loosely: case, spaces, '_' and '-' do not matter.
export const label = v => String(v ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');

// 3.1 / 4.1: the compression codec, from the format field. A container name such as mp4 is not a codec, so it is null.
export function codecOf(format) {
  const f = String(format ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/HEVC|H265/.test(f)) return 'HEVC';
  if (/H264|AVC/.test(f)) return 'H.264';
  return null;
}

// 4.1 video stream parameters: codec, minimum 1920x1080, 24.0-60.0 fps, 8- or 10-bit, at least three channels.
export function videoReasons(v) {
  const reasons = [];
  if (!codecOf(v.format)) reasons.push(`format ${JSON.stringify(v.format ?? null)} is not HEVC or H.264`);
  const w = num(v.resolution_width), h = num(v.resolution_height);
  if (w === null || h === null || w < 1920 || h < 1080) reasons.push(`resolution ${v.resolution_width}x${v.resolution_height} is below 1920x1080`);
  const fps = num(v.frame_rate);
  if (fps === null || fps < 24 || fps > 60) reasons.push(`frame rate ${v.frame_rate} is outside 24.0-60.0`);
  const bd = num(v.bit_depth);
  if (bd !== 8 && bd !== 10) reasons.push(`bit depth ${v.bit_depth} is not 8 or 10`);
  const ch = num(v.channel_count);
  if (ch === null || ch < 3) reasons.push(`channel count ${v.channel_count} is below 3`);
  return reasons;
}

// 5.1 environment: an urban setting, daylight illumination, front-camera positioning. Labels the lists below do not
// recognise are returned as unclear (flagged by the caller) and are not failures on their own.
const NON_URBAN = /\b(parks?|forests?|woods|rural|countryside|farm|fields?|meadows?|mountains?|deserts?|beach(es)?|trails?|highways?|freeways?|motorways?|expressways?|off-?road|off-?street|offstreet|wilderness|lakes?|oceans?)\b/i;
const URBAN_HINT = /city|urban|downtown|high-?rise|street|skyline|riverfront|waterfront|skybridge|town|metropolitan|avenue|intersection|plaza|boulevard|district/i;
const DARK = /\b(dim|dark|darkness|night|nighttime|dusk|dawn|twilight|lamps?|low-?light|artificial|streetlights?|headlights?|overnight|moonlit|underground|indoors?)\b/i;
const FRONT = /\b(front|frontal|forward|dash|dashboard|dashcam|driver|windshield|windscreen|hud|cab)\b/i;

export function environmentCheck(v) {
  const reasons = [], unclear = [];
  const scene = String(v.scene_type ?? '');
  if (NON_URBAN.test(scene)) reasons.push(`scene "${scene}" is not an urban setting`);
  else if (!URBAN_HINT.test(scene)) unclear.push(`scene "${scene}"`);
  for (const [field, text] of [['lighting', v.lighting_conditions], ['weather', v.weather]]) {
    const s = String(text ?? '');
    if (DARK.test(s)) reasons.push(`${field} "${s}" is not daylight`);
  }
  const cam = String(v.camera_position ?? '');
  if (!FRONT.test(cam)) reasons.push(`camera position "${cam}" is not front-facing`);
  return { reasons, unclear };
}

// 4.2 / 7.2 LiDAR: .pcd point cloud, time offset within ±1.0 s, ranging 0.5-150 m, intrinsics and transform available.
export function lidarReasons(v) {
  const reasons = [];
  if (!/\.pcd$/i.test(String(v.lidar_point_cloud_path ?? ''))) reasons.push(`point cloud ${JSON.stringify(v.lidar_point_cloud_path ?? null)} is not a .pcd file`);
  const off = num(v.time_offset);
  if (off === null || Math.abs(off) > 1.0) reasons.push(`time offset ${v.time_offset} is outside ±1.0 s`);
  const d = num(v.object_distance);
  if (d === null || d < 0.5 || d > 150) reasons.push(`object distance ${v.object_distance} is outside 0.5-150 m`);
  if (!yes(v.camera_intrinsics_available)) reasons.push('camera intrinsics are not available');
  if (!yes(v.lidar_transform_available)) reasons.push('camera-to-LiDAR transform is not available');
  return reasons;
}

// 5.2 / 7.3 object detection: confidence exceeding 0.85, tracking enabled, the detected object confirmed by ground truth.
export function detectionReasons(v) {
  const reasons = [];
  const conf = num(v.confidence_threshold_object_detection);
  if (conf === null || conf <= 0.85) reasons.push(`detection confidence ${v.confidence_threshold_object_detection} does not exceed 0.85`);
  if (!yes(v.tracking_enabled)) reasons.push('tracking is not enabled');
  const predicted = label(v.predicted_object), truth = label(v.ground_truth_object);
  if (!predicted) reasons.push('no predicted object');
  else if (predicted !== truth) reasons.push(`predicted object "${v.predicted_object}" does not match ground truth "${v.ground_truth_object}"`);
  return reasons;
}

// 5.2 / 7.4 segmentation: predicted IoU of at least 0.75, instance-specific masks, temporal smoothing when tracking is enabled.
export function segmentationReasons(v, { tracking }) {
  const reasons = [];
  const iou = num(v.predicted_iou);
  if (iou === null || iou < 0.75) reasons.push(`predicted IoU ${v.predicted_iou} is below 0.75`);
  if (label(v.segmentation_type) !== 'instance') reasons.push(`segmentation type "${v.segmentation_type}" is not instance-specific`);
  if (tracking && !yes(v.temporal_smoothing)) reasons.push('temporal smoothing is off although tracking is enabled');
  return reasons;
}

// 5.3.1 / 8.1 automated QC: spatial accuracy at least 0.85, temporal consistency exceeding 0.80.
export function qcReasons(v) {
  const reasons = [];
  const temporal = num(v.temporal_consistency_score), spatial = num(v.spatial_accuracy_score);
  if (temporal === null || temporal <= 0.8) reasons.push(`temporal consistency ${v.temporal_consistency_score} does not exceed 0.80`);
  if (spatial === null || spatial < 0.85) reasons.push(`spatial accuracy ${v.spatial_accuracy_score} is below 0.85`);
  return reasons;
}

// 5.3.2 / 8.2 human validation: at least two reviewers, inter-annotator score at least 0.75.
export function humanReasons(v) {
  const reasons = [];
  const reviewers = num(v.min_reviewers), score = num(v.inter_annotator_score);
  if (reviewers === null || reviewers < 2) reasons.push(`${v.min_reviewers} reviewers is below the minimum of 2`);
  if (score === null || score < 0.75) reasons.push(`inter-annotator score ${v.inter_annotator_score} is below 0.75`);
  return reasons;
}

// 5.4 / 9.1 output formats: object detection as json or xml (CoCo JSON is converted from either), segmentation as binary or indices.
export function detectionFormat(format, path) {
  const f = label(format);
  if (/\bxml\b/.test(f)) return 'xml';
  if (/\bjson\b/.test(f)) return 'json';
  const ext = /\.(json|xml)$/i.exec(String(path ?? ''));
  return ext ? ext[1].toLowerCase() : null;
}
export function outputPathReasons(detectionPath, segmentationPath) {
  const reasons = [];
  if (!/\.(json|xml)$/i.test(String(detectionPath ?? ''))) reasons.push(`object detection output ${JSON.stringify(detectionPath ?? null)} is not a json or xml file`);
  if (!/\.(binary|indices)$/i.test(String(segmentationPath ?? ''))) reasons.push(`segmentation output ${JSON.stringify(segmentationPath ?? null)} is not a binary or indices file`);
  return reasons;
}
