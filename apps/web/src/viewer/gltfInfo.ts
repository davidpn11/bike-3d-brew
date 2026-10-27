/** glTF extensions that need a decoder the viewer loads lazily. */
export const DECODER_EXTENSIONS = {
  meshopt: ['EXT_meshopt_compression', 'KHR_meshopt_compression'],
  draco: ['KHR_draco_mesh_compression'],
  ktx2: ['KHR_texture_basisu'],
} as const;

export type Decoder = keyof typeof DECODER_EXTENSIONS;

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'

/**
 * Reads `extensionsUsed` from a GLB (binary) or glTF (JSON) file without parsing its buffers, so the
 * loader fetches only the decoders this file needs. Untrusted input: anything malformed yields [].
 */
export function gltfExtensionsUsed(bytes: Uint8Array): string[] {
  let json: unknown;
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length >= 20 && view.getUint32(0, true) === GLB_MAGIC) {
      const length = view.getUint32(12, true);
      if (view.getUint32(16, true) !== CHUNK_JSON || 20 + length > bytes.length) return [];
      json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
    } else {
      json = JSON.parse(new TextDecoder().decode(bytes));
    }
  } catch {
    return [];
  }
  const used = (json as { extensionsUsed?: unknown } | null)?.extensionsUsed;
  return Array.isArray(used) ? used.filter((e): e is string => typeof e === 'string') : [];
}

/** Which lazy decoders a file needs. */
export function decodersFor(extensions: string[]): Decoder[] {
  return (Object.keys(DECODER_EXTENSIONS) as Decoder[]).filter((d) => DECODER_EXTENSIONS[d].some((e) => extensions.includes(e)));
}
