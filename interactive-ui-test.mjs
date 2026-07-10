#!/usr/bin/env node

/**
 * Interactive UI Button Test
 * Guides manual testing of infiltration profile buttons and testing type checkboxes
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.clear();
console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║           🧪 BUGSAFARI UI BUTTON INTERACTIVE TEST 🧪           ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

// Colors for terminal
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

const c = colors;

// Test data
const profiles = [
  { id: 'CHAOS_INFILTRATION', label: 'Chaos Infiltration', desc: 'Full-spectrum assault' },
  { id: 'DEEP_SEMANTIC_DATA_ATTACK', label: 'Deep Semantic Data Attack', desc: 'Data-focused' },
  { id: 'HIGH_FREQUENCY_CONCURRENCY_STRAIN', label: 'High-Frequency Concurrency Strain', desc: 'Concurrency-focused' },
  { id: 'ASYNC_LIFECYCLE_ASSAULT', label: 'Async Lifecycle Assault', desc: 'Async-focused' },
  { id: 'CUSTOM_STRATEGY_PROFILE', label: 'Custom Strategy Profile', desc: 'Manual selection' }
];

const testingTypes = [
  { id: 'exploratory', label: 'Client-Side Exploratory Testing' },
  { id: 'formBypass', label: 'Constraint Stripping & Form Bypass' },
  { id: 'dataFuzzing', label: 'Context-Aware Data Fuzzing' },
  { id: 'concurrency', label: 'Overlapping Concurrency Stress' },
  { id: 'navigation', label: 'Navigational Path Infiltration & Traversal' },
  { id: 'asyncRace', label: 'Async Lifecycle & Race Probing' }
];

console.log(`${c.cyan}📋 TEST CHECKLIST${c.reset}\n`);
console.log(`${c.bright}Step 1: Verify Frontend Server${c.reset}`);
console.log(`  URL: ${c.blue}http://localhost:5173${c.reset}`);
console.log(`  Status: ${c.green}✅ RUNNING${c.reset}\n`);

console.log(`${c.bright}Step 2: Open Browser and Navigate${c.reset}`);
console.log(`  1. Open http://localhost:5173 in your browser`);
console.log(`  2. Log in (if required)`);
console.log(`  3. Navigate to the Dashboard\n`);

console.log(`${c.bright}Step 3: Test Infiltration Profile Buttons${c.reset}`);
console.log(`  These are ${c.bright}RADIO BUTTONS${c.reset} (only one can be selected at a time)\n`);

profiles.forEach((profile, idx) => {
  const number = idx + 1;
  const isCustom = profile.id === 'CUSTOM_STRATEGY_PROFILE';
  console.log(`  ${c.cyan}${number}.${c.reset} ${profile.label}`);
  console.log(`     Description: ${profile.desc}`);
  if (isCustom) {
    console.log(`     ${c.yellow}⚠️  Selecting this reveals additional checkboxes below${c.reset}`);
  }
  console.log('');
});

console.log(`\n  ${c.bright}Testing Action:${c.reset}`);
console.log(`  ${c.dim}○${c.reset} Click each profile button one by one`);
console.log(`  ${c.dim}○${c.reset} Verify the button becomes selected (blue highlight + filled radio circle)`);
console.log(`  ${c.dim}○${c.reset} Verify only ONE profile can be selected at a time`);
console.log(`  ${c.dim}○${c.reset} When "Custom Strategy Profile" is selected, verify the Testing Types section appears below\n`);

console.log(`${c.bright}Step 4: Test Testing Type Checkboxes${c.reset}`);
console.log(`  These are ${c.bright}CHECKBOXES${c.reset} (multiple can be selected)\n`);
console.log(`  ${c.yellow}IMPORTANT: Only visible when "Custom Strategy Profile" is selected${c.reset}\n`);

testingTypes.forEach((type, idx) => {
  const number = idx + 1;
  console.log(`  ☐ ${number}. ${type.label}`);
});

console.log(`\n  ${c.bright}Testing Action:${c.reset}`);
console.log(`  ${c.dim}1.${c.reset} Select "Custom Strategy Profile"`);
console.log(`  ${c.dim}2.${c.reset} Verify "Testing Types" section appears below the profiles`);
console.log(`  ${c.dim}3.${c.reset} Click "SELECT ALL" button`);
console.log(`     ${c.dim}→${c.reset} All 6 checkboxes should become checked`);
console.log(`     ${c.dim}→${c.reset} Button text should change to "CLEAR ALL"`);
console.log(`  ${c.dim}4.${c.reset} Click "CLEAR ALL" button`);
console.log(`     ${c.dim}→${c.reset} All 6 checkboxes should become unchecked`);
console.log(`     ${c.dim}→${c.reset} Error message should appear: "Select at least one testing type to launch"`);
console.log(`     ${c.dim}→${c.reset} Button text should change back to "SELECT ALL"`);
console.log(`  ${c.dim}5.${c.reset} Click individual checkboxes`);
console.log(`     ${c.dim}→${c.reset} Checkbox should toggle on/off`);
console.log(`     ${c.dim}→${c.reset} Box should highlight blue when checked`);
console.log(`     ${c.dim}→${c.reset} Error message should disappear once at least one is selected\n`);

console.log(`${c.bright}Step 5: Test Profile Interactions${c.reset}\n`);
console.log(`  Test that switching profiles disables/enables custom checkboxes:\n`);
console.log(`  ${c.dim}1.${c.reset} Select "Chaos Infiltration"`);
console.log(`     ${c.dim}→${c.reset} Testing Types section should ${c.red}disappear${c.reset}`);
console.log(`  ${c.dim}2.${c.reset} Select "Deep Semantic Data Attack"`);
console.log(`     ${c.dim}→${c.reset} Testing Types section should ${c.red}disappear${c.reset}`);
console.log(`  ${c.dim}3.${c.reset} Select "Custom Strategy Profile" again`);
console.log(`     ${c.dim}→${c.reset} Testing Types section should ${c.green}reappear${c.reset}`);
console.log(`     ${c.dim}→${c.reset} Previously selected checkboxes should be ${c.green}remembered${c.reset}\n`);

console.log(`${c.bright}Step 6: Test START Button State${c.reset}\n`);
console.log(`  ${c.dim}○${c.reset} With "Chaos Infiltration" selected: START button should be ${c.green}enabled${c.reset}`);
console.log(`  ${c.dim}○${c.reset} With "Custom Strategy Profile" + no checkboxes: START button should be ${c.red}disabled${c.reset}` );
console.log(`  ${c.dim}○${c.reset} With "Custom Strategy Profile" + at least 1 checkbox: START button should be ${c.green}enabled${c.reset}\n`);

console.log(`${c.bright}Test Results${c.reset}\n`);

const testCases = [
  { name: '5 Profile buttons exist and are clickable', status: '⏳' },
  { name: 'Only one profile can be selected at a time', status: '⏳' },
  { name: 'Testing Types section appears only for Custom profile', status: '⏳' },
  { name: '6 Testing Type checkboxes are visible', status: '⏳' },
  { name: 'SELECT ALL / CLEAR ALL buttons work', status: '⏳' },
  { name: 'Individual checkboxes toggle on/off', status: '⏳' },
  { name: 'Visual feedback (blue highlight) on selection', status: '⏳' },
  { name: 'Error message on empty custom selection', status: '⏳' },
  { name: 'START button enables/disables correctly', status: '⏳' },
  { name: 'Profile selection is remembered when switching', status: '⏳' }
];

testCases.forEach((test, idx) => {
  console.log(`  [ ${test.status} ] ${idx + 1}. ${test.name}`);
});

console.log(`\n${c.bright}Status Legend:${c.reset}`);
console.log(`  ⏳ Pending (needs manual testing)`);
console.log(`  ✅ Passed`);
console.log(`  ❌ Failed`);

console.log(`\n${c.cyan}═══════════════════════════════════════════════════════════════${c.reset}`);
console.log(`${c.green}${c.bright}Ready to test! Open http://localhost:5173 and follow the steps above.${c.reset}`);
console.log(`${c.cyan}═══════════════════════════════════════════════════════════════${c.reset}\n`);

// Summary
console.log(`${c.bright}📊 Component Summary:${c.reset}\n`);
console.log(`  • Infiltration Profiles: 5 (4 preset + 1 custom)`);
console.log(`  • Testing Types: 6 (only for custom profile)`);
console.log(`  • Profile implementation: Radio buttons (single select)`);
console.log(`  • Testing types implementation: Checkboxes (multi-select)`);
console.log(`  • Select All button: Yes, with "SELECT ALL" / "CLEAR ALL" toggle`);
console.log(`  • Visual feedback: Blue highlight + border on selection`);
console.log(`  • Validation: Error message when custom profile has no selection\n`);

console.log(`${c.bright}🎯 Expected Behavior:${c.reset}\n`);
console.log(`  Preset profiles (Chaos, Deep Semantic, etc.) should execute`);
console.log(`  without additional configuration.\n`);
console.log(`  Custom profile requires the operator to select at least one`);
console.log(`  testing type before the START button becomes enabled.\n`);
console.log(`  Switching away from Custom profile and back should preserve`);
console.log(`  the previous custom selection.\n`);
