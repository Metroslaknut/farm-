export interface ApiErrorBody {
  code: string;
  message: string;
  /** Field-level details for validation errors. */
  details?: { path: string; message: string }[];
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
}
