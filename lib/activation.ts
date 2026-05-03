export const ACTIVATION_TARGET = 3;

export function isActivationIncomplete(savedCount: number): boolean {
  return savedCount < ACTIVATION_TARGET;
}

export function getActivationProgressLabel(savedCount: number): string {
  const clamped = Math.max(0, Math.min(savedCount, ACTIVATION_TARGET));
  return `${clamped} / ${ACTIVATION_TARGET} places saved`;
}

export function getActivationProgressValue(savedCount: number): number {
  const clamped = Math.max(0, Math.min(savedCount, ACTIVATION_TARGET));
  return clamped / ACTIVATION_TARGET;
}

export function getActivationSaveFeedback(postSaveCount: number): {
  title: string;
  message: string;
  milestoneEvent:
    | 'first_save_completed'
    | 'second_save_completed'
    | 'third_save_completed'
    | null;
  completed: boolean;
} {
  if (postSaveCount === 1) {
    return {
      title: 'Saved',
      message: 'Add 2 more places to build your first map.',
      milestoneEvent: 'first_save_completed',
      completed: false,
    };
  }

  if (postSaveCount === 2) {
    return {
      title: 'Saved',
      message: 'Add 1 more place to build your first map.',
      milestoneEvent: 'second_save_completed',
      completed: false,
    };
  }

  if (postSaveCount === ACTIVATION_TARGET) {
    return {
      title: 'Your first Nearr map is ready',
      message: "You've saved 3 places. Open your map to see them.",
      milestoneEvent: 'third_save_completed',
      completed: true,
    };
  }

  return {
    title: 'Saved to your map',
    message: 'Nearr saved this place to your map.',
    milestoneEvent: null,
    completed: false,
  };
}