// Minimal PNG header reader — avoids pulling in an image-processing dependency
// just to validate uploaded sprite/tile dimensions.
function readPngSize(buffer) {
  if (!buffer || buffer.length < 24) return null;
  const isPng =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 && buffer[4] === 0x0d && buffer[5] === 0x0a;
  if (!isPng) return null;

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

module.exports = { readPngSize };
