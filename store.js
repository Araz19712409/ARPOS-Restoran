const fs = require('fs');
const path = require('path');

// Əsas fayl korlanıbsa ehtiyat nüsxəni oxuyuruq
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    const bak = file + '.bak';
    if (fs.existsSync(bak)) {
      return JSON.parse(fs.readFileSync(bak, 'utf8'));
    }
    throw error;
  }
}

// Əvvəl müvəqqəti fayl, sonra köhnə .bak, sonra ad dəyişir
function writeJson(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  const bak = file + '.bak';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  if (fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, bak);
    } catch (error) {
      // ehtiyat alınmasa belə davam
    }
    try {
      fs.unlinkSync(file);
    } catch (error) {
      // Windows-da açıq fayl — aşağıda yenə cəhd
    }
  }
  try {
    fs.renameSync(tmp, file);
  } catch (error) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    fs.renameSync(tmp, file);
  }
}

module.exports = {
  readJson: readJson,
  writeJson: writeJson
};
