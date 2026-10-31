// Keep browser fixtures at the actual CSS size of the native transparent window.
const fs = require('node:fs');
const path = require('node:path');
const layout = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/island/layout.rs'), 'utf8');
module.exports = {
    width: Number(layout.match(/pub const BASE_WIDTH: f64 = ([\d.]+)/)[1]),
    height: Number(layout.match(/pub const BASE_HEIGHT: f64 = ([\d.]+)/)[1]),
};
