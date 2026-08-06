// Client-side field ceilings — mirror testing-core authValidation.ts so the form
// caps input at the source and the server never has to reject an over-length value.
export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MAX_LENGTH = 72;
export const NAME_MAX_LENGTH = 100;
