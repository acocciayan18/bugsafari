const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src/components/ClinicalForensicsDashboard.tsx');
let content = fs.readFileSync(file, 'utf8');

// Fix 1: Replace step.index with # idx + 1
content = content.replace(
  /<span className="font-bold text-slate-700 flex-shrink-0 w-6">\{step\.index\}\.<\/span>/g,
  '<span className="font-bold text-slate-700 flex-shrink-0 w-6">#{idx + 1}</span>'
);

// Fix 2: Replace step.action with log.message
content = content.replace(
  /<span className="font-semibold text-slate-900 whitespace-pre-wrap break-words">\s*\{step\.action\}\s*<\/span>/g,
  '<span className="font-semibold text-slate-900 whitespace-pre-wrap break-words">{log.message}</span>'
);

// Fix 3: Replace step.target with log.url
content = content.replace(
  /Selector: \{step\.target\}/g,
  'URL: {log.url}'
);

// Fix 4: Replace CopyButton text template
content = content.replace(
  /<CopyButton text=\{`\$\{step\.action\}\\nSelector: \$\{step\.target\}`\} label="Action" \/>/g,
  '<CopyButton text={`[${log.type}] ${log.message}`} label="Log" />'
);

// Fix 5: Fix missing opening div tag for key prop - needs to be on a proper div
content = content.replace(
  /key=\{idx\}\s*\n\s*<div className="flex items-start gap-2 justify-between">/g,
  '<div key={idx} className="text-[13px] font-mono bg-slate-50 p-3 rounded border border-slate-200 hover:bg-slate-100 transition-colors group">\n                            <div className="flex items-start gap-2 justify-between">'
);

// Fix 6: Fix the return statement with illegal return inside JSX
content = content.replace(
  /\}\s*\(?\s*\n\s*return\s*\(\s*\n\s*<div className="p-3 space-y-2">/g,
  ') : ('
);

// Fix 7: Fix the IIFE structure - remove the arrow function wrapper for console tab
content = content.replace(
  /\{\/\* ════════════════════════════════════════\nTAB: CONSOLE.*?<div className="max-h-96 overflow-y-auto custom-scrollbar bg-white">\n\{browserConsole\.length === 0 \? \(/g,
  '{/* ════════════════════════════════════════\n              TAB: CONSOLE (Browser Console Output)\n              ════════════════════════════════════════ */}\n          {activeTab === \'console\' && (\n            <div className="space-y-3 p-2">\n              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">\n                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">\n                  <div className="flex items-center gap-2">\n                    <span className="text-[13px]"></span>\n                    <div className="text-[13px] font-bold text-slate-900">Browser Console Output</div>\n                  </div>\n                  <span className="text-xs text-slate-500">Last 50 logs</span>\n                </div>\n\n                <div className="max-h-96 overflow-y-auto custom-scrollbar bg-white">\n                  {browserConsole.length === 0 ? ('
);

// Need to be more careful - this is too complex. Let me take a simpler approach - 
// just fix the obvious broken text patterns:
// Looking at actual errors:
// 1. step.index. -> #{idx + 1}
// 2. step.action -> log.message  
// 3. step.target -> log.url
// 4. actionSteps doesn't exist, should use browserConsole
// 5. There's a return() in the middle of JSX which is illegal

// Let me fix pattern by pattern...
console.log('Attempted fixes...');

// Save
fs.writeFileSync(file, content);
console.log('File updated');
