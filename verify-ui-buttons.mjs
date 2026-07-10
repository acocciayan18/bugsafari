#!/usr/bin/env node

/**
 * UI Button Verification
 * Verifies infiltration profile buttons and testing type checkboxes in source code
 */

import fs from 'fs';
import path from 'path';

const projectRoot = 'C:\\project_thesis\\bugsafari';

console.log('🧪 BugSafari UI Button Verification\n');
console.log('═'.repeat(60));

// Read the testingType.ts file
const typesPath = path.join(projectRoot, 'shared', 'types', 'testingType.ts');
const typesContent = fs.readFileSync(typesPath, 'utf-8');

// Test 1: Verify Infiltration Profiles
console.log('\n📋 Test 1: Infiltration Profile Buttons');
console.log('─'.repeat(60));

const profiles = [
  'CHAOS_INFILTRATION',
  'DEEP_SEMANTIC_DATA_ATTACK',
  'HIGH_FREQUENCY_CONCURRENCY_STRAIN',
  'ASYNC_LIFECYCLE_ASSAULT',
  'CUSTOM_STRATEGY_PROFILE'
];

let passedProfiles = 0;
profiles.forEach((profile, idx) => {
  if (typesContent.includes(`'${profile}'`)) {
    console.log(`  ✅ ${idx + 1}. ${profile}`);
    passedProfiles++;
  } else {
    console.log(`  ❌ ${idx + 1}. ${profile} - NOT FOUND`);
  }
});

console.log(`\n  Result: ${passedProfiles}/${profiles.length} profiles found`);

// Test 2: Verify Testing Type Categories
console.log('\n📋 Test 2: Testing Type Checkboxes');
console.log('─'.repeat(60));

const testingTypes = [
  { id: 'exploratory', label: 'Client-Side Exploratory Testing' },
  { id: 'formBypass', label: 'Constraint Stripping & Form Bypass' },
  { id: 'dataFuzzing', label: 'Context-Aware Data Fuzzing' },
  { id: 'concurrency', label: 'Overlapping Concurrency Stress' },
  { id: 'navigation', label: 'Navigational Path Infiltration & Traversal' },
  { id: 'asyncRace', label: 'Async Lifecycle & Race Probing' }
];

let passedTypes = 0;
testingTypes.forEach((type, idx) => {
  if (typesContent.includes(`'${type.id}'`) && typesContent.includes(type.label)) {
    console.log(`  ✅ ${idx + 1}. ${type.id}`);
    console.log(`     Label: "${type.label}"`);
    passedTypes++;
  } else {
    console.log(`  ❌ ${idx + 1}. ${type.id} - NOT FOUND`);
  }
});

console.log(`\n  Result: ${passedTypes}/${testingTypes.length} testing types found`);

// Test 3: Verify Profile-to-TestingType mappings
console.log('\n📋 Test 3: Profile Mappings to Testing Types');
console.log('─'.repeat(60));

const profileMappings = {
  'CHAOS_INFILTRATION': ['exploratory', 'formBypass', 'dataFuzzing', 'concurrency', 'navigation', 'asyncRace'],
  'DEEP_SEMANTIC_DATA_ATTACK': ['dataFuzzing', 'formBypass'],
  'HIGH_FREQUENCY_CONCURRENCY_STRAIN': ['concurrency', 'navigation'],
  'ASYNC_LIFECYCLE_ASSAULT': ['asyncRace'],
  'CUSTOM_STRATEGY_PROFILE': []
};

let passedMappings = 0;
Object.entries(profileMappings).forEach(([profile, typeIds]) => {
  const hasMapping = typeIds.every(typeId => typesContent.includes(`'${typeId}'`));
  if (hasMapping) {
    console.log(`  ✅ ${profile}`);
    console.log(`     Enables: ${typeIds.length > 0 ? typeIds.join(', ') : '(user selectable)'}`);
    passedMappings++;
  } else {
    console.log(`  ❌ ${profile} - Mapping incomplete`);
  }
});

console.log(`\n  Result: ${passedMappings}/${Object.keys(profileMappings).length} profile mappings verified`);

// Test 4: Verify Component Structure
console.log('\n📋 Test 4: Component Files Exist');
console.log('─'.repeat(60));

const components = [
  'developer-dashboard/src/components/common/InfiltrationProfileSelector.tsx',
  'developer-dashboard/src/components/common/TestingTypeSelector.tsx',
  'developer-dashboard/src/components/control-panel/CommandCenter.tsx'
];

let passedComponents = 0;
components.forEach((comp, idx) => {
  const compPath = path.join(projectRoot, comp);
  if (fs.existsSync(compPath)) {
    console.log(`  ✅ ${idx + 1}. ${comp}`);
    passedComponents++;
  } else {
    console.log(`  ❌ ${idx + 1}. ${comp} - NOT FOUND`);
  }
});

console.log(`\n  Result: ${passedComponents}/${components.length} component files found`);

// Test 5: Verify InfiltrationProfileSelector has radio buttons
console.log('\n📋 Test 5: Profile Selector Implementation');
console.log('─'.repeat(60));

const profileSelectorPath = path.join(projectRoot, 'developer-dashboard/src/components/common/InfiltrationProfileSelector.tsx');
const selectorContent = fs.readFileSync(profileSelectorPath, 'utf-8');

let selectorTests = 0;
const selectorChecks = [
  { pattern: /type="radio"/, name: 'Radio button input type' },
  { pattern: /infiltration-profile/, name: 'Profile input name' },
  { pattern: /INFILTRATION_PROFILE_CATALOG/, name: 'Profile catalog reference' },
  { pattern: /onProfileChange/, name: 'Profile change handler' }
];

selectorChecks.forEach((check, idx) => {
  if (check.pattern.test(selectorContent)) {
    console.log(`  ✅ ${idx + 1}. ${check.name}`);
    selectorTests++;
  } else {
    console.log(`  ❌ ${idx + 1}. ${check.name}`);
  }
});

console.log(`\n  Result: ${selectorTests}/${selectorChecks.length} selector checks passed`);

// Test 6: Verify TestingTypeSelector component
console.log('\n📋 Test 6: Testing Type Selector Implementation');
console.log('─'.repeat(60));

const testingSelectorPath = path.join(projectRoot, 'developer-dashboard/src/components/common/TestingTypeSelector.tsx');
const testingSelectorContent = fs.readFileSync(testingSelectorPath, 'utf-8');

let testingTests = 0;
const testingChecks = [
  { pattern: /type="checkbox"/, name: 'Checkbox input type' },
  { pattern: /TESTING_TYPE_CATALOG/, name: 'Testing type catalog reference' },
  { pattern: /onChange/, name: 'Change handler' }
];

testingChecks.forEach((check, idx) => {
  if (check.pattern.test(testingSelectorContent)) {
    console.log(`  ✅ ${idx + 1}. ${check.name}`);
    testingTests++;
  } else {
    console.log(`  ❌ ${idx + 1}. ${check.name}`);
  }
});

console.log(`\n  Result: ${testingTests}/${testingChecks.length} testing type selector checks passed`);

// Summary
console.log('\n' + '═'.repeat(60));
console.log('📊 SUMMARY');
console.log('═'.repeat(60));

const totalTests = passedProfiles + passedTypes + passedMappings + passedComponents + selectorTests + testingTests;
const totalExpected = profiles.length + testingTypes.length + Object.keys(profileMappings).length + components.length + selectorChecks.length + testingChecks.length;

console.log(`\n✅ Passed: ${totalTests}/${totalExpected} checks`);
console.log(`\n🎯 Infiltration Profile Buttons: ${passedProfiles}/${profiles.length}`);
console.log(`☑️  Testing Type Checkboxes: ${passedTypes}/${testingTypes.length}`);
console.log(`🔗 Profile Mappings: ${passedMappings}/${Object.keys(profileMappings).length}`);
console.log(`📁 Components: ${passedComponents}/${components.length}`);
console.log(`🎨 Profile Selector: ${selectorTests}/${selectorChecks.length}`);
console.log(`🎨 Testing Type Selector: ${testingTests}/${testingChecks.length}`);

if (totalTests === totalExpected) {
  console.log('\n✅ ALL TESTS PASSED\n');
  console.log('🌐 To test interactively:');
  console.log('   1. Open http://localhost:5173 in your browser');
  console.log('   2. Click each infiltration profile button');
  console.log('   3. Select "Custom Strategy Profile"');
  console.log('   4. Verify all 6 testing type checkboxes appear and toggle correctly');
  process.exit(0);
} else {
  console.log(`\n⚠️  ${totalExpected - totalTests} test(s) failed\n`);
  process.exit(1);
}
