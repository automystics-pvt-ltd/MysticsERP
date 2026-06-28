export type PdfDownloadError = {
  response?: { data?: { error?: string } };
};

export type MutationError = {
  data?: { message?: string; error?: string };
};

export type FetchBodyError = {
  message?: string;
  error?: string;
};
