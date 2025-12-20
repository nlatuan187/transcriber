
const fs = require('fs');
const content = `GEMINI_API_KEY=AIzaSyAUMJ5TGK5e15PAuvwgTwgdlkuliGvJMP4
GEMINI_MODEL_NAME=gemini-3-pro-preview
`;
fs.writeFileSync('.env', content, { encoding: 'utf8' });
console.log('Written .env with UTF-8');
