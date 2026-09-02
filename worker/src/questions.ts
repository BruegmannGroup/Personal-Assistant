// Same three question sets as agent/prompt.txt (the Python side's one definition of
// "the prompt" — copied here rather than fetched at runtime, since the Worker has no
// access to the repo's other files at request time).

export const PRE_MEETING_QUESTIONS: string[] = [
  "Why am I meeting them?",
  "What am I trying to learn, validate, or decide?",
  "What hypothesis am I testing?",
  "What would make this meeting useful?",
  "What would make this meeting a waste of time?",
  "What prior commitments or open threads should be checked?",
];

export const POST_MEETING_QUESTIONS: string[] = [
  "What actually happened?",
  "Who was there?",
  "What surprised me?",
  "What did I learn that changes my view?",
  "What was explicitly agreed?",
  "Who owns each next step?",
  "What evidence must exist before the next follow-up?",
  "What is the next logical action?",
  "Is this still Discovery, Validation, Development, Adoption, Conclusion, or Dormant?",
  "Was any dates promised for next meeting or for action items to succeed to next stage?",
];

export const FOLLOWUP_QUESTIONS: string[] = [
  "What was supposed to happen since last time?",
  "Did the agreed work happen?",
  "If yes, did it create useful progress, a decision, or more work?",
  "If no, why not?",
  "Was the failure due to ownership, economics, capability, customer timing, strategy, or unclear next step?",
  "Is this thread still worth advancing?",
  "Should we continue, close, reassign, restart, or replace the player?",
  "What should the next meeting accomplish that is meaningfully different from last time?",
];

export function questionsForStage(stage: "pre" | "post" | "followup"): string[] {
  if (stage === "pre") return PRE_MEETING_QUESTIONS;
  if (stage === "post") return POST_MEETING_QUESTIONS;
  return FOLLOWUP_QUESTIONS;
}
