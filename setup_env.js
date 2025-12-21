
const fs = require('fs');
const content = `GEMINI_API_KEY=YOUR_API_KEY_HERE
GEMINI_MODEL_NAME=gemini-1.5-pro
`;
fs.writeFileSync('.env.local', content, { encoding: 'utf8' });
console.log('Written .env.local with UTF-8');
