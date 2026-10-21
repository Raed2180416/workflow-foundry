// Module fraud, key: the order id. Owns R2.1, R2.2, S3 and §3.4 (human-task events).
// Effects: fraud.check (key 'check'). Human tasks: fraudReview (ids 'review-1', 'review-2', ...).
// Wake-up: 'deadline'. Always return `output`.

export function step(input, ctx) {
  switch (input.op) {
    case 'start': return start(input, ctx);
    case 'stop': return stop(input, ctx);
    case 'resume': return resume(input, ctx);
  }
  throw new Error(`fraud: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  // effect.result 'check' (R2.1): pass -> state 'cleared', at = placedAt; reject -> state 'cancel', reason 'fraud';
  //   review -> create the task (R2.2): kind fraudReview, role fraudAnalyst, subject = orderId, answerSchema
  //   accepting { decision: 'approve' | 'reject' }. Deadline = creation of the first task + fraudReviewHours
  //   (rulebook/<edition>/policy.json), kept in state, never moved (R2.2, S3). Set wake-up 'deadline' inside
  //   (deadline, deadline + 120 min].
  // humanTask.answered: counts only if it carries decision and its time <= deadline (R2.2; not the `late` flag,
  //   §3.4). approve -> 'cleared' at the answer's time; reject -> 'cancel', reason 'fraud', at the answer's time.
  //   Cancel the wake-up.
  // Unusable answer, humanTask.answerRejected, humanTask.withdrawn before the deadline: you may create a new task
  //   (new id, same deadline, R2.2).
  // Wake-up 'deadline' with no usable answer: 'cancel', reason 'fraud-review-timeout'.
  // Anything after an outcome or after stop: changes nothing (R2.2, R6.4).
  throw new Error('fraud.onEvent: not implemented');
}

function start(input, ctx) {
  // Emit fraud.check { orderId } once (R2.1); state 'checking'.
  throw new Error('fraud.start: not implemented');
}

function stop(input, ctx) {
  // Called by cancellation (R6.4): cancel the wake-up, ignore every later event; state 'stopped'.
  throw new Error('fraud.stop: not implemented');
}

function resume(input, ctx) {
  // §3.5: continue from the migrated records (open review task, its creation time).
  throw new Error('fraud.resume: not implemented');
}
