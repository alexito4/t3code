/** Saves text content to disk via a synthetic anchor click — the same download mechanism browsers already use for `<a download>` links, with no server or native dialog involved. */
export function downloadTextFile(
  fileName: string,
  contents: string,
  mimeType = "text/markdown",
): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  // Revoking synchronously can abort the download in some browsers; give the
  // browser time to open the stream first.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
