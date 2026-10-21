// lib/rules.mjs: the SOP's pass/fail checks as plain code. Each function takes one tool's parsed result and returns the list
// of failed checks (an empty list means the stage passes). No tool calls here.
// Wording follows the SOP: "exceeding" is strict (>), "minimum", "range" and "tolerance" are inclusive (>=, <=).
// Sections: 4.1 video stream, 4.2 LiDAR, 5.1 environment, 5.2 detection and segmentation, 5.3 quality control and human validation.

const isNum = x => typeof x === 'number' && Number.isFinite(x);
const isText = x => typeof x === 'string' && x.trim() !== '';
const fold = s => String(s ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');

// 5.1 and 7.1: urban setting, daylight illumination and front-camera positioning. The first two name the settings the SOP
// excludes (the examples show night, artificial and lamp lighting, and open-country scenes); the camera names the front-facing
// mounts (dash, driver seat, camera beside the HUD). Matched on the folded text.
const NON_URBAN = /forest|woodland|rural|countryside|highway|motorway|desert|beach|mountain|farm|meadow|trail|nature|open road|offstreet park|off street park/;
const NON_DAYLIGHT = /night|dark|black|dusk|dawn|lamp|artificial|dim|headlight|street light|low light|poorly lit/;
const FRONT_CAMERA = /dash|driver|hud|windshield|windscreen|front/;

export function formatFailures(v) {
  if (!v || typeof v !== 'object') return ['no video format record'];
  const failed = [];
  // HEVC (H.265) or H.264 (AVC) only; a container name such as mp4 is not a codec.
  const codec = String(v.format ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/HEVC|H265|H264|AVC/.test(codec)) failed.push(`codec ${JSON.stringify(v.format)} is not HEVC or H.264`);
  if (!isText(v.video_path)) failed.push('no video path');
  if (!(isNum(v.resolution_width) && isNum(v.resolution_height) && v.resolution_width >= 1920 && v.resolution_height >= 1080)) {
    failed.push(`resolution ${v.resolution_width}x${v.resolution_height} is below 1920x1080`);
  }
  if (!(isNum(v.frame_rate) && v.frame_rate >= 24 && v.frame_rate <= 60)) failed.push(`frame rate ${v.frame_rate} is outside 24-60 fps`);
  if (!(isNum(v.bit_depth) && [8, 10].includes(v.bit_depth))) failed.push(`bit depth ${v.bit_depth} is not 8 or 10`);
  if (!(isNum(v.channel_count) && v.channel_count >= 3)) failed.push(`channel count ${v.channel_count} is below 3`);
  if (!isText(v.scene_type) || NON_URBAN.test(fold(v.scene_type))) failed.push(`scene ${JSON.stringify(v.scene_type)} is not an urban setting`);
  if (!isText(v.lighting_conditions) || NON_DAYLIGHT.test(fold(v.lighting_conditions))) {
    failed.push(`lighting ${JSON.stringify(v.lighting_conditions)} is not daylight`);
  }
  if (!FRONT_CAMERA.test(fold(v.camera_position))) failed.push(`camera position ${JSON.stringify(v.camera_position)} is not front-facing`);
  return failed;
}

export function lidarFailures(v) {
  if (!v || typeof v !== 'object') return ['no LiDAR record'];
  const failed = [];
  if (!isText(v.lidar_point_cloud_path) || !/\.pcd$/i.test(v.lidar_point_cloud_path)) failed.push('point cloud is not a .pcd file');
  if (!(isNum(v.time_offset) && Math.abs(v.time_offset) <= 1.0)) failed.push(`time offset ${v.time_offset} s is outside ±1.0 s`);
  if (!(isNum(v.object_distance) && v.object_distance >= 0.5 && v.object_distance <= 150)) failed.push(`ranging ${v.object_distance} m is outside 0.5-150 m`);
  if (v.camera_intrinsics_available !== true) failed.push('camera intrinsics are not available');
  if (v.lidar_transform_available !== true) failed.push('camera-to-LiDAR transform is not available');
  return failed;
}

export function detectionFailures(v) {
  if (!v || typeof v !== 'object') return ['no object detection record'];
  const failed = [];
  if (!(isNum(v.confidence_threshold_object_detection) && v.confidence_threshold_object_detection > 0.85)) {
    failed.push(`detection confidence ${v.confidence_threshold_object_detection} does not exceed 0.85`);
  }
  if (!isText(v.predicted_object) || !isText(v.ground_truth_object) || fold(v.predicted_object) !== fold(v.ground_truth_object)) {
    failed.push(`predicted object ${JSON.stringify(v.predicted_object)} does not match ground truth ${JSON.stringify(v.ground_truth_object)}`);
  }
  if (!isText(v.object_detection_output_path)) failed.push('no object detection output path');
  if (!isText(v.output_format_object_detection)) failed.push('no object detection output format');
  return failed;
}

export function segmentationFailures(v) {
  if (!v || typeof v !== 'object') return ['no segmentation record'];
  const failed = [];
  // 5.2: the segmentation generates instance-specific masks; panoptic or semantic output is not that.
  if (fold(v.segmentation_type) !== 'instance') failed.push(`segmentation type ${JSON.stringify(v.segmentation_type)} is not instance`);
  if (!(isNum(v.predicted_iou) && v.predicted_iou >= 0.75 && v.predicted_iou <= 1)) failed.push(`predicted IoU ${v.predicted_iou} is below 0.75`);
  if (!isText(v.segmentation_output_path)) failed.push('no segmentation output path');
  return failed;
}

export function qcFailures(v) {
  if (!v || typeof v !== 'object') return ['no quality control record'];
  const failed = [];
  if (!(isNum(v.spatial_accuracy_score) && v.spatial_accuracy_score >= 0.85)) failed.push(`spatial accuracy ${v.spatial_accuracy_score} is below 0.85`);
  if (!(isNum(v.temporal_consistency_score) && v.temporal_consistency_score > 0.80)) failed.push(`temporal consistency ${v.temporal_consistency_score} does not exceed 0.80`);
  return failed;
}

export function humanFailures(v) {
  if (!v || typeof v !== 'object') return ['no human validation record'];
  const failed = [];
  if (!(isNum(v.inter_annotator_score) && v.inter_annotator_score >= 0.75)) failed.push(`inter-annotator score ${v.inter_annotator_score} is below 0.75`);
  if (!(isNum(v.min_reviewers) && v.min_reviewers >= 2)) failed.push(`reviewers ${v.min_reviewers} is below the minimum of 2`);
  return failed;
}
