import { createContext } from 'react';

/** A UI-side defense against mounted-but-hidden routes starting live sharing.
 * Server eligibility remains authoritative for all provider dispatch. */
export const AgeEligibilityAccessContext = createContext(false);
