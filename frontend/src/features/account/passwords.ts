export const MIN_PASSWORD = 8;

export function passwordProblem(password: string, confirm: string, email: string): string {
  if (password.length < MIN_PASSWORD) {
    return `Use at least ${MIN_PASSWORD} characters for the password.`;
  }
  if (password.trim().toLowerCase() === email.trim().toLowerCase()) {
    return 'Choose a password that is not your email address.';
  }
  if (password !== confirm) {
    return 'The two passwords are not the same.';
  }
  return '';
}
