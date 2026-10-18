/** 1 language, 2 welcome and Terms of Use, 3 demo portfolio, 4 telemetry. */
export type SetupStep = 1 | 2 | 3 | 4;

/** The first step after the Terms of Use, where the app reopens the wizard once they are accepted. */
export const SETUP_STEP_AFTER_TERMS: SetupStep = 3;
