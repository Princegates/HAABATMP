export type ResultStatus = 'pass' | 'fail' | 'pending' | 'absent' | 'disqualified';

export interface AssessmentOutcome {
  pass_mark: number;
  /** Best percentage across the trainee's marked attempts, or null when none is marked yet. */
  best: number | null;
  /** Attempts of any state. Zero means the trainee never sat it. */
  attempts: number;
}

export interface ResultInputs {
  assessments: AssessmentOutcome[];
  attendancePct: number | null; // null: no session has ended yet
  minAttendancePct: number;
  programmeEnded: boolean;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Decides a result from the evidence. Pure, so the rule can be tested and explained to an auditor.
 *  - nothing is decided before the programme has ended (results before then are indicative: pending)
 *  - pass needs every required assessment at its own pass mark AND the attendance requirement
 *  - never turned up and never sat anything is absent, not fail
 */
export function decideResult(i: ResultInputs): { status: ResultStatus; score: number | null } {
  const req = i.assessments;
  const allMarked = req.length > 0 && req.every((a) => a.best !== null);
  const score = allMarked ? r2(req.reduce((s, a) => s + (a.best as number), 0) / req.length) : null;

  if (!i.programmeEnded) return { status: 'pending', score };

  const nothingSat = req.every((a) => a.attempts === 0);
  const neverAttended = i.attendancePct === 0;

  if (req.length === 0) {
    if (i.attendancePct === null) return { status: 'pending', score: null };
    if (neverAttended) return { status: 'absent', score: null };
    return { status: i.attendancePct >= i.minAttendancePct ? 'pass' : 'fail', score: null };
  }

  if (!allMarked) {
    const missed = req.some((a) => a.attempts === 0);
    if (!missed) return { status: 'pending', score }; // sat everything, waiting for marking
    if (neverAttended && nothingSat) return { status: 'absent', score };
    return { status: 'fail', score };
  }

  const attendanceOk = i.attendancePct === null || i.attendancePct >= i.minAttendancePct;
  const assessmentsOk = req.every((a) => (a.best as number) >= a.pass_mark);
  if (assessmentsOk && attendanceOk) return { status: 'pass', score };
  if (neverAttended && nothingSat) return { status: 'absent', score };
  return { status: 'fail', score };
}
