// Classifies an attachment by its filename extension. Used both for the
// pending-attachment preview in the composer and for deciding how a saved
// attachment should render in a message (inline image, native <video>/
// <audio> player, or a plain file card).
//
// Deliberately re-derived from the filename every time rather than trusted
// from a stored `kind` value, so attachments saved before video/audio
// support existed (which could only have been tagged 'image'/'gif'/'file')
// still get the correct treatment without any data migration.
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
const GIF_EXTENSIONS = ['gif'];
const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'avi', 'mov', 'webm'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'];

function extOf(filename) {
  return (filename || '').split('.').pop().toLowerCase();
}

export function classifyAttachmentKind(filename) {
  const ext = extOf(filename);
  if (GIF_EXTENSIONS.includes(ext)) return 'gif';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
  return 'file';
}

// File-type icon glyphs for the non-media "file card" — plain Unicode
// glyphs only, no third-party brand logos.
const ICONS = {
  video: '🎬',
  audio: '🎵',
  archive: '🗜️',
  application: '⚙️',
  pdf: '📕',
  doc: '📘',
  xls: '📊',
  ppt: '📙',
  txt: '📄'
};

const EXT_TO_ICON_GROUP = {
  zip: 'archive', rar: 'archive', '7z': 'archive',
  exe: 'application', msi: 'application',
  pdf: 'pdf',
  doc: 'doc', docx: 'doc',
  xls: 'xls', xlsx: 'xls',
  ppt: 'ppt', pptx: 'ppt',
  txt: 'txt'
};

export function iconFor(filename) {
  const ext = extOf(filename);
  const kind = classifyAttachmentKind(filename);
  if (kind === 'video') return ICONS.video;
  if (kind === 'audio') return ICONS.audio;
  const group = EXT_TO_ICON_GROUP[ext];
  return group ? ICONS[group] : '📄';
}
