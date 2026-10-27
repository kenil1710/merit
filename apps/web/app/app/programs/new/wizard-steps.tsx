import type { ReactNode } from "react";

/** The wizard's steps, shared by the wizard and its first paint (so both show the same headline). */
export const STEPS = ["Basics", "Context", "Rubric", "Budget and schedule", "Review and go live"] as const;

/** Each step's headline (one italic word, the display style) and the one sentence under it. */
export const STEP_META: { title: ReactNode; intro: string }[] = [
  {
    title: (
      <>
        Name your <em>program</em>
      </>
    ),
    intro: "What contributors see first on the join page. You can change the name and description later.",
  },
  {
    title: (
      <>
        Brief the <em>agent</em>
      </>
    ),
    intro: "What the project is and what you want contributors to make. The agent checks every submission against it.",
  },
  {
    title: (
      <>
        What do you <em>pay</em> for?
      </>
    ),
    intro: "Categories of work, the points each is worth, and the criteria the agent scores against. Start from the example and make it yours.",
  },
  {
    title: (
      <>
        Pay, schedule and <em>limits</em>
      </>
    ),
    intro: "How much a point is worth, how long rounds run, who can take part, and the caps the Merit program enforces on Rialo whatever the agent decides.",
  },
  {
    title: (
      <>
        Ready to go <em>live</em>
      </>
    ),
    intro: "Check everything once. Saving keeps a draft; going live signs the campaign onto Rialo DevNet, funds it and opens round 1.",
  },
];
