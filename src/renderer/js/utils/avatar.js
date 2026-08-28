// Resolves a character's stored avatar reference into a URL the <img> tag
// can load. Avatars are either:
//   { type: 'temp', path: '<absolute path>' }             -- picked, not yet saved
//   { type: 'project', path: 'assets/<file>' }             -- relative to projectDir
function toFileUrl(absolutePath) {
  // Normalise Windows backslashes and encode for use in a file:// URL.
  const normalized = absolutePath.replace(/\\/g, '/');
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `file://${encodeURI(withSlash)}`;
}

export function resolveAvatarUrl(avatar, projectDir) {
  if (!avatar || !avatar.path) return null;
  if (avatar.type === 'temp') return toFileUrl(avatar.path);
  if (avatar.type === 'project' && projectDir) {
    const joined = `${projectDir.replace(/\\/g, '/')}/${avatar.path}`;
    return toFileUrl(joined);
  }
  return null;
}

// Message attachments use the exact same { type: 'temp'|'project', path }
// reference shape as avatars, so this is just an alias — no logic duplicated.
export const resolveAssetUrl = resolveAvatarUrl;
