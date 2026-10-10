import JSZip from 'jszip';

/**
 * Office files (.docx, .xlsx) are zip archives, and a few kilobytes of zip can unpack to gigabytes. This reads only the
 * archive's table of contents and refuses anything that declares too many entries or too much unpacked data, before any
 * of it is inflated. JSZip also checks each entry against its declared size while inflating, so the figures cannot be understated.
 */
export async function assertSafeZip(file: Buffer, label: string, limits = { entries: 300, bytes: 60 * 1024 * 1024 }): Promise<JSZip> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(file); } catch { throw new Error(`This ${label} could not be opened. Save it again and retry.`); }
  const entries = Object.values(zip.files);
  if (entries.length > limits.entries) throw new Error(`This ${label} is not a normal file (too many parts).`);
  let total = 0;
  for (const e of entries) {
    if (e.dir) continue;
    const n = (e as any)._data?.uncompressedSize;
    if (typeof n !== 'number') throw new Error(`This ${label} could not be checked. Save it again and retry.`);
    total += n;
    if (total > limits.bytes) throw new Error(`This ${label} is too large once opened. Split it into smaller files.`);
  }
  return zip;
}
