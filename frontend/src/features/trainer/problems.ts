import { ApiError } from '../../services/api';

export function problemText(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail;
  }
  if (error instanceof TypeError) {
    return 'The backend cannot be reached. Check that it is running.';
  }
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}
