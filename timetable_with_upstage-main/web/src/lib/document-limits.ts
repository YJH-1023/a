/** Leaves multipart overhead below Vercel Functions' fixed 4.5 MB payload limit. */
export const MAX_DOCUMENT_MEGABYTES = 4;
export const MAX_DOCUMENT_BYTES = MAX_DOCUMENT_MEGABYTES * 1024 * 1024;
export const MAX_DOCUMENT_SIZE_LABEL = `${MAX_DOCUMENT_MEGABYTES}MB`;
